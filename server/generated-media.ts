import crypto from "node:crypto";
import { users, type MediaObject } from "./db.js";
import { putObjectBuffer, shard, signedObjectUrl } from "./tos.js";

/**
 * OpenRouter 生成图片的持久化（长期保留，独立于 inputs/ 生命周期）：
 * TOS key: generated/{shard}/{ownerId}/{mediaId}.png
 * 只存稳定 mediaId 引用，渲染经 /api/image-media/:id 换取签名地址（铁律同画布）。
 */

export const generatedObjectKey = (ownerId: string, mediaId: string, extension: string) =>
  `generated/${shard(mediaId)}/${ownerId}/${mediaId}.${extension.replace(/^\./, "")}`;

export const storeGeneratedImage = async (input: { ownerId: string; body: Buffer; contentType: string; fileName: string }): Promise<MediaObject> => {
  const mediaId = "gen-" + crypto.randomUUID();
  const extension = (input.contentType.includes("png") ? "png" : input.contentType.includes("webp") ? "webp" : input.contentType.includes("jpeg") || input.contentType.includes("jpg") ? "jpg" : "png");
  const objectKey = generatedObjectKey(input.ownerId, mediaId, extension);
  const stored = await putObjectBuffer(objectKey, input.body, input.contentType);
  const now = Date.now();
  const media: MediaObject = {
    id: mediaId, ownerId: input.ownerId, kind: "generated", objectKey, status: "ready",
    fileName: input.fileName || ("image." + extension), contentType: input.contentType,
    size: stored.size, etag: stored.etag, createdAt: now, updatedAt: now,
  };
  users.upsertMedia(media);
  return media;
};
