import type { Request } from "express";

export interface RegisterRequest {
  email?: string;
  password?: string;
  nickname?: string;
}

export interface LoginRequest {
  email?: string;
  password?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  nickname: string;
  role: string;
  balance: number;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedRequest extends Request {
  user?: PublicUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
}
