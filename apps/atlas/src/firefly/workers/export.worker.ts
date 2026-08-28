/// <reference lib="webworker" />

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource,
  VideoSampleSink,
  type AudioSample as MediaAudioSample,
  type StreamTargetChunk,
  type VideoSample,
} from 'mediabunny';
import type { AtlasClip, AtlasDocument, AtlasTrack, MediaKind } from '../model';

interface WorkerAsset {
  id: string;
  kind: MediaKind;
  blob?: Blob;
  url?: string;
}

interface StartMessage {
  type: 'start';
  document: AtlasDocument;
  assets: WorkerAsset[];
  width: number;
  height: number;
  fps: number;
  partSize: number;
}

interface AckMessage {
  type: 'ack';
  chunkId: number;
  error?: string;
}

interface CancelMessage { type: 'cancel' }

type IncomingMessage = StartMessage | AckMessage | CancelMessage;

interface VideoRuntime {
  clip: AtlasClip;
  iterator: AsyncIterator<VideoSample | null>;
  input: Input;
}

interface VisualFrameLayer {
  clip: AtlasClip;
  role: 'single' | 'outgoing' | 'incoming';
  transition: AtlasClip['transitionIn'];
  transitionProgress: number;
  transitionOwnerId?: string;
}

interface AudioRuntime {
  clip: AtlasClip;
  iterator: AsyncIterator<MediaAudioSample>;
  pending: MediaAudioSample | null;
  input: Input;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;
let cancelled = false;
let activeOutput: Output | null = null;
let chunkSequence = 0;
const pendingAcks = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();

worker.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  if (message.type === 'ack') {
    const pending = pendingAcks.get(message.chunkId);
    if (!pending) return;
    pendingAcks.delete(message.chunkId);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve();
    return;
  }
  if (message.type === 'cancel') {
    cancelled = true;
    pendingAcks.forEach((pending) => pending.reject(new Error('导出已取消')));
    pendingAcks.clear();
    void activeOutput?.cancel();
    return;
  }
  cancelled = false;
  void runExport(message).catch((error) => {
    const raw = error instanceof Error ? error.message : String(error);
    worker.postMessage({
      type: 'error',
      message: /[\u3400-\u9fff]/u.test(raw) ? raw : '导出引擎处理素材失败，请检查媒体编码后重试',
    });
  });
};

