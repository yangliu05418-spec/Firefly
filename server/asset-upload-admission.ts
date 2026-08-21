import type { MediaObject } from "./db.js";

/** Transported inputs may be listed immediately, but only the worker can advance them to a usable asset. */
export const canCreatePendingAsset = (media: MediaObject | null, ownerId: string): media is MediaObject => Boolean(
  media && media.ownerId === ownerId && media.kind === "input" && ["uploading", "ready"].includes(media.status),
);
