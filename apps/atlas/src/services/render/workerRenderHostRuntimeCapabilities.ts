import type { WorkerRenderHostRuntimeCapabilities } from './workerRenderHostRuntimeCommands';

type RuntimeWorkerCapabilityGlobal = typeof globalThis & {
  navigator?: Navigator & {
    gpu?: {
      requestAdapter?: () => Promise<{
        requestDevice?: () => Promise<{ destroy?: () => void } | null>;
      } | null>;
    };
  };
  VideoDecoder?: {
    new(init: VideoDecoderInit): VideoDecoder;
    isConfigSupported?: unknown;
  };
  VideoFrame?: unknown;
  EncodedVideoChunk?: unknown;
  OffscreenCanvas?: typeof OffscreenCanvas;
  createImageBitmap?: typeof createImageBitmap;
};

function canConstructVideoDecoder(scope: RuntimeWorkerCapabilityGlobal): boolean {
  if (typeof scope.VideoDecoder !== 'function') {
    return false;
  }

  let decoder: VideoDecoder | null = null;
  try {
    decoder = new scope.VideoDecoder({
      output: () => undefined,
      error: () => undefined,
    });
    return true;
  } catch {
    return false;
  } finally {
    try {
      decoder?.close();
    } catch {
      // Ignore close errors from partially constructed platform decoders.
    }
  }
}

async function probeWorkerGpuDevice(scope: RuntimeWorkerCapabilityGlobal): Promise<{
  readonly workerNavigatorGpu: boolean;
  readonly workerWebGpuDevice: boolean;
}> {
  const requestAdapter = scope.navigator?.gpu?.requestAdapter;
  if (typeof requestAdapter !== 'function') {
    return {
      workerNavigatorGpu: false,
      workerWebGpuDevice: false,
    };
  }

  try {
    const adapter = await requestAdapter.call(scope.navigator?.gpu);
    const requestDevice = adapter?.requestDevice;
    if (typeof requestDevice !== 'function') {
      return {
        workerNavigatorGpu: true,
        workerWebGpuDevice: false,
      };
    }
    const device = await requestDevice.call(adapter);
    try {
      device?.destroy?.();
    } catch {
      // Ignore device cleanup errors; capability probing is best effort.
    }
    return {
      workerNavigatorGpu: true,
      workerWebGpuDevice: !!device,
    };
  } catch {
    return {
      workerNavigatorGpu: true,
      workerWebGpuDevice: false,
    };
  }
}

export async function probeRuntimeCapabilities(): Promise<WorkerRenderHostRuntimeCapabilities> {
  const scope = globalThis as RuntimeWorkerCapabilityGlobal;
  const gpu = await probeWorkerGpuDevice(scope);
  const offscreenCanvas = typeof scope.OffscreenCanvas === 'function';
  let offscreenCanvasWebGpuContext = false;
  if (offscreenCanvas) {
    try {
      const CanvasCtor = scope.OffscreenCanvas;
      const canvas = new CanvasCtor(1, 1);
      offscreenCanvasWebGpuContext = !!canvas.getContext('webgpu');
    } catch {
      offscreenCanvasWebGpuContext = false;
    }
  }

  const videoDecoder = typeof scope.VideoDecoder === 'function';
  const videoFrame = typeof scope.VideoFrame !== 'undefined';
  const encodedVideoChunk = typeof scope.EncodedVideoChunk !== 'undefined';
  const videoDecoderConfigSupport =
    videoDecoder &&
    typeof scope.VideoDecoder?.isConfigSupported === 'function';
  const canConstructDecoder = canConstructVideoDecoder(scope);

  return {
    ...gpu,
    offscreenCanvas,
    offscreenCanvasWebGpuContext,
    createImageBitmap: typeof scope.createImageBitmap === 'function',
    videoDecoder,
    videoFrame,
    encodedVideoChunk,
    videoDecoderConfigSupport,
    canConstructVideoDecoder: canConstructDecoder,
    canDecodeVideoInWorker:
      videoDecoder &&
      videoFrame &&
      encodedVideoChunk &&
      canConstructDecoder,
  };
}