async function runExport(message: StartMessage): Promise<void> {
  const { document, width, height, fps, partSize } = message;
  const duration = document.clips.reduce((maximum, clip) => Math.max(maximum, clip.startTime + clip.duration), 0);
  if (duration <= 0) throw new Error('时间线为空，请先添加素材');
  if (duration > 10 * 60) throw new Error('首版导出最长支持10分钟');
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 1920 || height > 1080) {
    throw new Error('首版导出最高支持1920×1080');
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) throw new Error('首版导出最高支持30fps');
  const assetBlobs = new Map(message.assets.map((asset) => [asset.id, asset]));
  const trackOrder = new Map(document.tracks.map((track, index) => [track.id, index]));
  const imageBitmaps = new Map<string, ImageBitmap>();
  const inputs: Input[] = [];
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('当前浏览器无法创建离屏画布，请升级Chrome或Edge');

  const videoRuntimes = await createVideoRuntimes(document, assetBlobs, fps, inputs);
  const transitionVideoRuntimes = await createTransitionVideoRuntimes(document, assetBlobs, fps, inputs);
  const audioRuntimes = await createAudioRuntimes(document, assetBlobs, inputs);
  const outputTarget = new StreamTarget(new WritableStream<StreamTargetChunk>({
    async write(chunk) {
      if (cancelled) throw new Error('导出已取消');
      const chunkId = chunkSequence++;
      const copy = chunk.data.slice();
      await new Promise<void>((resolve, reject) => {
        pendingAcks.set(chunkId, { resolve, reject });
        worker.postMessage({ type: 'chunk', chunkId, position: chunk.position, data: copy.buffer }, [copy.buffer]);
      });
    },
  }), { chunked: true, chunkSize: partSize });
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'fragmented' }), target: outputTarget });
  activeOutput = output;
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: width >= 1920 ? 8_000_000 : 5_000_000,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioRuntimes.length ? new AudioSampleSource({ codec: 'aac', bitrate: 192_000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  try {
    await output.start();
    const frameCount = Math.ceil(duration * fps);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      if (cancelled) throw new Error('导出已取消');
      const time = frameIndex / fps;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, width, height);
      const active = document.clips
        .filter((clip) => {
          const asset = assetBlobs.get(clip.assetId);
          return asset && asset.kind !== 'audio' && time >= clip.startTime && time < clip.startTime + clip.duration;
        })
        .sort((a, b) => (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0));
      const layers = active.flatMap<VisualFrameLayer>((clip) => {
        const transitionDuration = clip.transitionDuration ?? 0;
        const elapsed = time - clip.startTime;
        if (clip.transitionIn === 'none' || !clip.transitionFromClipId || transitionDuration <= 0 || elapsed < 0 || elapsed >= transitionDuration) {
          return [{ clip, role: 'single' as const, transition: 'none' as const, transitionProgress: 1 }];
        }
        const outgoing = document.clips.find((candidate) => candidate.id === clip.transitionFromClipId && candidate.trackId === clip.trackId);
        if (!outgoing || Math.abs(outgoing.startTime + outgoing.duration - clip.startTime) > 0.01) {
          return [{ clip, role: 'single' as const, transition: 'none' as const, transitionProgress: 1 }];
        }
        const transitionProgress = Math.max(0, Math.min(1, elapsed / transitionDuration));
        return [
          { clip: outgoing, role: 'outgoing' as const, transition: clip.transitionIn, transitionProgress, transitionOwnerId: clip.id },
          { clip, role: 'incoming' as const, transition: clip.transitionIn, transitionProgress, transitionOwnerId: clip.id },
        ];
      });
      for (const layer of layers) {
        const { clip } = layer;
        const asset = assetBlobs.get(clip.assetId);
        if (!asset) continue;
        if (asset.kind === 'image') {
          let bitmap = imageBitmaps.get(asset.id);
          if (!bitmap) {
            if (!asset.blob) throw new Error(`图片素材不可用：${clip.name}`);
            bitmap = await createImageBitmap(asset.blob);
            imageBitmaps.set(asset.id, bitmap);
          }
          drawVisual(context, bitmap, clip, time, width, height, layer.role, layer.transition, layer.transitionProgress);
        } else {
          const runtime = layer.role === 'outgoing'
            ? transitionVideoRuntimes.get(layer.transitionOwnerId ?? '')
            : videoRuntimes.get(clip.id);
          const result = runtime ? await runtime.iterator.next() : null;
          const sample = result && !result.done ? result.value : null;
          if (sample) {
            drawVisual(context, sample, clip, time, width, height, layer.role, layer.transition, layer.transitionProgress);
            sample.close();
          }
        }
      }
      await videoSource.add(time, 1 / fps, { keyFrame: frameIndex % (fps * 2) === 0 });
      if (frameIndex % Math.max(1, Math.floor(fps / 2)) === 0) {
        worker.postMessage({ type: 'progress', phase: 'encoding', progress: Math.round((frameIndex / frameCount) * 78) });
      }
    }
    videoSource.close();

    if (audioSource) {
      await encodeMixedAudio(audioRuntimes, document.tracks, duration, audioSource);
      audioSource.close();
    }
    worker.postMessage({ type: 'progress', phase: 'finalizing', progress: 92 });
    await output.finalize();
    worker.postMessage({ type: 'done' });
  } finally {
    activeOutput = null;
    imageBitmaps.forEach((bitmap) => bitmap.close());
    for (const runtime of videoRuntimes.values()) await runtime.iterator.return?.();
    for (const runtime of transitionVideoRuntimes.values()) await runtime.iterator.return?.();
    for (const runtime of audioRuntimes) {
      runtime.pending?.close();
      await runtime.iterator.return?.();
    }
    inputs.forEach((input) => input.dispose());
  }
}

async function createTransitionVideoRuntimes(
  document: AtlasDocument,
  assets: Map<string, WorkerAsset>,
  fps: number,
  inputs: Input[],
): Promise<Map<string, VideoRuntime>> {
  const result = new Map<string, VideoRuntime>();
  for (const incoming of document.clips) {
    const transitionDuration = incoming.transitionDuration ?? 0;
    if (incoming.transitionIn === 'none' || !incoming.transitionFromClipId || transitionDuration <= 0) continue;
    const outgoing = document.clips.find((clip) => clip.id === incoming.transitionFromClipId && clip.trackId === incoming.trackId);
    const asset = outgoing ? assets.get(outgoing.assetId) : undefined;
    if (!outgoing || !asset || asset.kind !== 'video' || Math.abs(outgoing.startTime + outgoing.duration - incoming.startTime) > 0.01) continue;
    const input = new Input({ formats: ALL_FORMATS, source: mediaSource(asset, 16 * 1024 * 1024) });
    inputs.push(input);
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`浏览器无法解码视频：${outgoing.name}`);
    const sink = new VideoSampleSink(track);
    const timestamps = function* () {
      const count = Math.max(1, Math.ceil(transitionDuration * fps));
      const start = Math.max(outgoing.inPoint, outgoing.outPoint - transitionDuration);
      for (let index = 0; index < count; index += 1) yield Math.min(outgoing.outPoint, start + index / fps);
    };
    result.set(incoming.id, { clip: outgoing, input, iterator: sink.samplesAtTimestamps(timestamps())[Symbol.asyncIterator]() });
  }
  return result;
}

