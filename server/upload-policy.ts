import path from "node:path";

export type UploadKind = "image" | "video" | "audio";

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".tiff": "image/tiff",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

/** Keep TOS object metadata independent from unreliable browser MIME values. */
export const canonicalUploadContentType = (fileName: string, kind: UploadKind) => {
  const contentType = contentTypes[path.extname(fileName).toLowerCase()];
  if (!contentType || !contentType.startsWith(`${kind}/`)) throw new Error("素材类型与文件扩展名不一致");
  return contentType;
};

export const uploadKindFromContentType = (contentType: string): UploadKind => {
  if (contentType.startsWith("video/")) return "video";
  if (contentType.startsWith("audio/")) return "audio";
  return "image";
};

const numberValue = (value: unknown) => Number(value && typeof value === "object" && "value" in value ? (value as { value: unknown }).value : value);
const frameRate = (value: unknown) => {
  const [numerator, denominator = "1"] = String(value ?? "0/1").split("/");
  return Number(denominator) ? Number(numerator) / Number(denominator) : Number(numerator);
};

/** Validate the authoritative metadata returned by TOS image/info or video/info. */
export const tosMediaInfoViolation = (info: unknown, kind: "image" | "video") => {
  if (!info || typeof info !== "object") return "TOS 未返回可识别的媒体信息";
  if (kind === "image") {
    const record = info as { ImageWidth?: unknown; ImageHeight?: unknown };
    const width = numberValue(record.ImageWidth); const height = numberValue(record.ImageHeight); const ratio = width / height;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return "无法识别图片尺寸";
    return width < 300 || width > 6000 || height < 300 || height > 6000 || ratio <= .4 || ratio >= 2.5
      ? "图片尺寸不符合官方要求（300–6000px，宽高比 0.4–2.5）" : undefined;
  }
  const record = info as { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; duration?: string }[]; format?: { duration?: string } };
  const stream = record.streams?.find((item) => item.codec_type === "video");
  if (!stream) return "无法识别视频画面流";
  const width = Number(stream.width); const height = Number(stream.height); const ratio = width / height;
  const fps = frameRate(stream.avg_frame_rate && stream.avg_frame_rate !== "0/0" ? stream.avg_frame_rate : stream.r_frame_rate);
  const duration = Number(stream.duration ?? record.format?.duration ?? 0); const pixels = width * height;
  if (width < 300 || width > 6000 || height < 300 || height > 6000 || ratio < .4 || ratio > 2.5 || pixels < 409600 || pixels > 8295044) return "视频分辨率或宽高比不符合官方要求";
  if (duration < 2 || duration > 30 || fps < 24 || fps > 60) return "视频需为 2–30 秒、24–60 FPS";
  if (!stream.codec_name || !["h264", "hevc"].includes(stream.codec_name.toLowerCase())) return "视频编码仅支持 H.264 或 H.265";
  return undefined;
};
