import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export type PreviewProbe = { duration: number; codec: string; pixelFormat: string; width: number; height: number; bitrate: number; audioCodecs: string[] };

export const probePreviewSource = async (url: string): Promise<PreviewProbe> => {
  let stdout: string;
  try {
    ({ stdout } = await execute("ffprobe", [
      "-v", "error", "-rw_timeout", "15000000", "-show_entries",
      "format=duration,bit_rate:stream=codec_type,codec_name,pix_fmt,width,height,duration,bit_rate",
      "-of", "json", url,
    ], { timeout: 60_000, maxBuffer: 256 * 1024 }));
  } catch {
    // execFile errors contain argv/stderr, including signed source URLs.
    throw Object.assign(new Error("预览媒体完整性探测失败，请稍后重试"), { code: "PREVIEW_PROBE_FAILED" });
  }
  const data = JSON.parse(stdout);
  const video = data.streams?.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const duration = Number(video?.duration ?? data.format?.duration);
  if (!video || !Number.isFinite(duration) || duration <= 0) {
    throw Object.assign(new Error("预览媒体缺少有效视频时长"), { code: "PREVIEW_DURATION_UNKNOWN" });
  }
  return { duration, codec: video.codec_name, pixelFormat: video.pix_fmt, width: Number(video.width), height: Number(video.height),
    bitrate: Number(video.bit_rate ?? data.format?.bit_rate),
    audioCodecs: data.streams.filter((stream: { codec_type: string }) => stream.codec_type === "audio").map((stream: { codec_name: string }) => stream.codec_name) };
};

export const assertPreviewDuration = (source: PreviewProbe, preview: PreviewProbe) => {
  // Compare actual source video duration, not the requested duration (edit and
  // adaptive tasks may legitimately return a different duration).
  if (!Number.isFinite(preview.duration) || Math.abs(source.duration - preview.duration) > .5) {
    throw Object.assign(new Error("兼容预览时长与原片不一致，将重新制作预览"), { code: "PREVIEW_DURATION_MISMATCH" });
  }
  if (preview.codec !== "h264" || preview.pixelFormat !== "yuv420p") {
    throw Object.assign(new Error("兼容预览编码校验失败"), { code: "PREVIEW_CODEC_MISMATCH" });
  }
};

export const canRemuxPreview = (source: PreviewProbe, maxBitrate: number) =>
  source.codec === "h264" && source.pixelFormat === "yuv420p"
  && source.width > 0 && source.height > 0 && Math.max(source.width, source.height) <= 1280
  && source.bitrate > 0 && source.bitrate <= maxBitrate
  && source.audioCodecs.every((codec) => codec === "aac");
