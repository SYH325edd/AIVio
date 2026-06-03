import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { prisma } from "./database.service.js";
import { getEnv } from "../config/env.js";
import { createId } from "../utils/id.js";
import type { JwtPayload, LoginRequest, PublicUser, RegisterRequest } from "../types/auth.js";

type DbUser = {
  id: string;
  email: string;
  nickname: string;
  role: string;
  balance: number;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_HASH_PREFIX = "scrypt";

function normalizeEmail(email: string | undefined): string {
  return String(email || "").trim().toLowerCase();
}

function assertEmail(email: string): void {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw Object.assign(new Error("请输入有效邮箱。"), { status: 400 });
  }
}

function assertPassword(password: string | undefined): string {
  const value = String(password || "");
  if (value.length < PASSWORD_MIN_LENGTH) {
    throw Object.assign(new Error(`密码至少需要 ${PASSWORD_MIN_LENGTH} 位。`), { status: 400 });
  }
  return value;
}

function getJwtSecret(): string {
  const secret = getEnv("JWT_SECRET").trim();
  if (!secret) {
    throw Object.assign(new Error("JWT_SECRET 未配置。"), { status: 500 });
  }
  return secret;
}

function base64UrlEncode(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64");
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [scheme, salt, hash] = storedHash.split("$");
  if (scheme !== PASSWORD_HASH_PREFIX || !salt || !hash) return false;
  const actual = Buffer.from(hash, "hex");
  const expected = scryptSync(password, salt, actual.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function signJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signature = createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest();
  return `${encodedHeader}.${encodedBody}.${base64UrlEncode(signature)}`;
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const [encodedHeader, encodedBody, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedBody || !encodedSignature) {
    throw Object.assign(new Error("登录状态无效。"), { status: 401 });
  }
  const expected = base64UrlEncode(createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest());
  if (expected !== encodedSignature) {
    throw Object.assign(new Error("登录状态无效。"), { status: 401 });
  }
  const decoded = JSON.parse(base64UrlDecode(encodedBody).toString("utf8")) as JwtPayload & { exp?: number };
  if (!decoded.sub || !decoded.email || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error("登录状态已过期，请重新登录。"), { status: 401 });
  }
  return { sub: decoded.sub, email: decoded.email };
}

export function toPublicUser(user: DbUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    role: user.role,
    balance: user.balance,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}

export class AuthService {
  async register(payload: RegisterRequest): Promise<{ user: PublicUser; token: string }> {
    const email = normalizeEmail(payload.email);
    assertEmail(email);
    const password = assertPassword(payload.password);
    const passwordHash = hashPassword(password);

    try {
      const user = await prisma.user.create({
        data: {
          id: createId(),
          email,
          passwordHash,
          nickname: String(payload.nickname || "").trim(),
          role: "user",
          status: "active"
        }
      });
      const publicUser = toPublicUser(user);
      return { user: publicUser, token: this.signToken(publicUser) };
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw Object.assign(new Error("该邮箱已注册。"), { status: 409 });
      }
      throw error;
    }
  }

  async login(payload: LoginRequest): Promise<{ user: PublicUser; token: string }> {
    const email = normalizeEmail(payload.email);
    assertEmail(email);
    const password = String(payload.password || "");

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw Object.assign(new Error("邮箱或密码错误。"), { status: 401 });
    }
    if (user.status === "disabled") {
      throw Object.assign(new Error("账号已被禁用，请联系管理员"), { status: 403 });
    }
    if (user.status !== "active") {
      throw Object.assign(new Error("账号状态异常，请联系管理员。"), { status: 403 });
    }

    const matched = verifyPassword(password, user.passwordHash);
    if (!matched) {
      throw Object.assign(new Error("邮箱或密码错误。"), { status: 401 });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() }
    });
    const publicUser = toPublicUser(updated);
    return { user: publicUser, token: this.signToken(publicUser) };
  }

  async getUserById(id: string): Promise<PublicUser | null> {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return null;
    return toPublicUser(user);
  }

  signToken(user: Pick<PublicUser, "id" | "email">): string {
    return signJwt({ sub: user.id, email: user.email }, getJwtSecret());
  }

  verifyToken(token: string): JwtPayload {
    return verifyJwt(token, getJwtSecret());
  }
}

export const authService = new AuthService();
