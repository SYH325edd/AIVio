import { requireEnv } from "../../config/env.js";
import type { ProviderConfig } from "../../types/provider.js";
import { error as logError } from "../../utils/logger.js";

export interface AgnesResponse {
  status: number;
  body: unknown;
}

function joinApiPath(baseUrl: string, apiPath: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${apiPath.replace(/^\/+/, "")}`;
}

export function extractAgnesErrorMessage(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object") return "";
  const candidate = value as {
    error?: { message?: unknown } | string;
    message?: unknown;
    errorMessage?: unknown;
  };
  if (typeof candidate.error === "string") return candidate.error;
  if (typeof candidate.error?.message === "string") return candidate.error.message;
  if (typeof candidate.message === "string") return candidate.message;
  if (typeof candidate.errorMessage === "string") return candidate.errorMessage;
  return "";
}

export async function requestAgnes(provider: ProviderConfig, apiPath: string, init: RequestInit): Promise<AgnesResponse> {
  const apiKey = requireEnv(provider.apiKeyEnvName);
  const response = await fetch(joinApiPath(provider.baseUrl, apiPath), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const message = extractAgnesErrorMessage(body) || `Agnes request failed with status ${response.status}.`;
    logError("Provider request failed", {
      provider: provider.key,
      apiPath,
      status: response.status,
      message
    });
    const error = new Error(message);
    (error as Error & { status?: number; body?: unknown }).status = response.status;
    (error as Error & { status?: number; body?: unknown }).body = body;
    throw error;
  }

  return { status: response.status, body };
}
