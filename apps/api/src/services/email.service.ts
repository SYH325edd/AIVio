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

const EMAIL_NOT_CONFIGURED_MESSAGE = "SMTP is not configured. Missing SMTP_HOST, SMTP_USER, SMTP_PASS or SMTP_FROM.";
const EMAIL_DELIVERY_FAILED_MESSAGE = "SMTP email delivery failed. Please try again later.";
const SMTP_TIMEOUT_MS = 15000;

function verificationEmailText(code: string, ttlMinutes: number): string {
  return [
    `Your AIVio verification code is: ${code}`,
    `This code is valid for ${ttlMinutes} minute(s).`,
    "If you did not request this email, please ignore it."
  ].join("\n");
}

function getMissingSmtpFields(): string[] {
  const entries: Array<[string, string]> = [
    ["SMTP_HOST", env.smtpHost],
    ["SMTP_USER", env.smtpUser],
    ["SMTP_PASS", env.smtpPass],
    ["SMTP_FROM", env.smtpFrom]
  ];
  return entries.filter(([, value]) => !value.trim()).map(([name]) => name);
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
        },
        connectionTimeout: SMTP_TIMEOUT_MS,
        greetingTimeout: SMTP_TIMEOUT_MS,
        socketTimeout: SMTP_TIMEOUT_MS
      })
    : null;

  assertVerificationDeliveryAvailable(): void {
    if (!isSmtpConfigured() && env.authRequireEmailVerification) {
      const missing = getMissingSmtpFields();
      logError("SMTP configuration missing for verification delivery.", { missing });
      throw Object.assign(new Error(EMAIL_NOT_CONFIGURED_MESSAGE), { status: 500 });
    }
  }

  async sendVerificationCode(payload: SendVerificationCodePayload): Promise<SendVerificationCodeResult> {
    if (!this.transporter) {
      this.assertVerificationDeliveryAvailable();
      if (!isProduction()) {
        warn("SMTP is not configured. Using development verification code fallback.", {
          email: payload.email,
          ttlMinutes: payload.ttlMinutes
        });
        return {
          delivered: false,
          devVerificationCode: payload.code
        };
      }
      throw Object.assign(new Error(EMAIL_NOT_CONFIGURED_MESSAGE), { status: 500 });
    }

    try {
      await this.transporter.sendMail({
        from: env.smtpFrom,
        to: payload.email,
        subject: "AIVio verification code",
        text: verificationEmailText(payload.code, payload.ttlMinutes)
      });
    } catch (sendError) {
      logError("Verification email delivery failed.", {
        email: payload.email,
        error: toErrorMeta(sendError)
      });
      throw Object.assign(new Error(EMAIL_DELIVERY_FAILED_MESSAGE), { status: 502 });
    }

    return { delivered: true };
  }
}

export const emailService = new EmailService();
