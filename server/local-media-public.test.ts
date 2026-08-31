import { describe, expect, it } from "vitest";
import { publicLocalMedia, publicLocalMediaFromSource } from "./local-media-public.js";
import type { MediaObject } from "./db.js";

const media = {
  id: "media-1", ownerId: "owner-1", taskId: "task-1", kind: "preview", objectKey: "outputs/a/video.mp4",
  fileName: "video.mp4", contentType: "video/mp4", size: 8_000_000, etag: "etag-1", status: "ready",
  createdAt: 1, updatedAt: 2,
} as MediaObject;

describe("local media public descriptors", () => {
  it("keeps content identity stable when the protected route changes", () => {
    const first = publicLocalMedia(media, { variant: "preview", url: "/api/generations/one/media", cachePolicy: "warm" });
    const second = publicLocalMedia(media, { variant: "preview", url: "/api/generations/one/media?rev=3", cachePolicy: "warm" });
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.revision).toBe(first.revision);
    expect(second.url).not.toBe(first.url);
  });

  it("separates preview, original and transformed thumbnail bytes", () => {
    const preview = publicLocalMedia(media, { variant: "preview", url: "/preview", cachePolicy: "warm" });
    const original = publicLocalMedia(media, { variant: "original", url: "/original", cachePolicy: "on-demand" });
    const thumbnail = publicLocalMedia(media, { variant: "thumbnail", url: "/thumbnail", cachePolicy: "warm", transform: "image/resize,w_640/format,webp" });
    expect(new Set([preview.cacheKey, original.cacheKey, thumbnail.cacheKey]).size).toBe(3);
    expect(thumbnail.contentType).toBe("image/webp");
    expect(thumbnail.size).toBeUndefined();
  });

  it("deduplicates copied sources when the caller supplies one stable source identity", () => {
    const input = { sourceId: "content-etag-1", revision: "etag-1:8000000", variant: "preview" as const, mediaType: "video" as const, contentType: "video/mp4", size: 8_000_000, url: "/one", cachePolicy: "pin" as const };
    const first = publicLocalMediaFromSource(input);
    const second = publicLocalMediaFromSource({ ...input, url: "/two" });
    expect(second.cacheKey).toBe(first.cacheKey);
    expect(second.revision).toBe(first.revision);
  });

  it("deduplicates byte-identical media records across product copies", () => {
    const copied = { ...media, id: "atlas-copy", objectKey: "atlas/assets/copy.mp4" };
    const studio = publicLocalMedia(media, { variant: "preview", url: "/studio", cachePolicy: "warm" });
    const atlas = publicLocalMedia(copied, { variant: "preview", url: "/atlas", cachePolicy: "pin" });
    expect(atlas.cacheKey).toBe(studio.cacheKey);
    expect(atlas.revision).toBe(studio.revision);
    const imported = publicLocalMediaFromSource({
      sourceId: copied.objectKey,
      revision: `${copied.etag}\0${copied.size}\0${copied.contentType}\0identity`,
      variant: "preview",
      mediaType: "video",
      contentType: copied.contentType,
      size: copied.size,
      url: "/atlas-import",
      cachePolicy: "pin",
    });
    expect(imported.cacheKey).toBe(studio.cacheKey);
    expect(imported.revision).toBe(studio.revision);
  });
});
