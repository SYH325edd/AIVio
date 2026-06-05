import { prisma, type PrismaTransaction } from "./database.service.js";
import { createId } from "../utils/id.js";

export type CreditLogType = "recharge" | "consume" | "refund" | "admin_adjust" | "system_grant";

export const INSUFFICIENT_BALANCE_MESSAGE = "余额不足，请充值后再生成。";

type Tx = PrismaTransaction;

function toPublicCreditLog(log: {
  id: string;
  userId: string | null;
  type: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  relatedTaskId: string | null;
  relatedOrderId: string | null;
  remark: string;
  createdAt: Date;
}) {
  return {
    id: log.id,
    userId: log.userId,
    type: log.type,
    amount: log.amount,
    balanceBefore: log.balanceBefore,
    balanceAfter: log.balanceAfter,
    relatedTaskId: log.relatedTaskId,
    relatedOrderId: log.relatedOrderId,
    remark: log.remark,
    createdAt: log.createdAt.toISOString()
  };
}

async function createCreditLog(
  tx: Tx,
  input: {
    userId: string;
    type: CreditLogType;
    amount: number;
    balanceBefore: number;
    balanceAfter: number;
    relatedTaskId?: string | null;
    relatedOrderId?: string | null;
    remark?: string;
  }
) {
  return tx.creditLog.create({
    data: {
      id: createId(),
      userId: input.userId,
      type: input.type,
      amount: input.amount,
      balanceBefore: input.balanceBefore,
      balanceAfter: input.balanceAfter,
      relatedTaskId: input.relatedTaskId || null,
      relatedOrderId: input.relatedOrderId || null,
      remark: input.remark || ""
    }
  });
}

export class BillingService {
  async getBalance(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
    return {
      userId: user.id,
      email: user.email,
      balance: user.balance
    };
  }

  async getCreditLogs(userId: string) {
    const logs = await prisma.creditLog.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" }
    });
    return logs.map(toPublicCreditLog);
  }

  async listCreditLogs(userId: string) {
    return this.getCreditLogs(userId);
  }

  async grantDevCredits(email: string, amount: number) {
    if (!email || amount <= 0) {
      throw new Error("email and positive amount are required.");
    }

    return prisma.$transaction(async (tx: Tx) => {
      const user = await tx.user.findUnique({ where: { email } });
      if (!user) throw new Error(`User '${email}' was not found.`);
      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + amount;
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { balance: balanceAfter }
      });
      const log = await createCreditLog(tx, {
        userId: user.id,
        type: "system_grant",
        amount,
        balanceBefore,
        balanceAfter,
        remark: "Local development credit grant"
      });
      return { userId: updated.id, email: updated.email, balance: updated.balance, log: toPublicCreditLog(log) };
    });
  }

  async consumeCredits(userId: string, taskId: string, amount: number, remark = "Video generation consume") {
    if (amount <= 0) return null;

    return prisma.$transaction(async (tx: Tx) => {
      const existing = await tx.creditLog.findFirst({
        where: { userId, relatedTaskId: taskId, type: "consume" }
      });
      if (existing) return toPublicCreditLog(existing);

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(new Error("User not found."), { status: 404 });
      if (user.balance < amount) {
        throw Object.assign(new Error(INSUFFICIENT_BALANCE_MESSAGE), { status: 402 });
      }

      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore - amount;
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      });
      const log = await createCreditLog(tx, {
        userId,
        type: "consume",
        amount: -amount,
        balanceBefore,
        balanceAfter,
        relatedTaskId: taskId,
        remark
      });
      return toPublicCreditLog(log);
    });
  }

  async consumeForTask(userId: string, taskId: string, amount: number, remark = "Video generation consume") {
    return this.consumeCredits(userId, taskId, amount, remark);
  }

  async refundCredits(userId: string, taskId: string, amount: number, remark = "Video generation refund") {
    if (amount <= 0) return null;

    return prisma.$transaction(async (tx: Tx) => {
      const consume = await tx.creditLog.findFirst({
        where: { userId, relatedTaskId: taskId, type: "consume" }
      });
      if (!consume) return null;

      const existingRefund = await tx.creditLog.findFirst({
        where: { userId, relatedTaskId: taskId, type: "refund" }
      });
      if (existingRefund) return toPublicCreditLog(existingRefund);

      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw Object.assign(new Error("User not found."), { status: 404 });

      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore + amount;
      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter }
      });
      const log = await createCreditLog(tx, {
        userId,
        type: "refund",
        amount,
        balanceBefore,
        balanceAfter,
        relatedTaskId: taskId,
        remark
      });
      return toPublicCreditLog(log);
    });
  }

  async refundForTask(userId: string, taskId: string, amount: number, remark = "Video generation refund") {
    return this.refundCredits(userId, taskId, amount, remark);
  }

  async hasConsumed(taskId: string) {
    const consume = await prisma.creditLog.findFirst({
      where: { relatedTaskId: taskId, type: "consume" }
    });
    return Boolean(consume);
  }

  async hasRefunded(taskId: string) {
    const refund = await prisma.creditLog.findFirst({
      where: { relatedTaskId: taskId, type: "refund" }
    });
    return Boolean(refund);
  }

  async hasRefund(userId: string, taskId: string) {
    const refund = await prisma.creditLog.findFirst({
      where: { userId, relatedTaskId: taskId, type: "refund" }
    });
    return Boolean(refund);
  }
}

export const billingService = new BillingService();
