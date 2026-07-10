import { Router } from "express";
import { env, getCorsOrigins, getEnv, getRuntimeEnvironment } from "../config/env.js";
import { prisma } from "../services/database.service.js";
import { ok } from "../utils/response.js";

export const healthRoutes = Router();

type HealthCheckValue = boolean | "unknown";

async function checkDatabase(): Promise<HealthCheckValue> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function hasEnvValue(name: string): boolean {
  return Boolean(getEnv(name).trim());
}

healthRoutes.get("/health", async (_req, res) => {
  const database = await checkDatabase();

  ok(res, {
    ok: true,
    service: "aivio-api",
    time: new Date().toISOString(),
    environment: getRuntimeEnvironment(),
    checks: {
      api: true,
      database,
      corsConfigured: getCorsOrigins().length > 0,
      mockPaymentEnabled: env.enableMockPayment,
      volcengineConfigured: hasEnvValue("VOLCENGINE_ARK_API_KEY"),
      agnesConfigured: hasEnvValue("AGNES_API_KEY"),
      publicAssetBaseUrlConfigured: Boolean(env.publicAssetBaseUrl.trim())
    }
  });
});
