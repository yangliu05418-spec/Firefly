import type { MediaObject } from "./db.js";
import { MediaValidationError, validateMedia } from "./media-validation.js";
import { deleteObject, inspectMediaObject, signedObjectUrl } from "./tos.js";
import { tosMediaInfoViolation, uploadKindFromContentType } from "./upload-policy.js";
import { users } from "./store.js";

export type UploadFinalizationDependencies = {
  readMedia: (id: string) => MediaObject | null;
  markReady: (id: string) => unknown;
  markDeleted: (id: string) => unknown;
  inspect: typeof inspectMediaObject;
  validate: typeof validateMedia;
  signedUrl: typeof signedObjectUrl;
  deleteObject: typeof deleteObject;
};

let productionDependencies: UploadFinalizationDependencies | undefined;
const defaultDependencies = () => productionDependencies ??= {
  readMedia: (id) => users.readMedia(id),
  markReady: (id) => users.markUploadReady(id),
  markDeleted: (id) => users.markMediaDeleted(id),
  inspect: inspectMediaObject,
  validate: validateMedia,
  signedUrl: signedObjectUrl,
  deleteObject
};

export type UploadFinalizationResult = { status: "ready" } | { status: "failed"; error: string } | { status: "noop" };

/** Deep media inspection runs outside the request path; only a verified row becomes readable by generation. */
export const finalizeQueuedUpload = async (uploadId: string, deps: UploadFinalizationDependencies = defaultDependencies()): Promise<UploadFinalizationResult> => {
  const media = deps.readMedia(`input:${uploadId}`);
  if (!media || media.kind !== "input" || media.status !== "uploading") return { status: "noop" };
  const kind = uploadKindFromContentType(media.contentType);
  try {
    if (kind === "audio") {
      await deps.validate(deps.signedUrl(media.objectKey, { expires: 900, fileName: media.fileName }), kind);
    } else {
      const violation = tosMediaInfoViolation(await deps.inspect(media.objectKey, kind), kind);
      if (violation) throw new MediaValidationError(violation);
    }
    deps.markReady(media.id);
    console.info(JSON.stringify({ type: "tos_upload_finalized", at: new Date().toISOString(), uploadId, userId: media.ownerId, kind }));
    return { status: "ready" };
  } catch (error) {
    if (!(error instanceof MediaValidationError)) throw error;
    try { await deps.deleteObject(media.objectKey); }
    catch (deleteError) { if ((deleteError as { statusCode?: number }).statusCode !== 404) throw deleteError; }
    deps.markDeleted(media.id);
    const message = error.message.slice(0, 300);
    console.warn(JSON.stringify({ type: "tos_upload_rejected", at: new Date().toISOString(), uploadId, userId: media.ownerId, kind, code: error.code, message }));
    return { status: "failed", error: message };
  }
};
