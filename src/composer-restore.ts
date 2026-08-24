import { z } from "zod";
import type { ComposerDraftState } from "./composer-draft-cache";

const assetSchema = z.object({
  id: z.string().min(1), bindingId: z.string().min(1).optional(), uploadId: z.string().optional(),
  assetId: z.string().optional(), snapshotReferenceId: z.string().optional(), name: z.string(),
  type: z.enum(["image", "video", "audio"]), size: z.number().nonnegative(),
  role: z.enum(["reference_image", "reference_video", "reference_audio", "first_frame", "last_frame"]),
  progress: z.number().optional(), phase: z.enum(["preparing", "uploading", "verifying", "ready"]).optional(),
  preview: z.string().optional(), status: z.enum(["Active", "Processing", "Failed"]).optional(), expiresAt: z.number().optional(),
});

const stateSchema = z.object({
  engine: z.enum(["video", "image"]), prompt: z.string(), modelId: z.string(),
  mode: z.enum(["omni", "first_frame", "first_last", "edit", "extend", "text"]),
  ratio: z.string(), resolution: z.string(), duration: z.number().int(), generateAudio: z.boolean(),
  cameraFixed: z.boolean(), watermark: z.boolean(), seed: z.number().int(), imageModelId: z.string(),
  imageRatio: z.string(), imageResolution: z.string(), imageCount: z.number().int().positive(),
  assets: z.array(assetSchema).max(50),
});

const payloadSchema = z.object({
  sourceId: z.string().min(1), sourceType: z.enum(["video", "image"]), sessionId: z.string().optional(),
  snapshotVersion: z.number().int().nonnegative().default(0),
  recoveryQuality: z.enum(["exact", "partial", "unknown"]).default("partial"),
  sourceSessionStatus: z.enum(["active", "deleted", "missing"]).default("missing"),
  omittedAssets: z.number().int().nonnegative(),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), bindingId: z.string().optional(), name: z.string().optional(), type: z.enum(["image", "video", "audio"]).optional() })).default([]),
  adjustments: z.array(z.object({ field: z.string(), requested: z.union([z.string(), z.number()]), effective: z.union([z.string(), z.number()]), reason: z.string() })).default([]),
  state: stateSchema,
});

export type ComposerRestorePayload = z.infer<typeof payloadSchema> & { state: ComposerDraftState };
export type ComposerRestore = ComposerRestorePayload & { nonce: number; restoreIntentId: string; targetSessionId: string };

export const parseComposerRestorePayload = (value: unknown): ComposerRestorePayload => payloadSchema.parse(value) as ComposerRestorePayload;
