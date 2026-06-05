import { agnesProvider } from "../providers/agnes/index.js";
import { volcengineProvider } from "../providers/volcengine/index.js";
import { extractVolcengineResultUrl } from "../providers/volcengine/video.js";
import type { VideoProviderAdapter } from "../providers/provider.interface.js";
import { billingService, INSUFFICIENT_BALANCE_MESSAGE } from "./billing.service.js";
import { assetService } from "./asset.service.js";
import { authService } from "./auth.service.js";
import { modelRegistryService } from "./model-registry.service.js";
import { buildPricingRemark, pricingService } from "./pricing.service.js";
import { taskDbStore } from "./task-db-store.service.js";
import type { GenerationTask, VideoGenerationRequest } from "../types/generation.js";

const videoAdapters: Record<string, VideoProviderAdapter> = {
  agnes: agnesProvider,
  volcengine: volcengineProvider
};

function getPayloadParams(payload: VideoGenerationRequest): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const skip = new Set(["model", "modelId", "prompt", "apiKey", "baseUrl", "provider"]);
  for (const [key, value] of Object.entries(payload)) {
    if (skip.has(key)) continue;
    params[key] = value;
  }
  return params;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function text(value: unknown): string {
  return String(value || "").trim();
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => text(item)).filter(Boolean);
  return [];
}

function inferInputType(payload: VideoGenerationRequest): string {
  const explicit = text(payload.inputType);
  if (explicit) return explicit;
  if (payload.inputContainsVideo || payload.referenceVideoAssetId) return "video";
  if (payload.firstFrameAssetId || payload.lastFrameAssetId || payload.imageUrl || payload.endImageUrl) return "image";
  return "text";
}

async function backfillSucceededResultUrl(task: GenerationTask): Promise<GenerationTask> {
  if (task.status !== "succeeded" || task.resultUrl) return task;
  const resultUrl = extractVolcengineResultUrl(task.resultRaw);
  if (!resultUrl) return task;
  return taskDbStore.update(task.id, { resultUrl });
}

async function resolveAssetInputs(payload: VideoGenerationRequest, userId: string, userRole: string) {
  const inputType = inferInputType(payload);
  const imageMode = text(payload.imageMode) || (payload.lastFrameAssetId ? "first_last_frame" : "first_frame");
  const payloadParams = payload.params && typeof payload.params === "object" && !Array.isArray(payload.params) ? payload.params as Record<string, unknown> : null;
  const firstFrameAssetId = text(payload.firstFrameAssetId);
  const lastFrameAssetId = text(payload.lastFrameAssetId);
  const referenceVideoAssetId = text(payload.referenceVideoAssetId);
  const referenceFrameAssetIds = normalizeStringList(payload.referenceFrameAssetIds ?? payloadParams?.referenceFrameAssetIds);
  const inputContainsVideo = Boolean(payload.inputContainsVideo || inputType === "video");

  let firstFrameAsset: Awaited<ReturnType<typeof assetService.requireAsset>> | null = null;
  let lastFrameAsset: Awaited<ReturnType<typeof assetService.requireAsset>> | null = null;
  let referenceVideoAsset: Awaited<ReturnType<typeof assetService.requireAsset>> | null = null;
  let referenceFrameAssets: Array<Awaited<ReturnType<typeof assetService.requireAsset>>> = [];
  let effectiveInputVideoDuration = payload.inputVideoDuration;

  if (referenceFrameAssetIds.length > 6) {
    throw Object.assign(new Error("参考帧最多上传 6 张"), { status: 400 });
  }

  if (inputType === "image") {
    if (!firstFrameAssetId) {
      throw Object.assign(new Error("请上传参考图片（首帧）。"), { status: 400 });
    }
    firstFrameAsset = await assetService.requireAsset(firstFrameAssetId, userId, userRole, "image");
    if (imageMode === "first_last_frame") {
      if (!lastFrameAssetId) {
        throw Object.assign(new Error("首尾帧生成需要同时上传首帧图片和尾帧图片。"), { status: 400 });
      }
      lastFrameAsset = await assetService.requireAsset(lastFrameAssetId, userId, userRole, "image");
    }
  }

  if (inputContainsVideo) {
    if (!referenceVideoAssetId) {
      throw Object.assign(new Error("请上传参考视频。"), { status: 400 });
    }
    referenceVideoAsset = await assetService.requireAsset(referenceVideoAssetId, userId, userRole, "video");
    if (typeof referenceVideoAsset.durationSeconds === "number" && Number.isFinite(referenceVideoAsset.durationSeconds)) {
      effectiveInputVideoDuration = Math.round(referenceVideoAsset.durationSeconds);
    }
  }

  if (referenceFrameAssetIds.length > 0) {
    referenceFrameAssets = await Promise.all(
      referenceFrameAssetIds.map((assetId) => assetService.requireAsset(assetId, userId, userRole, "image"))
    );
  }

  const referenceFrameUrls = referenceFrameAssets.map((asset) => asset.providerUrl).filter(Boolean);
  const providerParams = {
    firstFrameUrl: firstFrameAsset?.providerUrl,
    lastFrameUrl: lastFrameAsset?.providerUrl,
    referenceVideoUrl: referenceVideoAsset?.providerUrl,
    referenceFrameUrls,
    referenceImageUrls: referenceFrameUrls
  };

  const assets = {
    firstFrame: firstFrameAsset,
    lastFrame: lastFrameAsset,
    referenceVideo: referenceVideoAsset,
    referenceFrames: referenceFrameAssets
  };

  return {
    inputType,
    imageMode: inputType === "image" ? imageMode : undefined,
    inputContainsVideo,
    firstFrameAssetId: firstFrameAsset?.id,
    lastFrameAssetId: lastFrameAsset?.id,
    referenceVideoAssetId: referenceVideoAsset?.id,
    referenceFrameAssetIds,
    effectiveInputVideoDuration,
    providerParams,
    assets
  };
}

