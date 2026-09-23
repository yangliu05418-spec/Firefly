import { spawn } from "node:child_process";
import { config } from "./config.js";
import { abortIncompleteUploadsForKey, deleteObject, headObject, signedObjectUrl, streamObjectToTos, transcodeVideoOnTos, verifyProgressiveMp4, type VideoTranscodeObserver } from "./tos.js";
import { withMediaSourceRead } from "./media-source-budget.js";
import { assertPreviewDuration, canRemuxPreview, probePreviewSource, type PreviewProbe } from "./preview-integrity.js";

const serverTranscodeCooldownMs = 15 * 60 * 1000;
let serverTranscodeDisabledUntil = 0;

export const isPermanentTosTranscodeFailure = (message: string) => /assume role access denied/i.test(message);

const validatePreview = async (targetKey: string, source: PreviewProbe) => {
  await verifyProgressiveMp4(targetKey);
  const preview = await probePreviewSource(signedObjectUrl(targetKey, { expires: 300, fileName: "preview.mp4" }));
  assertPreviewDuration(source, preview);
  console.info(JSON.stringify({ type: "tos_preview_integrity_verified", sourceDuration: source.duration, previewDuration: preview.duration, codec: preview.codec }));
};

const transcodePreviewLocally = async (sourceUrl: string, targetKey: string, source: PreviewProbe, onPart?: (partNumber: number, bytes: number, requestId?: string) => void) => {
  const controller = new AbortController();
  const remux = canRemuxPreview(source, config.tosPreviewMaxBitrate);
  console.info(JSON.stringify({ type: "tos_preview_strategy", strategy: remux ? "remux" : "encode", sourceDuration: source.duration, sourceCodec: source.codec }));
  const maxRate = `${Math.max(500, Math.floor(config.tosPreviewMaxBitrate / 1000))}k`;
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-rw_timeout", String(Math.min(config.tosSourceStreamTimeoutMs, 120_000) * 1000),
    "-i", sourceUrl,
    "-map", "0:v:0", "-map", "0:a:0?",
    ...(remux ? ["-c", "copy"] : [
    "-vf", "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
    "-maxrate", maxRate, "-bufsize", `${Math.max(1000, Math.floor(config.tosPreviewMaxBitrate / 500))}k`,
    "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "128k"]),
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-frag_duration", "2000000", "-f", "mp4", "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let timedOut = false;
  ffmpeg.stderr.resume();
  ffmpeg.stdout.on("error", () => undefined); // Also observed by the upload iterator.
  const timer = setTimeout(() => { timedOut = true; ffmpeg.kill("SIGKILL"); }, config.tosSourceStreamTimeoutMs);
  const completed = new Promise<void>((resolve, reject) => {
    ffmpeg.once("error", reject);
    ffmpeg.once("close", (code, signal) => {
      if (code === 0) resolve();
      // Never propagate stderr: FFmpeg includes signed input URLs in errors.
      else reject(Object.assign(new Error(timedOut ? "预览转码超时" : `预览转码失败 (${code ?? signal ?? "unknown"})`), { code: timedOut ? "PREVIEW_TRANSCODE_TIMEOUT" : "PREVIEW_TRANSCODE_FAILED" }));
    });
  });

  void completed.catch((error) => { controller.abort(error); ffmpeg.stdout.destroy(error); });
  const uploading = streamObjectToTos(targetKey, ffmpeg.stdout, "preview.mp4", "video/mp4", onPart, 5 * 1024 * 1024, {
    signal: controller.signal, beforeComplete: () => completed,
  });
  try {
    const [head] = await Promise.all([uploading, completed]);
    await validatePreview(targetKey, source);
    return head;
  } catch (error) {
    controller.abort(error);
    if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
    ffmpeg.stdout.destroy();
    // Settle all producers before deleting. Otherwise a late Complete can
    // resurrect the incomplete object after cleanup (production case 007c…).
    await Promise.allSettled([uploading, completed]);
    await deleteObject(targetKey).catch(() => undefined);
    throw error;
  } finally { clearTimeout(timer); }
};

const existingPreview = async (targetKey: string, source: PreviewProbe) => {
  let existing: Awaited<ReturnType<typeof headObject>> | null = null;
  try { existing = await headObject(targetKey); }
  catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error; }
  if (!existing) return null;
  try { await validatePreview(targetKey, source); return existing; }
  catch (error) {
    if (!(error as { message?: string }).message?.startsWith("预览文件不是渐进式 MP4")
      && !["PREVIEW_DURATION_MISMATCH", "PREVIEW_CODEC_MISMATCH", "PREVIEW_DURATION_UNKNOWN"].includes(String((error as { code?: string }).code))) throw error;
    await deleteObject(targetKey);
    return null;
  }
};

export const transcodePreviewFromUrl = async (sourceUrl: string, targetKey: string, onPart?: (partNumber: number, bytes: number, requestId?: string) => void) => {
  return withMediaSourceRead("preview", async () => {
    const source = await probePreviewSource(sourceUrl);
    const existing = await existingPreview(targetKey, source);
    if (existing) return existing;
    await abortIncompleteUploadsForKey(targetKey);
    return transcodePreviewLocally(sourceUrl, targetKey, source, onPart);
  });
};

export const transcodePreview = async (sourceKey: string, targetKey: string, onPart?: (partNumber: number, bytes: number, requestId?: string) => void, observer: VideoTranscodeObserver = {}) => {
  const sourceUrl = signedObjectUrl(sourceKey, { expires: Math.max(1800, Math.ceil(config.tosSourceStreamTimeoutMs / 1000) + 300), fileName: "source.mp4" });
  const source = await probePreviewSource(sourceUrl);
  const existing = await existingPreview(targetKey, source);
  if (existing) return existing;
  await abortIncompleteUploadsForKey(targetKey);
  if (canRemuxPreview(source, config.tosPreviewMaxBitrate)) return transcodePreviewLocally(sourceUrl, targetKey, source, onPart);
  if (Date.now() >= serverTranscodeDisabledUntil) {
    try {
      const head = await transcodeVideoOnTos(sourceKey, targetKey, observer);
      await validatePreview(targetKey, source);
      serverTranscodeDisabledUntil = 0;
      return head;
    } catch (error) {
      const message = error instanceof Error ? error.message : "TOS 服务端转码失败";
      // A missing TOS processing role cannot recover by retrying every job. Skip
      // the known-broken control-plane path until the worker is restarted after
      // its IAM configuration has been corrected.
      if (isPermanentTosTranscodeFailure(message)) serverTranscodeDisabledUntil = Number.POSITIVE_INFINITY;
      else serverTranscodeDisabledUntil = Date.now() + serverTranscodeCooldownMs;
      observer.stateChanged?.("fallback", "worker_multipart", -1, message);
      await deleteObject(targetKey).catch(() => undefined);
    }
  } else {
    observer.stateChanged?.("fallback", "worker_multipart", -1, "TOS 服务端转码权限冷却中，直接使用本地流式快启转码");
  }
  return transcodePreviewLocally(sourceUrl, targetKey, source, onPart);
};
