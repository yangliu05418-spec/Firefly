import { registerAacEncoder } from "@mediabunny/aac-encoder";
import { ALL_FORMATS, AppendOnlyStreamTarget, AudioSampleSink, AudioSampleSource, CanvasSource, Input, Mp4OutputFormat, Output, Quality, UrlSource, VideoSampleSink } from "mediabunny";
import type { MontageTimeline } from "../canvas-api";

type ExportAsset = { id: string; mediaUrl: string };
type ExportMessage = { type: "start"; canvasId: string; exportId: string; partSize: number; timeline: MontageTimeline; assets: ExportAsset[] } | { type: "cancel" };
type WorkerPort = { onmessage: ((event: MessageEvent<ExportMessage>) => void) | null; postMessage: (value: unknown) => void };
const port = globalThis as unknown as WorkerPort;
let cancelled = false;

const apiJson = async <T>(url: string, body: unknown): Promise<T> => {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error ?? `导出请求失败 (${response.status})`);
  return response.json();
};

const uploadPart = async (canvasId: string, exportId: string, partNumber: number, data: Uint8Array) => {
  const signed = await apiJson<{ parts: { partNumber: number; url: string }[] }>(`/api/canvases/${encodeURIComponent(canvasId)}/exports/${encodeURIComponent(exportId)}/parts/sign`, { partNumbers: [partNumber] });
  const url = signed.parts[0]?.url;
  if (!url) throw new Error("无法为导出分片生成上传地址");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { method: "PUT", body: new Blob([data.slice().buffer as ArrayBuffer]) });
      if (!response.ok) throw new Error(`导出分片上传失败 (${response.status})`);
      const etag = (response.headers.get("etag") ?? "").replace(/^"|"$/g, "");
      if (!etag) throw new Error("TOS 未返回导出分片 ETag");
      return { partNumber, etag };
    } catch (error) { lastError = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt)); }
  }
  throw lastError;
};