async function refundFailedTask(task: GenerationTask, reason: string): Promise<GenerationTask> {
  if (!task.userId || task.cost <= 0) return task;
  await billingService.refundCredits(task.userId, task.id, task.cost, reason);
  const refundNote = `已自动退款 ${task.cost} 积分。`;
  const currentMessage = task.errorMessage || reason;
  if (currentMessage.includes(refundNote)) return task;
  return taskDbStore.update(task.id, {
    errorMessage: `${currentMessage}\n${refundNote}`
  });
}

export class GenerationService {
  async createVideoGeneration(payload: VideoGenerationRequest, userId: string): Promise<GenerationTask> {
    const modelId = payload.modelId || payload.model;
    if (!modelId) {
      throw new Error("modelId is required.");
    }
    if (!payload.prompt?.trim()) {
      throw new Error("prompt is required.");
    }

    const userForAssets = await authService.getUserById(userId);
    const assetInputs = await resolveAssetInputs(payload, userId, userForAssets?.role || "user");

    const model = await modelRegistryService.getGenerationModel(modelId);
    if (!model) {
      throw Object.assign(new Error(`Video model '${modelId}' was not found.`), { status: 404 });
    }
    if (!model.enabled || model.modelType !== "video") {
      throw Object.assign(new Error(`Video model '${modelId}' is disabled or not available for video generation.`), { status: 400 });
    }
    const pricing = await pricingService.calculateVideoGenerationCost({
      modelId,
      inputContainsVideo: assetInputs.inputContainsVideo,
      inputVideoDuration: assetInputs.effectiveInputVideoDuration,
      outputDuration: payload.outputDuration ?? payload.duration,
      resolution: payload.resolution,
      audioMode: payload.audioMode,
      count: payload.count
    });
    const cost = pricing.cost;
    const balance = await billingService.getBalance(userId);
    if (balance.balance < cost) {
      throw Object.assign(new Error(INSUFFICIENT_BALANCE_MESSAGE), { status: 402 });
    }

    const provider = await modelRegistryService.getGenerationProvider(model.provider);
    if (!provider || !provider.enabled) {
      throw Object.assign(new Error(`Provider '${model.provider}' is not configured or enabled.`), { status: 400 });
    }

    const adapter = videoAdapters[provider.adapter];
    if (!adapter) {
      throw new Error(`Video provider adapter '${provider.adapter}' is not implemented.`);
    }

    const outputDuration = Number(pricing.breakdown.outputDuration);
    const normalizedPayload: VideoGenerationRequest = {
      ...payload,
      inputType: assetInputs.inputType,
      imageMode: assetInputs.imageMode,
      firstFrameAssetId: assetInputs.firstFrameAssetId,
      lastFrameAssetId: assetInputs.lastFrameAssetId,
      referenceVideoAssetId: assetInputs.referenceVideoAssetId,
      referenceFrameAssetIds: assetInputs.referenceFrameAssetIds,
      duration: outputDuration,
      outputDuration,
      resolution: pricing.breakdown.resolution,
      inputContainsVideo: pricing.breakdown.inputContainsVideo,
      inputVideoDuration: pricing.breakdown.inputVideoDuration ?? undefined,
      audioMode: pricing.breakdown.audioMode,
      count: pricing.breakdown.count,
      generateAudio: pricing.breakdown.audioMode === "audio" ? true : payload.generateAudio,
      imageUrl: assetInputs.providerParams.firstFrameUrl || payload.imageUrl,
      endImageUrl: assetInputs.providerParams.lastFrameUrl || payload.endImageUrl,
      referenceVideoUrl: assetInputs.providerParams.referenceVideoUrl,
      referenceFrameUrls: assetInputs.providerParams.referenceFrameUrls,
      referenceImageUrls: assetInputs.providerParams.referenceImageUrls
    };
    const consumeRemark = buildPricingRemark({
      modelDisplayName: model.displayName,
      resolution: String(pricing.breakdown.resolution),
      outputDuration,
      inputContainsVideo: Boolean(pricing.breakdown.inputContainsVideo),
      inputVideoDuration: typeof pricing.breakdown.inputVideoDuration === "number" ? pricing.breakdown.inputVideoDuration : null,
      count: Number(pricing.breakdown.count),
      audioMode: pricing.breakdown.audioMode as "audio" | "silent" | "default",
      cost
    });

    let task = await taskDbStore.create({
      userId,
      provider: provider.key,
      modelId: model.id,
      modelDisplayName: model.displayName,
      taskType: String(normalizedPayload.mode || model.defaultParams?.mode || "text-to-video"),
      prompt: normalizedPayload.prompt || "",
      params: {
        ...getPayloadParams(normalizedPayload),
        inputType: assetInputs.inputType,
        imageMode: assetInputs.imageMode,
        firstFrameAssetId: assetInputs.firstFrameAssetId,
        lastFrameAssetId: assetInputs.lastFrameAssetId,
        referenceVideoAssetId: assetInputs.referenceVideoAssetId,
        referenceFrameAssetIds: assetInputs.referenceFrameAssetIds,
        assets: assetInputs.assets,
        providerParams: assetInputs.providerParams,
        pricingBreakdown: pricing.breakdown
      },
      pricingBreakdown: pricing.breakdown,
      cost
    });
    try {
      await billingService.consumeCredits(userId, task.id, cost, consumeRemark);
    } catch (error) {
      await taskDbStore.update(task.id, {
        status: "failed",
        errorMessage: extractErrorMessage(error)
      });
      throw error;
    }
    task = await taskDbStore.update(task.id, { status: "processing" });

    try {
      const result = await adapter.createVideoTask(provider, model, normalizedPayload as Record<string, unknown>);
      task = await taskDbStore.update(task.id, {
        status: "processing",
        providerTaskId: result.providerTaskId,
        resultRaw: result.resultRaw,
        resultUrl: result.resultUrl
      });
      return task;
    } catch (error) {
      task = await taskDbStore.update(task.id, {
        status: "failed",
        errorMessage: extractErrorMessage(error),
        resultRaw: (error as { body?: unknown }).body ?? null
      });
      task = await refundFailedTask(task, "Provider task creation failed");
      throw Object.assign(new Error(task.errorMessage), { task });
    }
  }

