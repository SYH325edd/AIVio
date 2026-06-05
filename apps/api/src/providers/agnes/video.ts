import type { ProviderCreateResult, ProviderTaskResult } from "../provider.interface.js";
import type { ModelConfig } from "../../types/model.js";
import type { ProviderConfig } from "../../types/provider.js";
import { extractAgnesErrorMessage, requestAgnes } from "./client.js";

function text(value: unknown): string {
  return String(value || "").trim();
}

function numberParam(payload: Record<string, unknown>, model: ModelConfig, key: string, fallback: number): number {
  const value = payload[key] ?? model.defaultParams?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
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
  for (const path of [["task_id"], ["id"], ["data", "task_id"], ["data", "id"], ["output", "task_id"]]) {
    const found = getNested(value, path);
    if (typeof found === "string" && found.trim()) return found;
  }
  return "";
}

function extractAgnesResultUrl(value: unknown): string {
  for (const path of [
    ["remixed_from_video_id"],
    ["video_url"],
    ["url"],
    ["result_url"],
    ["output_url"],
    ["data", "remixed_from_video_id"],
    ["data", "video_url"],
    ["data", "url"],
    ["output", "remixed_from_video_id"],
    ["output", "video_url"],
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

function buildVideoBody(model: ModelConfig, payload: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: model.id,
    prompt: text(payload.prompt),
    width: numberParam(payload, model, "width", 1152),
    height: numberParam(payload, model, "height", 768),
    num_frames: numberParam(payload, model, "num_frames", 121),
    frame_rate: numberParam(payload, model, "frame_rate", 24)
  };

  const imageUrl = text(payload.imageUrl);
  if (imageUrl) body.image_url = imageUrl;

  return body;
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
  const response = await requestAgnes(provider, `videos/${encodeURIComponent(providerTaskId)}`, {
    method: "GET"
  });
  return {
    status: normalizeStatus(response.body),
    resultRaw: response.body,
    resultUrl: extractAgnesResultUrl(response.body),
    errorMessage: extractAgnesErrorMessage(response.body)
  };
}
