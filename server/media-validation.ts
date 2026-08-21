import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

class Semaphore {
  private readonly queue: (() => void)[] = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  acquire(): Promise<void> {
    if (this.active < this.limit) { this.active += 1; return Promise.resolve(); }
    return new Promise((resolve) => this.queue.push(() => { this.active += 1; resolve(); }));
  }
  release() {
    const next = this.queue.shift();
    if (next) next();
    else this.active -= 1;
  }
}

const ffprobeGate = new Semaphore(3);

export class MediaValidationError extends Error {
  readonly code = "MEDIA_VALIDATION_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "MediaValidationError";
  }
}

const runFfprobe = async (filePath: string) => {
  const startedAt = Date.now();
  try {
    const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate", "-show_entries", "format=duration", "-of", "json", filePath], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
    return { stdout, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    const detail = error as { stderr?: string; killed?: boolean; message?: string };
    const reason = detail.stderr?.trim().slice(0, 300) || detail.message || "ffprobe 无法读取素材";
    if (detail.killed || /http error|server returned|connection|timed? ?out|input\/output error/i.test(reason)) throw new Error(`素材校验暂时不可用：${reason}（耗时 ${Date.now() - startedAt}ms）`);
    throw new MediaValidationError("无法识别素材内容，请检查文件是否损坏或编码是否受支持");
  }
};

/** ffprobe is only used for legacy local files and TOS audio, whose info API is unavailable. */
export const validateMedia = async (filePath: string, type: "image" | "video" | "audio") => {
  await ffprobeGate.acquire();
  let stdout = "";
  try {
    ({ stdout } = await runFfprobe(filePath));
  } finally {
    ffprobeGate.release();
  }
  const probe = JSON.parse(stdout);
  const stream = probe.streams?.find((item: { codec_type: string }) => item.codec_type === (type === "image" ? "video" : type));
  if (!stream) throw new MediaValidationError("无法识别素材内容，请检查文件是否损坏");
  if (type === "image" || type === "video") {
    const { width, height } = stream; const ratio = width / height;
    if (width < 300 || width > 6000 || height < 300 || height > 6000 || ratio <= .4 || ratio >= 2.5) throw new MediaValidationError("图片或视频尺寸不符合官方要求（300–6000px，宽高比 0.4–2.5）");
    if (type === "video") {
      const pixels = width * height; const duration = Number(probe.format?.duration ?? 0); const [a, b] = String(stream.r_frame_rate ?? "0/1").split("/").map(Number); const fps = b ? a / b : a;
      if (pixels < 407696 || pixels > 8295044 || duration < 2 || duration > 30 || fps < 24 || fps > 60) throw new MediaValidationError("视频需为 2–30 秒、24–60 FPS，且分辨率符合官方范围");
      if (!["h264", "hevc"].includes(stream.codec_name)) throw new MediaValidationError("视频编码仅支持 H.264 或 H.265");
    }
  }
  if (type === "audio") {
    const duration = Number(probe.format?.duration ?? 0);
    if (duration < 2 || duration > 30) throw new MediaValidationError("音频时长需为 2–30 秒");
  }
};