async function createVideoRuntimes(
  document: AtlasDocument,
  assets: Map<string, WorkerAsset>,
  fps: number,
  inputs: Input[],
): Promise<Map<string, VideoRuntime>> {
  const result = new Map<string, VideoRuntime>();
  for (const clip of document.clips) {
    const asset = assets.get(clip.assetId);
    if (!asset || asset.kind !== 'video') continue;
    const input = new Input({ formats: ALL_FORMATS, source: mediaSource(asset, 16 * 1024 * 1024) });
    inputs.push(input);
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) throw new Error(`浏览器无法解码视频：${clip.name}`);
    const sink = new VideoSampleSink(track);
    const timestamps = function* () {
      const count = Math.ceil(clip.duration * fps);
      for (let index = 0; index < count; index += 1) yield clip.inPoint + index / fps;
    };
    result.set(clip.id, { clip, input, iterator: sink.samplesAtTimestamps(timestamps())[Symbol.asyncIterator]() });
  }
  return result;
}

async function createAudioRuntimes(
  document: AtlasDocument,
  assets: Map<string, WorkerAsset>,
  inputs: Input[],
): Promise<AudioRuntime[]> {
  const result: AudioRuntime[] = [];
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  for (const clip of document.clips) {
    const asset = assets.get(clip.assetId);
    const trackState = tracks.get(clip.trackId);
    if (!asset || asset.kind === 'image' || clip.muted || trackState?.muted) continue;
    const input = new Input({ formats: ALL_FORMATS, source: mediaSource(asset, 8 * 1024 * 1024) });
    inputs.push(input);
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) {
      input.dispose();
      continue;
    }
    const sink = new AudioSampleSink(track);
    const iterator = sink.samples(clip.inPoint, clip.outPoint)[Symbol.asyncIterator]();
    const first = await iterator.next();
    result.push({ clip, input, iterator, pending: first.done ? null : first.value });
  }
  return result;
}

function mediaSource(asset: WorkerAsset, maxCacheSize: number) {
  if (asset.blob) return new BlobSource(asset.blob, { maxCacheSize });
  if (asset.url) return new UrlSource(asset.url, {
    requestInit: { credentials: 'same-origin' },
    maxCacheSize,
    parallelism: 2,
    getRetryDelay: (attempt) => attempt < 3 ? 2 ** attempt : null,
  });
  throw new Error(`媒体源不可用：${asset.id}`);
}

function drawVisual(
  context: OffscreenCanvasRenderingContext2D,
  source: ImageBitmap | VideoSample,
  clip: AtlasClip,
  timelineTime: number,
  width: number,
  height: number,
  role: VisualFrameLayer['role'] = 'single',
  transition: AtlasClip['transitionIn'] = 'none',
  explicitTransitionProgress?: number,
) {
  const sourceWidth = source instanceof ImageBitmap ? source.width : source.displayWidth;
  const sourceHeight = source instanceof ImageBitmap ? source.height : source.displayHeight;
  const fit = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * fit * clip.transform.scaleX;
  const drawHeight = sourceHeight * fit * clip.transform.scaleY;
  const x = (width - drawWidth) / 2 + clip.transform.x;
  const y = (height - drawHeight) / 2 + clip.transform.y;
  const transitionProgress = explicitTransitionProgress ?? Math.min(1, Math.max(0, (timelineTime - clip.startTime) / (clip.transitionDuration ?? 0.35)));
  context.save();
  context.translate(width / 2, height / 2);
  context.rotate(clip.transform.rotation * Math.PI / 180);
  context.translate(-width / 2, -height / 2);
  context.globalAlpha = clip.transform.opacity;
  if (role === 'outgoing' && transition === 'crossfade') context.globalAlpha *= 1 - transitionProgress;
  if (role === 'outgoing' && transition === 'dip-black') context.globalAlpha *= Math.max(0, 1 - transitionProgress * 2);
  if (role === 'incoming' && transition === 'crossfade') context.globalAlpha *= transitionProgress;
  if (role === 'incoming' && transition === 'dip-black') context.globalAlpha *= Math.max(0, transitionProgress * 2 - 1);
  if (role === 'incoming' && transition.startsWith('wipe-')) {
    const p = transitionProgress;
    if (clip.transitionIn === 'wipe-left') context.rect(width * (1 - p), 0, width * p, height);
    if (clip.transitionIn === 'wipe-right') context.rect(0, 0, width * p, height);
    if (clip.transitionIn === 'wipe-up') context.rect(0, height * (1 - p), width, height * p);
    if (clip.transitionIn === 'wipe-down') context.rect(0, 0, width, height * p);
    context.clip();
  }
  if (source instanceof ImageBitmap) context.drawImage(source, x, y, drawWidth, drawHeight);
  else source.draw(context, x, y, drawWidth, drawHeight);
  context.restore();
}

