import type { MediaObject } from "./db.js";

/** Transported inputs may be listed immediately, but only the worker can advance them to a usable asset. */
export const canCreatePendingAsset = (media: MediaObject | null, ownerId: string, inputRetentionDays = 7, now = Date.now()): media is MediaObject => Boolean(
  media && media.ownerId === ownerId && media.kind === "input" && ["uploading", "ready"].includes(media.status)
  && (!media.objectKey.startsWith("inputs/") || now - media.createdAt < inputRetentionDays * 24 * 60 * 60 * 1000),
);

export class UploadReferencePendingError extends Error {
  readonly code = "UPLOAD_REFERENCE_PENDING";
  constructor(name = "参考素材") {
    super(`${name}已上传，正在完成内容校验`);
    this.name = "UploadReferencePendingError";
  }
}

export const REFERENCE_PREPARATION_DEADLINE_MS = 30 * 60 * 1000;
export const canKeepPreparingReference = (createdAt: number, now = Date.now()) => now - createdAt < REFERENCE_PREPARATION_DEADLINE_MS;
