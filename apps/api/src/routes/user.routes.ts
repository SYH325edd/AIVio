import { Router } from "express";
import { requireActiveUser, requireAuth } from "../middleware/auth.middleware.js";
import { billingService } from "../services/billing.service.js";
import type { AuthenticatedRequest } from "../types/auth.js";
import { fail, ok } from "../utils/response.js";

export const userRoutes = Router();

function getUserId(req: AuthenticatedRequest): string {
  const userId = req.user?.id;
  if (!userId) {
    throw Object.assign(new Error("Please sign in first."), { status: 401 });
  }
  return userId;
}

function getErrorStatus(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === "number" && status >= 400 && status < 600) return status;
  return 500;
}

userRoutes.get("/user/balance", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const data = await billingService.getBalance(getUserId(req as AuthenticatedRequest));
    ok(res, data);
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});

userRoutes.get("/user/credit-logs", requireAuth, requireActiveUser, async (req, res) => {
  try {
    const logs = await billingService.getCreditLogs(getUserId(req as AuthenticatedRequest));
    ok(res, { logs });
  } catch (error) {
    fail(res, getErrorStatus(error), error instanceof Error ? error.message : String(error));
  }
});