async function encodeMixedAudio(
  runtimes: AudioRuntime[],
  tracks: AtlasTrack[],
  duration: number,
  source: AudioSampleSource,
) {
  const sampleRate = 48_000;
  const trackMap = new Map(tracks.map((track) => [track.id, track]));
  for (let blockStart = 0; blockStart < duration; blockStart += 1) {
    if (cancelled) throw new Error('导出已取消');
    const blockEnd = Math.min(duration, blockStart + 1);
    const frames = Math.max(1, Math.ceil((blockEnd - blockStart) * sampleRate));
    const mixed = new Float32Array(frames * 2);
    for (const runtime of runtimes) {
      const clip = runtime.clip;
      if (clip.muted || trackMap.get(clip.trackId)?.muted) continue;
      const overlapStart = Math.max(blockStart, clip.startTime);
      const overlapEnd = Math.min(blockEnd, clip.startTime + clip.duration);
      if (overlapEnd <= overlapStart) continue;
      const sourceStart = clip.inPoint + overlapStart - clip.startTime;
      const sourceEnd = clip.inPoint + overlapEnd - clip.startTime;
      while (runtime.pending && runtime.pending.timestamp + runtime.pending.duration <= sourceStart) await advanceAudio(runtime);
      while (runtime.pending && runtime.pending.timestamp < sourceEnd) {
        mixSample(mixed, runtime.pending, clip, blockStart, sourceStart, sourceEnd, sampleRate);
        if (runtime.pending.timestamp + runtime.pending.duration <= sourceEnd) await advanceAudio(runtime);
        else break;
      }
    }
    const sample = new AudioSample({
      data: mixed,
      format: 'f32',
      numberOfChannels: 2,
      sampleRate,
      timestamp: blockStart,
    });
    await source.add(sample);
    sample.close();
    worker.postMessage({ type: 'progress', phase: 'encoding', progress: 78 + Math.round((blockEnd / duration) * 12) });
  }
}

async function advanceAudio(runtime: AudioRuntime) {
  runtime.pending?.close();
  const next = await runtime.iterator.next();
  runtime.pending = next.done ? null : next.value;
}

function mixSample(
  target: Float32Array,
  sample: MediaAudioSample,
  clip: AtlasClip,
  blockStart: number,
  requestedSourceStart: number,
  requestedSourceEnd: number,
  outputRate: number,
) {
  const mixStart = Math.max(sample.timestamp, requestedSourceStart);
  const mixEnd = Math.min(sample.timestamp + sample.duration, requestedSourceEnd);
  if (mixEnd <= mixStart) return;
  const sourceOffset = Math.max(0, Math.floor((mixStart - sample.timestamp) * sample.sampleRate));
  const sourceFrames = Math.max(1, Math.min(sample.numberOfFrames - sourceOffset, Math.ceil((mixEnd - mixStart) * sample.sampleRate)));
  const channels = Array.from({ length: Math.min(2, sample.numberOfChannels) }, (_, channel) => {
    const plane = new Float32Array(sourceFrames);
    sample.copyTo(plane, { planeIndex: channel, format: 'f32-planar', frameOffset: sourceOffset, frameCount: sourceFrames });
    return plane;
  });
  const outputFrames = Math.max(1, Math.ceil((mixEnd - mixStart) * outputRate));
  const outputOffset = Math.max(0, Math.round((clip.startTime + mixStart - clip.inPoint - blockStart) * outputRate));
  for (let frame = 0; frame < outputFrames && outputOffset + frame < target.length / 2; frame += 1) {
    const sourceIndex = Math.min(sourceFrames - 1, Math.floor(frame * sample.sampleRate / outputRate));
    const left = channels[0]?.[sourceIndex] ?? 0;
    const right = channels[1]?.[sourceIndex] ?? left;
    const gain = clip.volume;
    target[(outputOffset + frame) * 2] = Math.max(-1, Math.min(1, target[(outputOffset + frame) * 2] + left * gain));
    target[(outputOffset + frame) * 2 + 1] = Math.max(-1, Math.min(1, target[(outputOffset + frame) * 2 + 1] + right * gain));
  }
}
