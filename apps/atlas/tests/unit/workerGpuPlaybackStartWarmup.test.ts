import { describe, expect, it, vi } from 'vitest';
import type { RenderHostPort } from '../../src/services/render/renderHostTypes';
import type { TimelineClip } from '../../src/types/timeline';
import {
  hasWorkerGpuPlaybackStartVideoSource,
  isWorkerGpuPlaybackStartFrameReady,
  shouldWarmWorkerGpuForwardPlaybackStart,
  waitForWorkerGpuPlaybackStartFrame,
} from '../../src/services/timeline/workerGpuPlaybackStartWarmup';

type TestHost = Pick<RenderHostPort, 'getTelemetry' | 'requestNewFrameRender'>;

function createHost(input: {
  readonly mode?: ReturnType<RenderHostPort['getTelemetry']>['mode'];
  readonly diagnostics?: Record<string, unknown>;
} = {}): TestHost & { readonly requestNewFrameRender: ReturnType<typeof vi.fn> } {
  return {
    requestNewFrameRender: vi.fn(),
    getTelemetry: vi.fn(() => ({
      mode: input.mode ?? 'worker-gpu-only',
      diagnostics: { strictWorkerOnly: true, ...(input.diagnostics ?? {}) },
    }) as ReturnType<RenderHostPort['getTelemetry']>),
  };
}

function makeClip(source: TimelineClip['source'], fileType = ''): TimelineClip {
  return {
    source,
    file: { type: fileType } as File,
  } as TimelineClip;
}

