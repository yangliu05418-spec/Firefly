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
const TOS_IMAGE_INFO_MAX_BYTES = 20 * 1024 * 1024;

/** Deep media inspection runs outside the request path; only a verified row becomes readable by generation. */
export const finalizeQueuedUpload = async (uploadId: string, deps: UploadFinalizationDependencies = defaultDependencies()): Promise<UploadFinalizationResult> => {
  const media = deps.readMedia(`input:${uploadId}`);
  if (!media || media.kind !== "input" || media.status !== "uploading") return { status: "noop" };
  const kind = uploadKindFromContentType(media.contentType);
  try {
    if (kind === "image" && media.size > TOS_IMAGE_INFO_MAX_BYTES) {
      throw new MediaValidationError("图片超过 20MB，已停止处理；请重新上传，Firefly 会在浏览器中自动压缩");
    }
    if (kind === "audio") {
      await deps.validate(deps.signedUrl(media.objectKey, { expires: 900, fileName: media.fileName }), kind);
    } else {
      let info: unknown;
      try { info = await deps.inspect(media.objectKey, kind); }
      catch (error) {
        if ((error as { statusCode?: number }).statusCode === 400) {
          throw new MediaValidationError(`${kind === "image" ? "图片" : "视频"}内容无法被 TOS 解析，请转换格式后重新上传`);
        }
        throw error;
      }
      const violation = tosMediaInfoViolation(info, kind);
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
