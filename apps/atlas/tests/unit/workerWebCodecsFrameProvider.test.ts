import { describe, expect, it, vi } from 'vitest';

import type { WorkerRenderHostRuntimeBridge } from '../../src/services/render/workerRenderHostRuntimeBridge';
import type { WorkerRenderHostRuntimeJobOutput } from '../../src/services/render/workerRenderHostRuntimeHandlers';
import type { WorkerRenderHostWebCodecsResult } from '../../src/services/render/workerRenderHostRuntimeCommands';
import { WorkerWebCodecsFrameProvider } from '../../src/services/mediaRuntime/workerWebCodecsFrameProvider';

function bitmap(width = 16, height = 9): ImageBitmap {
  return {
    width,
    height,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

function webCodecsResult(
  sourceId: string,
  frame: ImageBitmap | null,
  timestampSeconds = 0,
): WorkerRenderHostWebCodecsResult {
  return {
    status: {
      sourceId,
      ready: true,
      width: frame?.width ?? 16,
      height: frame?.height ?? 9,
      frameRate: 30,
      currentTime: timestampSeconds,
      hasFrame: frame !== null,
      pendingSeekTime: null,
      decodePending: false,
    },
    frame: frame
      ? {
          sourceId,
          bitmap: frame,
          width: frame.width,
          height: frame.height,
          timestampSeconds,
        }
      : null,
  };
}

function outputFor(webCodecs: WorkerRenderHostWebCodecsResult | null): WorkerRenderHostRuntimeJobOutput {
  return {
    accepted: true,
    commandType: 'readWebCodecsFrame',
    initialized: true,
    rendererId: 'test',
    strategy: 'worker-cpu-present',
    targetIds: [],
    scheduler: {
      running: [],
      queueDepth: 0,
      counters: {
        admitted: 0,
        rejected: 0,
        enqueued: 0,
        coalesced: 0,
        started: 0,
        completed: 0,
        cancelled: 0,
        failed: 0,
      },
      oldestQueuedMs: null,
    },
    cache: {
      entries: 0,
      totalBytes: 0,
      byOwner: {},
      byResourceKind: {},
      evictions: 0,
      sequence: 0,
    },
    statusEvents: [],
    transferLatencyMs: null,
    providerWaitMs: null,
    presentedFrameId: null,
    capabilities: null,
    webCodecs,
    readback: null,
  };
}

function createProvider(bridge: Partial<WorkerRenderHostRuntimeBridge>) {
  return new WorkerWebCodecsFrameProvider({
    sourceId: 'source-a',
    file: {
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    } as unknown as File,
    bridge: bridge as WorkerRenderHostRuntimeBridge,
  });
}

describe('WorkerWebCodecsFrameProvider', () => {
  it('loads a worker-decoded frame and exposes it through the runtime provider shape', async () => {
    const firstFrame = bitmap();
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', firstFrame, 1))),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);

    await provider.load();

    expect(bridge.loadWebCodecsSource).toHaveBeenCalledOnce();
    expect(provider.isFullMode()).toBe(true);
    expect(provider.hasFrame()).toBe(true);
    expect(provider.getCurrentFrame()).toBe(firstFrame);
    expect(provider.currentTime).toBe(1);

    provider.destroy();
    expect(bridge.disposeWebCodecsSource).toHaveBeenCalledOnce();
  });

  it('coalesces scrub reads and does not apply stale worker frames over the latest target', async () => {
    const initialFrame = bitmap();
    const staleFrame = bitmap();
    const latestFrame = bitmap();
    let resolveFirst!: (value: WorkerRenderHostRuntimeJobOutput) => void;
    let resolveSecond!: (value: WorkerRenderHostRuntimeJobOutput) => void;
    const firstRead = new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRead = new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
      resolveSecond = resolve;
    });
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn()
        .mockReturnValueOnce(firstRead)
        .mockReturnValueOnce(secondRead),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.scrubSeek(1);
    provider.scrubSeek(2);
    expect(bridge.readWebCodecsFrame).toHaveBeenCalledTimes(1);

    resolveFirst(outputFor(webCodecsResult('source-a', staleFrame, 1)));
    await vi.waitFor(() => {
      expect(bridge.readWebCodecsFrame).toHaveBeenCalledTimes(2);
    });
    resolveSecond(outputFor(webCodecsResult('source-a', latestFrame, 2)));

    await vi.waitFor(() => {
      expect(provider.getCurrentFrame()).toBe(latestFrame);
    });
    expect(staleFrame.close).toHaveBeenCalledOnce();
    expect(initialFrame.close).toHaveBeenCalledOnce();
    expect(provider.currentTime).toBe(2);
  });

  it('sends interactive scrub seeks to the worker WebCodecs runtime', async () => {
    const initialFrame = bitmap();
    const scrubFrame = bitmap();
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn(async () => outputFor(webCodecsResult('source-a', scrubFrame, 1.25))),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.scrubSeek(1.25);

    await vi.waitFor(() => {
      expect(provider.getCurrentFrame()).toBe(scrubFrame);
    });
    expect(bridge.readWebCodecsFrame).toHaveBeenCalledWith(
      expect.any(String),
      'source-a',
      1.25,
      'scrub',
      140
    );
  });

  it('sends playback advance requests to the worker WebCodecs runtime', async () => {
    const initialFrame = bitmap();
    const advancedFrame = bitmap();
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn(async () => outputFor(webCodecsResult('source-a', advancedFrame, 1.5))),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.advanceToTime(1.5);

    await vi.waitFor(() => {
      expect(provider.getCurrentFrame()).toBe(advancedFrame);
    });
    expect(bridge.readWebCodecsFrame).toHaveBeenCalledWith(
      expect.any(String),
      'source-a',
      1.5,
      'advance',
      80
    );
    expect(provider.isPlaying).toBe(true);
  });

  it('does not apply an in-flight playback advance after pause', async () => {
    const initialFrame = bitmap();
    const staleAdvanceFrame = bitmap();
    let resolveAdvance!: (value: WorkerRenderHostRuntimeJobOutput) => void;
    const advanceRead = new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
      resolveAdvance = resolve;
    });
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn(async () => advanceRead),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.advanceToTime(1.5);
    expect(bridge.readWebCodecsFrame).toHaveBeenCalledTimes(1);

    provider.pause();
    resolveAdvance(outputFor(webCodecsResult('source-a', staleAdvanceFrame, 1.5)));

    await vi.waitFor(() => {
      expect(staleAdvanceFrame.close).toHaveBeenCalledOnce();
    });
    expect(provider.isPlaying).toBe(false);
    expect(provider.getCurrentFrame()).toBe(initialFrame);
    expect(provider.getPendingSeekTime()).toBeNull();
    expect(provider.currentTime).toBe(0);
  });

  it('sends reverse playback requests without using drag-scrub latest-wins semantics', async () => {
    const initialFrame = bitmap();
    const reverseFrame = bitmap();
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn(async () => outputFor(webCodecsResult('source-a', reverseFrame, 1.5))),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.advanceReverseToTime(1.5);

    await vi.waitFor(() => {
      expect(provider.getCurrentFrame()).toBe(reverseFrame);
    });
    expect(bridge.readWebCodecsFrame).toHaveBeenCalledWith(
      expect.any(String),
      'source-a',
      1.5,
      'reverse',
      1000
    );
    expect(provider.isPlaying).toBe(true);
  });

  it('applies intermediate advance frames while a newer playback target is queued', async () => {
    const initialFrame = bitmap();
    const intermediateFrame = bitmap();
    const latestFrame = bitmap();
    let resolveFirst!: (value: WorkerRenderHostRuntimeJobOutput) => void;
    let resolveSecond!: (value: WorkerRenderHostRuntimeJobOutput) => void;
    const firstRead = new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRead = new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
      resolveSecond = resolve;
    });
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn()
        .mockReturnValueOnce(firstRead)
        .mockReturnValueOnce(secondRead),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.advanceToTime(1);
    provider.advanceToTime(2);
    expect(bridge.readWebCodecsFrame).toHaveBeenCalledTimes(1);

    resolveFirst(outputFor(webCodecsResult('source-a', intermediateFrame, 1)));

    await vi.waitFor(() => {
      expect(provider.getPendingSeekTime()).toBe(2);
    });
    expect(provider.getCurrentFrame()).toBeNull();
    expect(intermediateFrame.close).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(bridge.readWebCodecsFrame).toHaveBeenCalledTimes(2);
    });
    resolveSecond(outputFor(webCodecsResult('source-a', latestFrame, 2)));

    await vi.waitFor(() => {
      expect(provider.getCurrentFrame()).toBe(latestFrame);
    });
    expect(provider.getPendingSeekTime()).toBeNull();
    expect(intermediateFrame.close).toHaveBeenCalledOnce();
    expect(initialFrame.close).toHaveBeenCalledOnce();
    expect(provider.currentTime).toBe(2);
  });

  it('applies intermediate reverse frames while a newer playback target is queued', async () => {
    const initialFrame = bitmap();
    const intermediateFrame = bitmap();
    const latestFrame = bitmap();
    let resolveFirst!: (value: WorkerRenderHostRuntimeJobOutput) => void;
    let resolveSecond!: (value: WorkerRenderHostRuntimeJobOutput) => void;
    const firstRead = new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
      resolveFirst = resolve;
    });
    const secondRead = new Promise<WorkerRenderHostRuntimeJobOutput>((resolve) => {
      resolveSecond = resolve;
    });
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn()
        .mockReturnValueOnce(firstRead)
        .mockReturnValueOnce(secondRead),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.advanceReverseToTime(2);
    provider.advanceReverseToTime(1);
    expect(bridge.readWebCodecsFrame).toHaveBeenCalledTimes(1);

    resolveFirst(outputFor(webCodecsResult('source-a', intermediateFrame, 1.95)));

    await vi.waitFor(() => {
      expect(provider.getPendingSeekTime()).toBe(1);
    });
    expect(provider.getCurrentFrame()).toBe(intermediateFrame);
    expect(intermediateFrame.close).not.toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(bridge.readWebCodecsFrame).toHaveBeenCalledTimes(2);
    });
    resolveSecond(outputFor(webCodecsResult('source-a', latestFrame, 1)));

    await vi.waitFor(() => {
      expect(provider.getCurrentFrame()).toBe(latestFrame);
    });
    expect(provider.getPendingSeekTime()).toBeNull();
    expect(intermediateFrame.close).toHaveBeenCalledOnce();
    expect(initialFrame.close).toHaveBeenCalledOnce();
    expect(provider.currentTime).toBe(1);
  });

  it('does not apply reverse worker frames that are far from the requested time', async () => {
    const initialFrame = bitmap();
    const staleReverseFrame = bitmap();
    const bridge = {
      loadWebCodecsSource: vi.fn(async () => outputFor(webCodecsResult('source-a', initialFrame, 0))),
      readWebCodecsFrame: vi.fn(async () => outputFor(webCodecsResult('source-a', staleReverseFrame, 0.5))),
      disposeWebCodecsSource: vi.fn(async () => outputFor(null)),
    };
    const provider = createProvider(bridge);
    await provider.load();

    provider.advanceReverseToTime(1.5);

    await vi.waitFor(() => {
      expect(staleReverseFrame.close).toHaveBeenCalledOnce();
    });
    expect(initialFrame.close).toHaveBeenCalledOnce();
    expect(provider.getCurrentFrame()).toBeNull();
    expect(provider.getPendingSeekTime()).toBe(1.5);
  });

});
