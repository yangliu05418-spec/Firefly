import type { WorkerRenderSoftwareFrame } from './workerRenderHostRuntimeCommands';

const WORKER_PRESENTING_COMPOSITE_CACHE_FPS = 30;
const WORKER_PRESENTING_MAX_COMPOSITE_FRAMES = 900;
const WORKER_PRESENTING_MAX_COMPOSITE_BYTES = 512 * 1024 * 1024;

interface WorkerPresentingCompositeFrame {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray;
  readonly bytes: number;
}

export interface WorkerPresentingCompositeCacheStats {
  readonly count: number;
  readonly maxFrames: number;
  readonly memoryMB: number;
}

function quantizeCompositeTime(time: number): number {
  return Math.round(time * WORKER_PRESENTING_COMPOSITE_CACHE_FPS) / WORKER_PRESENTING_COMPOSITE_CACHE_FPS;
}

function cloneImageData(imageData: ImageData): ImageData {
  return new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );
}

function imageDataFromFrame(frame: WorkerPresentingCompositeFrame): ImageData | null {
  if (typeof ImageData === 'undefined') return null;
  return new ImageData(
    new Uint8ClampedArray(frame.pixels),
    frame.width,
    frame.height,
  );
}

export class WorkerPresentingCompositeCache {
  private readonly frames = new Map<number, WorkerPresentingCompositeFrame>();
  private bytes = 0;

  cacheReadback(time: number, readback: {
    readonly width: number;
    readonly height: number;
    readonly pixels: Uint8ClampedArray;
  } | null): boolean {
    if (!readback || readback.width <= 0 || readback.height <= 0) return false;
    const key = quantizeCompositeTime(time);
    if (this.frames.has(key)) return true;

    const pixels = new Uint8ClampedArray(readback.pixels);
    const bytes = pixels.byteLength;
    this.frames.set(key, {
      width: readback.width,
      height: readback.height,
      pixels,
      bytes,
    });
    this.bytes += bytes;
    this.evictOverflow();
    return true;
  }

  has(time: number): boolean {
    return this.frames.has(quantizeCompositeTime(time));
  }

  canPresent(time: number): boolean {
    return this.has(time) && typeof createImageBitmap === 'function' && typeof ImageData !== 'undefined';
  }

  get(time: number): ImageData | null {
    const frame = this.frames.get(quantizeCompositeTime(time));
    const imageData = frame ? imageDataFromFrame(frame) : null;
    return imageData ? cloneImageData(imageData) : null;
  }

  clear(): void {
    this.frames.clear();
    this.bytes = 0;
  }

  stats(): WorkerPresentingCompositeCacheStats {
    return {
      count: this.frames.size,
      maxFrames: WORKER_PRESENTING_MAX_COMPOSITE_FRAMES,
      memoryMB: Math.round((this.bytes / (1024 * 1024)) * 100) / 100,
    };
  }

  async createFrame(time: number): Promise<{ frame: WorkerRenderSoftwareFrame; transfer: Transferable[] } | null> {
    const imageData = this.get(time);
    if (!imageData || typeof createImageBitmap !== 'function') return null;
    const bitmap = await createImageBitmap(imageData);
    return {
      frame: {
        size: { x: imageData.width, y: imageData.height },
        layers: [{
          id: `worker-composite-cache:${quantizeCompositeTime(time).toFixed(3)}`,
          visible: true,
          opacity: 1,
          compositeOperation: 'source-over',
          filter: 'none',
          pixelEffects: { brightness: 0 },
          geometry: {
            position: { x: 0, y: 0 },
            scale: { x: 1, y: 1 },
            rotation: 0,
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          },
          source: {
            kind: 'bitmap',
            bitmap,
            width: imageData.width,
            height: imageData.height,
          },
        }],
      },
      transfer: [bitmap],
    };
  }

  private evictOverflow(): void {
    while (
      this.frames.size > WORKER_PRESENTING_MAX_COMPOSITE_FRAMES ||
      this.bytes > WORKER_PRESENTING_MAX_COMPOSITE_BYTES
    ) {
      const oldestKey = this.frames.keys().next().value as number | undefined;
      if (oldestKey === undefined) return;
      const oldest = this.frames.get(oldestKey);
      if (oldest) this.bytes -= oldest.bytes;
      this.frames.delete(oldestKey);
    }
  }
}
