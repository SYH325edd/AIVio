import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(apiRoot, "../..");

if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: path.join(apiRoot, ".env.production") });
}
dotenv.config({ path: path.join(apiRoot, ".env"), override: false });
dotenv.config({ path: path.join(repoRoot, ".env"), override: false });

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8788),
  corsOrigin: process.env.CORS_ORIGIN || "",
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX || 300),
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX || 20),
  generationRateLimitMax: Number(process.env.GENERATION_RATE_LIMIT_MAX || 30),
  mockPayRateLimitMax: Number(process.env.MOCK_PAY_RATE_LIMIT_MAX || 30),
  maxImageUploadMb: Number(process.env.MAX_IMAGE_UPLOAD_MB || 10),
  maxVideoUploadMb: Number(process.env.MAX_VIDEO_UPLOAD_MB || 100),
  publicAssetBaseUrl: process.env.PUBLIC_ASSET_BASE_URL || "",
  apiRoot,
  repoRoot,
  modelsPath: path.join(repoRoot, "config", "models.json"),
  providersPath: path.join(repoRoot, "config", "providers.json"),
  rechargePackagesPath: path.join(repoRoot, "config", "recharge-packages.json"),
  taskStorePath: path.join(repoRoot, "data", "generation-tasks.json")
};

export function getEnv(name: string): string {
  return process.env[name] || "";
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value.trim()) {
    throw new Error(`Missing environment variable '${name}'. Configure it in .env before starting the Node API.`);
  }
  return value;
}

export function isProduction(): boolean {
  return env.nodeEnv === "production";
}

export function validateStartupEnv(): void {
  const required = ["PORT", "DATABASE_URL", "JWT_SECRET"];
  const missing = required.filter((name) => !getEnv(name).trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(", ")}.`);
  }
  if (!Number.isInteger(env.port) || env.port <= 0) {
    throw new Error("PORT must be a positive integer.");
  }
  if (isProduction() && !env.corsOrigin.trim()) {
    throw new Error("CORS_ORIGIN must be configured in production.");
  }
}
