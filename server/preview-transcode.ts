import { spawn } from "node:child_process";
import { config } from "./config.js";
import { abortIncompleteUploadsForKey, deleteObject, headObject, signedObjectUrl, streamObjectToTos, transcodeVideoOnTos, verifyProgressiveMp4, type VideoTranscodeObserver } from "./tos.js";

export const transcodePreview = async (sourceKey: string, targetKey: string, onPart?: (partNumber: number, bytes: number, requestId?: string) => void, observer: VideoTranscodeObserver = {}) => {
  let existing: Awaited<ReturnType<typeof headObject>> | null = null;
  try { existing = await headObject(targetKey); }
  catch (error) { if ((error as { statusCode?: number }).statusCode !== 404) throw error; }
  if (existing) {
    try { await verifyProgressiveMp4(targetKey); return existing; }
    catch (error) {
      if (!(error as { message?: string }).message?.startsWith("预览文件不是渐进式 MP4")) throw error;
      await deleteObject(targetKey).catch(() => undefined);
    }
  }
  await abortIncompleteUploadsForKey(targetKey);
  try {
    const head = await transcodeVideoOnTos(sourceKey, targetKey, observer);
    await verifyProgressiveMp4(targetKey);
    return head;
  } catch (error) {
    observer.stateChanged?.("fallback", "worker_multipart", -1, error instanceof Error ? error.message : "TOS 服务端转码失败");
    await deleteObject(targetKey).catch(() => undefined);
  }
  const sourceUrl = signedObjectUrl(sourceKey, { expires: Math.max(1800, Math.ceil(config.tosSourceStreamTimeoutMs / 1000) + 300), fileName: "source.mp4" });
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
      // Preview generation crosses AWS -> TOS Beijing. Keep parts at TOS's 5 MiB
      // minimum so a slow international upload still completes within the SDK's
      // per-request hard timeout. The normal browser upload path remains 16 MiB.
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