const run = async (message: Extract<ExportMessage, { type: "start" }>) => {
  if (!globalThis.VideoEncoder || !globalThis.VideoDecoder || !globalThis.OffscreenCanvas) throw new Error("当前浏览器不支持画布视频导出，请升级到最新 Chrome 或 Edge");
  registerAacEncoder();
  const assetMap = new Map(message.assets.map((asset) => [asset.id, asset]));
  const inputs = new Map<string, { input: Input<UrlSource>; video: VideoSampleSink; audio?: AudioSampleSink }>();
  const externalAudio = new Map<string, { input: Input<UrlSource>; audio: AudioSampleSink }>();
  for (const clip of message.timeline.video) {
    if (inputs.has(clip.projectAssetId)) continue;
    const asset = assetMap.get(clip.projectAssetId);
    if (!asset) throw new Error("Montage 引用的视频素材不存在");
    const input = new Input({ source: new UrlSource(new URL(asset.mediaUrl, location.origin), { requestInit: { credentials: "same-origin" }, maxCacheSize: 32 * 1024 * 1024, parallelism: 2 }), formats: ALL_FORMATS });
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error("视频素材缺少可解码的视频轨");
    const audioTrack = await input.getPrimaryAudioTrack();
    inputs.set(clip.projectAssetId, { input, video: new VideoSampleSink(videoTrack), audio: audioTrack ? new AudioSampleSink(audioTrack) : undefined });
  }
  for (const clip of message.timeline.audio) {
    if (externalAudio.has(clip.projectAssetId)) continue;
    const asset = assetMap.get(clip.projectAssetId);
    if (!asset) throw new Error("Montage 引用的音频素材不存在");
    const input = new Input({ source: new UrlSource(new URL(asset.mediaUrl, location.origin), { requestInit: { credentials: "same-origin" }, maxCacheSize: 24 * 1024 * 1024, parallelism: 2 }), formats: ALL_FORMATS });
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) throw new Error("音频素材缺少可解码的音频轨");
    externalAudio.set(clip.projectAssetId, { input, audio: new AudioSampleSink(audioTrack) });
  }

  const { width, height, fps } = message.timeline.settings;
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建离屏画布");
  const parts: { partNumber: number; etag: string }[] = [];
  let pending = new Uint8Array(0);
  let bytes = 0;
  const flush = async (force = false) => {
    while (pending.byteLength >= message.partSize || force && pending.byteLength) {
      const size = force ? pending.byteLength : message.partSize;
      const body = pending.slice(0, size);
      pending = pending.slice(size);
      const part = await uploadPart(message.canvasId, message.exportId, parts.length + 1, body);
      parts.push(part); bytes += body.byteLength;
      port.postMessage({ type: "upload", progress: .9 + Math.min(.09, parts.length * .005), bytes, partNumber: part.partNumber });
    }
  };
  const writable = new WritableStream<Uint8Array>({
    async write(chunk) {
      if (cancelled) throw new DOMException("导出已取消", "AbortError");
      const merged = new Uint8Array(pending.byteLength + chunk.byteLength); merged.set(pending); merged.set(chunk, pending.byteLength); pending = merged;
      await flush(false);
    },
    async close() { await flush(true); },
  });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "fragmented", minimumFragmentDuration: 1 }), target: new AppendOnlyStreamTarget(writable) });
  const videoSource = new CanvasSource(canvas, { codec: "avc", bitrate: new Quality("high"), keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });

  const originalAudioClips = message.timeline.audio.length ? [] : message.timeline.video.filter((clip) => !clip.muted && inputs.get(clip.projectAssetId)?.audio);
  const includeAudio = message.timeline.audio.length > 0 || originalAudioClips.length > 0;
  const audioSource = includeAudio ? new AudioSampleSource({ codec: "aac", bitrate: 192_000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  const effectiveDuration = (clip: { durationMs: number; trimStartMs: number; trimEndMs: number }) => clip.durationMs - clip.trimStartMs - clip.trimEndMs;
  const totalMs = Math.max(0, ...message.timeline.video.map((clip) => clip.startMs + effectiveDuration(clip)));
  const totalFrames = Math.ceil(totalMs / 1000 * fps);
  for (let frame = 0; frame < totalFrames; frame += 1) {
    if (cancelled) throw new DOMException("导出已取消", "AbortError");
    const timestamp = frame / fps;
    const timeMs = timestamp * 1000;
    const clip = message.timeline.video.find((item) => timeMs >= item.startMs && timeMs < item.startMs + effectiveDuration(item));
    context.fillStyle = "#000"; context.fillRect(0, 0, width, height);
    if (clip) {
      const source = inputs.get(clip.projectAssetId)!;
      const inputTime = (clip.trimStartMs + timeMs - clip.startMs) / 1000;
      const sample = await source.video.getSample(inputTime);
      if (sample) { sample.drawWithFit(context, { fit: "contain" }); sample.close(); }
    }
    await videoSource.add(timestamp, 1 / fps, { keyFrame: frame % (fps * 2) === 0 });
    if (frame % Math.max(1, Math.round(fps / 4)) === 0) port.postMessage({ type: "progress", progress: Math.min(.88, frame / Math.max(1, totalFrames) * .88) });
  }

  if (audioSource) {
    const audioClips = message.timeline.audio.length ? message.timeline.audio : originalAudioClips;
    for (const clip of [...audioClips].sort((a, b) => a.startMs - b.startMs)) {
      const sink = message.timeline.audio.length ? externalAudio.get(clip.projectAssetId)?.audio : inputs.get(clip.projectAssetId)?.audio;
      if (!sink) continue;
      const start = clip.trimStartMs / 1000;
      const end = start + (clip.durationMs - clip.trimStartMs - clip.trimEndMs) / 1000;
      for await (const sample of sink.samples(start, end)) {
        if (cancelled) { sample.close(); throw new DOMException("导出已取消", "AbortError"); }
        sample.setTimestamp(clip.startMs / 1000 + Math.max(0, sample.timestamp - start));
        await audioSource.add(sample); sample.close();
      }
    }
  }
  await output.finalize();
  for (const source of inputs.values()) source.input.dispose();
  for (const source of externalAudio.values()) source.input.dispose();
  port.postMessage({ type: "complete", parts, bytes });
};

port.onmessage = (event) => {
  if (event.data.type === "cancel") { cancelled = true; return; }
  cancelled = false;
  void run(event.data).catch((error) => port.postMessage({ type: "error", message: error instanceof Error ? error.message : "导出失败", cancelled: error instanceof DOMException && error.name === "AbortError" }));
};