describe('workerGpuPlaybackStartWarmup', () => {
  it('detects video clips that can block worker GPU playback startup', () => {
    expect(hasWorkerGpuPlaybackStartVideoSource(makeClip({ type: 'video' }))).toBe(true);
    expect(hasWorkerGpuPlaybackStartVideoSource(makeClip({ type: 'audio' }, 'video/mp4'))).toBe(true);
    expect(hasWorkerGpuPlaybackStartVideoSource(makeClip({ type: 'audio' }, 'audio/wav'))).toBe(false);
    expect(hasWorkerGpuPlaybackStartVideoSource(makeClip(null, ''))).toBe(false);
  });

  it('warms only normal forward worker GPU playback with video at the start', () => {
    expect(shouldWarmWorkerGpuForwardPlaybackStart({
      hasVideoAtPlaybackStart: true,
      playbackSpeed: 1,
      host: createHost(),
    })).toBe(true);
    expect(shouldWarmWorkerGpuForwardPlaybackStart({
      hasVideoAtPlaybackStart: false,
      playbackSpeed: 1,
      host: createHost(),
    })).toBe(false);
    expect(shouldWarmWorkerGpuForwardPlaybackStart({
      hasVideoAtPlaybackStart: true,
      playbackSpeed: 2,
      host: createHost(),
    })).toBe(false);
    expect(shouldWarmWorkerGpuForwardPlaybackStart({
      hasVideoAtPlaybackStart: true,
      playbackSpeed: 1,
      host: createHost({ mode: 'main' }),
    })).toBe(false);
  });

  it('accepts a presented worker GPU frame near the playback start target', () => {
    const host = createHost({
      diagnostics: {
        lastGpuOnlyVideoFrameTimestampSeconds: 6.01,
        lastGpuOnlyVideoFrameSourceFrameRate: 60,
      },
    });

    expect(isWorkerGpuPlaybackStartFrameReady({ targetTime: 6, host })).toBe(true);
  });

  it('rejects a stale timestamp when the latest worker GPU read was not presented', () => {
    const host = createHost({
      diagnostics: {
        lastGpuOnlyVideoFrameTimestampSeconds: 6,
        lastGpuOnlyVideoFrameSourceFrameRate: 60,
        lastGpuOnlyVideoFrameStats: {
          'workerGpu.videoFrame.presented': false,
          'workerGpu.videoFrame.decodePending': true,
          'workerGpu.videoFrame.targetMediaTime': 6,
        },
      },
    });

    expect(isWorkerGpuPlaybackStartFrameReady({ targetTime: 6, host })).toBe(false);
  });

  it('rejects a near timestamp while a worker GPU stream start is pending', () => {
    const host = createHost({
      diagnostics: {
        pendingGpuStreamStartCount: 1,
        lastGpuOnlyVideoFrameTimestampSeconds: 6,
        lastGpuOnlyVideoFrameSourceFrameRate: 60,
        lastGpuOnlyVideoFrameStats: {
          'workerGpu.videoFrame.presented': true,
          'workerGpu.videoFrame.mode': 'seek',
        },
      },
    });

    expect(isWorkerGpuPlaybackStartFrameReady({ targetTime: 6, host })).toBe(false);
  });

  it('rejects an active worker GPU stream until it has presented a full stream frame', () => {
    const host = createHost({
      diagnostics: {
        pendingGpuStreamStartCount: 0,
        lastGpuOnlyVideoFrameTimestampSeconds: 6,
        lastGpuOnlyVideoFrameSourceFrameRate: 60,
        lastGpuOnlyVideoFrameStats: {
          'workerGpu.videoFrame.presented': true,
          'workerGpu.videoFrame.streaming': true,
          'workerGpu.videoFrame.workerStream.active': true,
          'workerGpu.videoFrame.workerStream.presentedFrameCount': 0,
        },
      },
    });

    expect(isWorkerGpuPlaybackStartFrameReady({ targetTime: 6, host })).toBe(false);
  });

  it('rejects a near timestamp while worker GPU video sources are still loading', () => {
    const host = createHost({
      diagnostics: {
        pendingGpuVideoSourceLoadCount: 2,
        lastGpuOnlyVideoFrameTimestampSeconds: 6,
        lastGpuOnlyVideoFrameSourceFrameRate: 60,
        lastGpuOnlyVideoFrameStats: {
          'workerGpu.videoFrame.presented': true,
          'workerGpu.videoFrame.mode': 'seek',
        },
      },
    });

    expect(isWorkerGpuPlaybackStartFrameReady({ targetTime: 6, host })).toBe(false);
  });

  it('rejects a stale presented worker GPU frame at playback start', () => {
    const host = createHost({
      diagnostics: {
        lastGpuOnlyVideoFrameTimestampSeconds: 5.9,
        lastGpuOnlyVideoFrameSourceFrameRate: 60,
      },
    });

    expect(isWorkerGpuPlaybackStartFrameReady({ targetTime: 6, host })).toBe(false);
  });

  it('accepts a close hot-resume frame while the worker GPU decoder is still draining', () => {
    const host = createHost({
      diagnostics: {
        lastGpuOnlyVideoFrameTimestampSeconds: 6 - (2 / 60),
        lastGpuOnlyVideoFrameSourceFrameRate: 60,
        lastGpuOnlyVideoFrameStats: {
          'workerGpu.videoFrame.decodePending': true,
          'workerGpu.videoFrame.pendingSeekKind': 'seek',
        },
      },
    });

    expect(isWorkerGpuPlaybackStartFrameReady({ targetTime: 6, host })).toBe(true);
  });

  it('requests paused renders until the worker GPU start frame is ready', async () => {
    const diagnostics = {
      lastGpuOnlyVideoFrameTimestampSeconds: 1,
      lastGpuOnlyVideoFrameSourceFrameRate: 60,
    };
    const host = createHost({ diagnostics });
    let nowMs = 0;
    const waitForFrame = vi.fn(async () => {
      nowMs += 16;
      if (nowMs >= 32) {
        diagnostics.lastGpuOnlyVideoFrameTimestampSeconds = 6;
      }
    });

    await expect(waitForWorkerGpuPlaybackStartFrame({
      targetTime: 6,
      playbackSpeed: 1,
      timeoutMs: 100,
      host,
      waitForFrame,
      now: () => nowMs,
    })).resolves.toBe(true);

    expect(host.requestNewFrameRender).toHaveBeenCalledTimes(2);
  });

  it('times out instead of starting an unbounded warmup loop', async () => {
    const diagnostics = {
      lastGpuOnlyVideoFrameTimestampSeconds: 1,
      lastGpuOnlyVideoFrameSourceFrameRate: 60,
    };
    const host = createHost({ diagnostics });
    let nowMs = 0;
    const waitForFrame = vi.fn(async () => {
      nowMs += 75;
    });

    await expect(waitForWorkerGpuPlaybackStartFrame({
      targetTime: 6,
      playbackSpeed: 1,
      timeoutMs: 100,
      host,
      waitForFrame,
      now: () => nowMs,
    })).resolves.toBe(false);

    expect(host.requestNewFrameRender).toHaveBeenCalledTimes(2);
  });

  it('keeps warming beyond one frame when the existing worker GPU frame is stale', async () => {
    const diagnostics = {
      lastGpuOnlyVideoFrameTimestampSeconds: 5.5,
      lastGpuOnlyVideoFrameSourceFrameRate: 60,
    };
    const host = createHost({ diagnostics });
    let nowMs = 0;
    const waitForFrame = vi.fn(async () => {
      nowMs += 16;
    });

    await expect(waitForWorkerGpuPlaybackStartFrame({
      targetTime: 6,
      playbackSpeed: 1,
      host,
      waitForFrame,
      now: () => nowMs,
    })).resolves.toBe(false);

    expect(host.requestNewFrameRender.mock.calls.length).toBeGreaterThan(1);
  });

  it('extends warmup while cold worker GPU video source loads are pending', async () => {
    const diagnostics = {
      pendingGpuVideoSourceLoadCount: 0,
      lastGpuOnlyVideoFrameTimestampSeconds: null,
      lastGpuOnlyVideoFrameSourceFrameRate: 60,
      lastGpuOnlyVideoFrameStats: {
        'workerGpu.videoFrame.presented': false,
      },
    };
    const host = createHost({ diagnostics });
    let nowMs = 0;
    const waitForFrame = vi.fn(async () => {
      nowMs += 200;
      if (nowMs < 800) {
        diagnostics.pendingGpuVideoSourceLoadCount = 2;
        return;
      }
      diagnostics.pendingGpuVideoSourceLoadCount = 0;
      diagnostics.lastGpuOnlyVideoFrameTimestampSeconds = 6;
      diagnostics.lastGpuOnlyVideoFrameStats = {
        'workerGpu.videoFrame.presented': true,
        'workerGpu.videoFrame.mode': 'seek',
      };
    });

    await expect(waitForWorkerGpuPlaybackStartFrame({
      targetTime: 6,
      playbackSpeed: 1,
      host,
      waitForFrame,
      now: () => nowMs,
    })).resolves.toBe(true);

    expect(host.requestNewFrameRender.mock.calls.length).toBeGreaterThan(2);
  });
});
