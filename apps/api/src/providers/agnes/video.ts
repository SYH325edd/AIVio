import type { ProviderCreateResult, ProviderTaskResult } from "../provider.interface.js";
import type { ModelConfig } from "../../types/model.js";
import type { ProviderConfig } from "../../types/provider.js";
import { extractAgnesErrorMessage, requestAgnes, requestAgnesUrl } from "./client.js";

function text(value: unknown): string {
  return String(value || "").trim();
}

function numberParam(payload: Record<string, unknown>, model: ModelConfig, key: string, fallback: number): number {
  const value = payload[key] ?? model.defaultParams?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeNumFrames(value: number): number {
  return clampInteger(Math.round((value - 1) / 8) * 8 + 1, 9, 441);
}

function getFrameRate(payload: Record<string, unknown>, model: ModelConfig): number {
  return clampInteger(numberParam(payload, model, "frame_rate", 24), 1, 60);
}

function getNumFrames(payload: Record<string, unknown>, model: ModelConfig, frameRate: number): number {
  if (payload.num_frames !== undefined || model.defaultParams?.num_frames !== undefined) {
    return normalizeNumFrames(numberParam(payload, model, "num_frames", 121));
  }
  const duration = Number(payload.outputDuration ?? payload.duration);
  if (!Number.isFinite(duration) || duration <= 0) return 121;
  return normalizeNumFrames(duration * frameRate);
}

function getNested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (Array.isArray(current) && /^\d+$/.test(key)) {
      current = current[Number(key)];
      continue;
    }
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function extractProviderTaskId(value: unknown): string {
  for (const path of [["video_id"], ["data", "video_id"], ["output", "video_id"], ["task_id"], ["id"], ["data", "task_id"], ["data", "id"], ["output", "task_id"]]) {
    const found = getNested(value, path);
    if (typeof found === "string" && found.trim()) return found;
  }
  return "";
}

function extractAgnesResultUrl(value: unknown): string {
  for (const path of [
    ["video_url"],
    ["remixed_from_video_id"],
    ["url"],
    ["result_url"],
    ["output_url"],
    ["data", "video_url"],
    ["data", "remixed_from_video_id"],
    ["data", "url"],
    ["output", "video_url"],
    ["output", "remixed_from_video_id"],
    ["output", "url"],
    ["outputs", "0", "url"]
  ]) {
    const found = getNested(value, path);
    if (typeof found === "string" && found.trim()) return found;
  }
  return "";
}

function normalizeStatus(value: unknown): ProviderTaskResult["status"] | undefined {
  const status = String(getNested(value, ["status"]) || getNested(value, ["data", "status"]) || getNested(value, ["output", "status"]) || "").toLowerCase();
  if (["completed", "succeeded", "success", "done"].includes(status)) return "succeeded";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["queued", "pending"].includes(status)) return "pending";
  if (["in_progress", "processing", "running"].includes(status)) return "processing";
  return undefined;
}

function getStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function buildVideoBody(model: ModelConfig, payload: Record<string, unknown>): Record<string, unknown> {
  const frameRate = getFrameRate(payload, model);
  const images = [
    text(payload.imageUrl),
    text(payload.endImageUrl),
    ...getStringArray(payload.referenceFrameUrls),
    ...getStringArray(payload.referenceImageUrls)
  ].filter(Boolean);
  const body: Record<string, unknown> = {
    model: model.id,
    prompt: text(payload.prompt),
    width: numberParam(payload, model, "width", 1152),
    height: numberParam(payload, model, "height", 768),
    num_frames: getNumFrames(payload, model, frameRate),
    frame_rate: frameRate
  };

  if (images.length === 1) {
    body.image = images[0];
    body.mode = "ti2vid";
  }
  if (images.length > 1) {
    body.image = images;
    body.mode = "keyframes";
    body.extra_body = {
      image: images,
      mode: "keyframes"
    };
  }

  const seed = Number(payload.seed);
  if (Number.isInteger(seed)) body.seed = seed;
  const negativePrompt = text(payload.negative_prompt ?? payload.negativePrompt);
  if (negativePrompt) body.negative_prompt = negativePrompt;
  const steps = Number(payload.num_inference_steps ?? payload.numInferenceSteps);
  if (Number.isInteger(steps) && steps > 0) body.num_inference_steps = steps;

  return body;
}

function buildVideoQueryUrl(provider: ProviderConfig, providerTaskId: string, modelId: string): string {
  const base = new URL(provider.baseUrl);
  const url = new URL("/agnesapi", base.origin);
  url.searchParams.set("video_id", providerTaskId);
  url.searchParams.set("model_name", modelId);
  return url.toString();
}

export async function createAgnesVideoTask(
  provider: ProviderConfig,
  model: ModelConfig,
  payload: Record<string, unknown>
): Promise<ProviderCreateResult> {
  const response = await requestAgnes(provider, "videos", {
    method: "POST",
    body: JSON.stringify(buildVideoBody(model, payload))
  });
  const providerTaskId = extractProviderTaskId(response.body);
  if (!providerTaskId) {
    const error = new Error("Agnes did not return a video task id.");
    (error as Error & { body?: unknown }).body = response.body;
    throw error;
  }
  return {
    providerTaskId,
    resultRaw: response.body,
    resultUrl: extractAgnesResultUrl(response.body)
  };
}

export async function getAgnesVideoTask(provider: ProviderConfig, providerTaskId: string): Promise<ProviderTaskResult> {
  const response = providerTaskId.startsWith("video_")
    ? await requestAgnesUrl(provider, buildVideoQueryUrl(provider, providerTaskId, "agnes-video-v2.0"), { method: "GET" })
    : await requestAgnes(provider, `videos/${encodeURIComponent(providerTaskId)}`, { method: "GET" });
  return {
    status: normalizeStatus(response.body),
    resultRaw: response.body,
    resultUrl: extractAgnesResultUrl(response.body),
    errorMessage: extractAgnesErrorMessage(response.body)
  };
}
