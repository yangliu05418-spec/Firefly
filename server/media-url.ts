import crypto from "node:crypto";
import { config } from "./config.js";
import type { MediaObject } from "./db.js";
import { redis } from "./redis.js";
import { signedObjectUrl } from "./tos.js";

/**
 * 素材引用统一入口：所有"上传素材 → 可访问地址"的解析只允许走这里，
 * 避免 TOS 签名与 legacy 媒体路由两条链路混用（P0-4）。
 * - inputs/、assets/ 或 Atlas 已校验导出前缀（TOS）→ 签名 URL
 * - legacy/ 前缀（本地存储，仅开发/自托管）→ HMAC 媒体路由（与 /api/uploads/:id/complete 一致）
 */
export const resolveUploadMediaUrl = async (media: Pick<MediaObject, "objectKey" | "uploadId" | "fileName">, expiresSeconds = 24 * 3600): Promise<string> => {
  // Keep this list narrow: these prefixes are written only after Firefly has
  // verified the owning user's object. Atlas exports are permanent user
  // assets and must be signable for just-in-time ModelArk registration.
  const trustedTosPrefixes = ["inputs/", "assets/", "atlas/exports/"];
  if (trustedTosPrefixes.some((prefix) => media.objectKey.startsWith(prefix))) {
    return signedObjectUrl(media.objectKey, { expires: expiresSeconds, fileName: media.fileName });
  }
  if (media.objectKey.startsWith("legacy/") && media.uploadId) {
    const origin = new URL(config.origin);
    if (["localhost", "127.0.0.1", "::1"].includes(origin.hostname)) {
      throw new Error("本地存储后端无法向素材服务提供可访问地址：请配置公网 PUBLIC_ORIGIN，或启用 TOS 存储（MEDIA_STORAGE_BACKEND=tos）");
    }
    const raw = await redis.get(`upload:${media.uploadId}`);
    if (!raw) throw new Error("上传素材已过期，无法生成可访问地址");
    const meta = JSON.parse(raw) as { mediaExpiresAt?: number; name?: string };
    if (!meta.mediaExpiresAt || meta.name !== media.fileName) throw new Error("上传素材元数据不一致，无法生成可访问地址");
    const token = crypto.createHmac("sha256", config.sessionSecret).update(`${media.uploadId}:${media.fileName}:${meta.mediaExpiresAt}`).digest("base64url");
    return `${config.origin}/media/${encodeURIComponent(media.uploadId)}/${encodeURIComponent(media.fileName)}?expires=${meta.mediaExpiresAt}&token=${token}`;
  }
  throw new Error("素材存储位置无法解析为可访问地址");
};
