import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { authService } from "../services/auth.service.js";
import type { AuthenticatedRequest, LoginRequest, RegisterRequest } from "../types/auth.js";
import { fail, ok } from "../utils/response.js";

export const authRoutes = Router();

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

authRoutes.post("/auth/register", async (req, res) => {
  try {
    const result = await authService.register(req.body as RegisterRequest);
    ok(res, result, 201);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/login", async (req, res) => {
  try {
    const result = await authService.login(req.body as LoginRequest);
    ok(res, result);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

authRoutes.post("/auth/logout", (_req, res) => {
  ok(res, { ok: true });
});

authRoutes.get("/auth/me", requireAuth, (req, res) => {
  ok(res, { user: (req as AuthenticatedRequest).user });
});
