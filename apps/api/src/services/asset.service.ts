import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { createId } from "../utils/id.js";
import { prisma } from "./database.service.js";
import type { AssetType, PublicUploadedAsset } from "../types/asset.js";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm"
};

export const uploadRoot = path.join(env.apiRoot, "uploads");

type AssetRow = {
  id: string;
  userId: string;
  type: AssetType;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
  localUrl: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type CreateAssetInput = {
  userId: string;
  type: AssetType;
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
};

function toIso(value?: Date | string) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicAssetUrl(localUrl: string) {
  const base = env.publicAssetBaseUrl.trim();
  if (!base) return localUrl;
  return `${base.replace(/\/$/, "")}${localUrl.startsWith("/") ? localUrl : `/${localUrl}`}`;
}

function toPublicAsset(row: AssetRow): PublicUploadedAsset {
  return {
    id: row.id,
    type: row.type,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    url: publicAssetUrl(row.localUrl),
    width: row.width,
    height: row.height,
    durationSeconds: row.durationSeconds,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt)
  };
}

function safeOriginalName(name: string) {
  const base = path.basename(String(name || "upload").replace(/\0/g, ""));
  return base.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 180) || "upload";
}

function maxBytesFor(type: AssetType) {
  const mb = type === "image" ? env.maxImageUploadMb : env.maxVideoUploadMb;
  return Math.max(1, mb) * 1024 * 1024;
}

function assertUpload(type: AssetType, mimeType: string, sizeBytes: number) {
  if (sizeBytes <= 0) {
    throw Object.assign(new Error("文件不能为空。"), { status: 400 });
  }
  if (type === "image" && !IMAGE_MIME_TYPES.has(mimeType)) {
    throw Object.assign(new Error("仅支持 JPG / PNG / WEBP 图片。"), { status: 400 });
  }
  if (type === "video" && !VIDEO_MIME_TYPES.has(mimeType)) {
    throw Object.assign(new Error("仅支持 MP4 / MOV / WEBM 视频。"), { status: 400 });
  }
  if (sizeBytes > maxBytesFor(type)) {
    throw Object.assign(new Error("文件大小超出限制。"), { status: 413 });
  }
}

function providerUrl(localUrl: string) {
  if (/^https?:\/\//i.test(localUrl)) return localUrl;
  const base = env.publicAssetBaseUrl.trim() || `http://127.0.0.1:${env.port}`;
  return `${base.replace(/\/$/, "")}${localUrl.startsWith("/") ? localUrl : `/${localUrl}`}`;
}

async function getRowById(id: string): Promise<AssetRow | null> {
  const rows = (await prisma.$queryRawUnsafe("SELECT * FROM UploadedAsset WHERE id = ? LIMIT 1", id)) as AssetRow[];
  return rows[0] || null;
}

export class AssetService {
  maxUploadBufferBytes() {
    return Math.max(env.maxImageUploadMb, env.maxVideoUploadMb) * 1024 * 1024 + 1024 * 1024;
  }

  assertUploadInput(type: AssetType, mimeType: string, sizeBytes: number) {
    assertUpload(type, mimeType, sizeBytes);
  }

  async createAsset(input: CreateAssetInput) {
    assertUpload(input.type, input.mimeType, input.buffer.length);
    await fs.mkdir(uploadRoot, { recursive: true });

    const extension = MIME_EXTENSIONS[input.mimeType];
    const fileName = `${randomUUID()}${extension}`;
    const storagePath = fileName;
    const absolutePath = path.join(uploadRoot, fileName);
    await fs.writeFile(absolutePath, input.buffer, { flag: "wx" });

    const id = createId();
    const originalName = safeOriginalName(input.originalName);
    const localUrl = `/uploads/${fileName}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO UploadedAsset (
        id, userId, type, originalName, mimeType, sizeBytes, storagePath, localUrl,
        width, height, durationSeconds, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      input.userId,
      input.type,
      originalName,
      input.mimeType,
      input.buffer.length,
      storagePath,
      localUrl,
      input.width ?? null,
      input.height ?? null,
      input.durationSeconds ?? null
    );
    const row = await getRowById(id);
    if (!row) throw new Error("Uploaded asset was not created.");
    return toPublicAsset(row);
  }

  async getAsset(assetId: string, userId: string, role = "user") {
    const row = await getRowById(assetId);
    if (!row) return null;
    if (row.userId !== userId && role !== "admin") {
      throw Object.assign(new Error("无权访问该素材。"), { status: 403 });
    }
    return toPublicAsset(row);
  }

  async requireAsset(assetId: string, userId: string, role: string, type: AssetType) {
    const asset = await this.getAsset(assetId, userId, role);
    if (!asset) {
      throw Object.assign(new Error("无权访问该素材。"), { status: 404 });
    }
    if (asset.type !== type) {
      throw Object.assign(new Error(type === "image" ? "素材必须是图片。" : "素材必须是视频。"), { status: 400 });
    }
    return {
      ...asset,
      providerUrl: providerUrl(asset.url)
    };
  }
}

export const assetService = new AssetService();
