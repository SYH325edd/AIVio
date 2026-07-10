import nodemailer from "nodemailer";
import { env, isProduction, isSmtpConfigured } from "../config/env.js";
import { error as logError, toErrorMeta, warn } from "../utils/logger.js";

type SendVerificationCodePayload = {
  email: string;
  code: string;
  ttlMinutes: number;
};

type SendVerificationCodeResult = {
  delivered: boolean;
  devVerificationCode?: string;
};

const EMAIL_NOT_CONFIGURED_MESSAGE = "Email service is not configured.";

function verificationEmailText(code: string, ttlMinutes: number): string {
  return [
    `你的 AIVio 注册验证码是：${code}`,
    `验证码 ${ttlMinutes} 分钟内有效。`,
    "如果不是你本人操作，请忽略这封邮件。"
  ].join("\n");
}

export class EmailService {
  private transporter = isSmtpConfigured()
    ? nodemailer.createTransport({
        host: env.smtpHost,
        port: env.smtpPort,
        secure: env.smtpSecure,
        auth: {
          user: env.smtpUser,
          pass: env.smtpPass
        }
      })
    : null;

  assertVerificationDeliveryAvailable(): void {
    if (!isSmtpConfigured() && isProduction() && env.authRequireEmailVerification) {
      throw Object.assign(new Error(EMAIL_NOT_CONFIGURED_MESSAGE), { status: 500 });
    }
  }

  async sendVerificationCode(payload: SendVerificationCodePayload): Promise<SendVerificationCodeResult> {
    if (!this.transporter) {
      this.assertVerificationDeliveryAvailable();
      warn("SMTP is not configured. Using development verification code fallback.", {
        email: payload.email,
        ttlMinutes: payload.ttlMinutes
      });
      warn("Development verification code generated.", {
        email: payload.email,
        ttlMinutes: payload.ttlMinutes
      });
      return {
        delivered: false,
        devVerificationCode: payload.code
      };
    }

    try {
      await this.transporter.sendMail({
        from: env.smtpFrom,
        to: payload.email,
      subject: "AIVio 注册验证码",
        text: verificationEmailText(payload.code, payload.ttlMinutes)
      });
    } catch (sendError) {
      logError("Verification email delivery failed.", {
        email: payload.email,
        error: toErrorMeta(sendError)
      });
      throw sendError;
    }

    return { delivered: true };
  }
}

export const emailService = new EmailService();