  async listTasks(userId: string): Promise<GenerationTask[]> {
    return taskDbStore.list(userId);
  }

  async getTask(taskId: string, userId: string): Promise<GenerationTask | undefined> {
    let task = await taskDbStore.get(taskId, userId);
    if (task) task = await backfillSucceededResultUrl(task);
    if (!task || !task.providerTaskId || ["succeeded", "failed", "cancelled"].includes(task.status)) {
      return task;
    }

    const provider = await modelRegistryService.getGenerationProvider(task.provider);
    if (!provider) return task;
    const adapter = videoAdapters[provider.adapter];
    if (!adapter) return task;

    try {
      const result = await adapter.getVideoTask(provider, task.providerTaskId);
      const updated = await taskDbStore.update(task.id, {
        status: result.status || task.status,
        resultRaw: result.resultRaw,
        resultUrl: result.resultUrl || task.resultUrl,
        errorMessage: result.status === "failed" ? result.errorMessage || task.errorMessage : task.errorMessage
      });
      if (updated.status === "failed") {
        return refundFailedTask(updated, "Provider task failed");
      }
      return updated;
    } catch (error) {
      const updated = await taskDbStore.update(task.id, {
        status: "failed",
        errorMessage: extractErrorMessage(error),
        resultRaw: (error as { body?: unknown }).body ?? null
      });
      return refundFailedTask(updated, "Provider task query failed");
    }
  }
}

export const generationService = new GenerationService();
