import { spawn } from "node:child_process";
import { config } from "./config.js";
import { abortIncompleteUploadsForKey, deleteObject, headObject, signedObjectUrl, streamObjectToTos, transcodeVideoOnTos, verifyProgressiveMp4, type VideoTranscodeObserver } from "./tos.js";
import { withMediaSourceRead } from "./media-source-budget.js";

const serverTranscodeCooldownMs = 15 * 60 * 1000;
let serverTranscodeDisabledUntil = 0;

export const isPermanentTosTranscodeFailure = (message: string) => /assume role access denied/i.test(message);

const transcodePreviewLocally = async (sourceUrl: string, targetKey: string, onPart?: (partNumber: number, bytes: number, requestId?: string) => void) => {
  const maxRate = `${Math.max(500, Math.floor(config.tosPreviewMaxBitrate / 1000))}k`;
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    "-rw_timeout", String(Math.min(config.tosSourceStreamTimeoutMs, 120_000) * 1000),
    "-i", sourceUrl,
    "-map", "0:v:0", "-map", "0:a?",
    "-vf", "scale=w='min(1280,iw)':h=-2",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "24",
    "-maxrate", maxRate, "-bufsize", `${Math.max(1000, Math.floor(config.tosPreviewMaxBitrate / 500))}k`,
    "-pix_fmt", "yuv420p", "-threads", "2",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
    "-frag_duration", "2000000", "-f", "mp4", "pipe:1"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  let stderr = ""; let timedOut = false;
  ffmpeg.stderr.on("data", (chunk: Buffer) => { if (stderr.length < 16_384) stderr += chunk.toString("utf8").slice(0, 16_384 - stderr.length); });
  const timer = setTimeout(() => { timedOut = true; ffmpeg.kill("SIGKILL"); }, config.tosSourceStreamTimeoutMs);
  const completed = new Promise<void>((resolve, reject) => {
    ffmpeg.once("error", reject);
    ffmpeg.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(timedOut ? "预览转码超时" : `预览转码失败 (${code ?? signal ?? "unknown"})${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });

  try {
    const [head] = await Promise.all([
      streamObjectToTos(targetKey, ffmpeg.stdout, "preview.mp4", "video/mp4", onPart, 5 * 1024 * 1024),
      completed
    ]);
    return head;
  } catch (error) {
    if (!ffmpeg.killed) ffmpeg.kill("SIGKILL");
    await deleteObject(targetKey).catch(() => undefined);
    throw error;
  } finally { clearTimeout(timer); }
};

const existingPreview = async (targetKey: string) => {
  let existing: Awaited<ReturnType<typeof headObject>> | null = null;
  try { existing = await headObject(targetKey); }
  catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error; }
  if (!existing) return null;
  try { await verifyProgressiveMp4(targetKey); return existing; }
  catch (error) {
    if (!(error as { message?: string }).message?.startsWith("预览文件不是渐进式 MP4")) throw error;
    await deleteObject(targetKey).catch(() => undefined);
    return null;
  }
};

export const transcodePreviewFromUrl = async (sourceUrl: string, targetKey: string, onPart?: (partNumber: number, bytes: number, requestId?: string) => void) => {
  const existing = await existingPreview(targetKey);
  if (existing) return existing;
  await abortIncompleteUploadsForKey(targetKey);
  return withMediaSourceRead("preview", () => transcodePreviewLocally(sourceUrl, targetKey, onPart));
};

export const transcodePreview = async (sourceKey: string, targetKey: string, onPart?: (partNumber: number, bytes: number, requestId?: string) => void, observer: VideoTranscodeObserver = {}) => {
  const existing = await existingPreview(targetKey);
  if (existing) return existing;
  await abortIncompleteUploadsForKey(targetKey);
  if (Date.now() >= serverTranscodeDisabledUntil) {
    try {
      const head = await transcodeVideoOnTos(sourceKey, targetKey, observer);
      await verifyProgressiveMp4(targetKey);
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
  const sourceUrl = signedObjectUrl(sourceKey, { expires: Math.max(1800, Math.ceil(config.tosSourceStreamTimeoutMs / 1000) + 300), fileName: "source.mp4" });
  return transcodePreviewLocally(sourceUrl, targetKey, onPart);
};
