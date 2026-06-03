import { Router } from "express";
import { env } from "../config/env.js";
import { prisma } from "../services/database.service.js";
import { ok } from "../utils/response.js";

export const healthRoutes = Router();

healthRoutes.get("/health", async (_req, res) => {
  let database = false;
  let modelsCount = 0;
  let providersCount = 0;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
    const [models, providers] = await Promise.all([prisma.model.count(), prisma.provider.count()]);
    modelsCount = models;
    providersCount = providers;
  } catch {
    database = false;
  }
  ok(res, {
    ok: database,
    status: database ? "ok" : "degraded",
    version: "0.1.0",
    time: new Date().toISOString(),
    environment: env.nodeEnv,
    database,
    modelsCount,
    providersCount
  });
});
