import { describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '../../src/services/aiTools/types';
import {
  handleRunWorkerFirstRealVideoRuntimeSmoke,
  handleRunWorkerFirstRuntimeExportPlaybackSmoke,
  type WorkerFirstRuntimeExportPlaybackSmokeDeps,
} from '../../src/services/aiTools/workerFirstRuntimeExportPlaybackSmoke';

function statsResult(options: {
  readonly startPermissions?: boolean;
  readonly cacheRecords?: number;
  readonly providerRecords?: number;
  readonly schedulerJobs?: number;
} = {}): ToolResult {
  const startPermission = options.startPermissions === true;
  return {
    success: true,
    data: {
      engineReady: true,
      cacheRuntime: {
        records: Array.from({ length: options.cacheRecords ?? 1 }, (_, index) => ({ cacheId: `cache-${index}` })),
      },
      providerRuntime: {
        providers: Array.from({ length: options.providerRecords ?? 2 }, (_, index) => ({ providerId: `provider-${index}` })),
      },
      independentRenderScheduler: {
        jobs: Array.from({ length: options.schedulerJobs ?? 3 }, (_, index) => ({ jobId: `job-${index}` })),
      },
      workerFirstRenderer: {
        w5GateEvidenceMode: 'stats-observation',
        w5Prerequisites: {
          canStartWorkerWebGpu: startPermission,
          canStartWorkerPresentation: false,
          canStartRenderDispatcherCutover: false,
        },
      },
    },
  };
}

function traceResult(): ToolResult {
  return {
    success: true,
    data: {
      playback: {
        status: 'ok',
        previewFrames: 12,
        previewUpdates: 10,
        previewRenderFps: 30,
        previewUpdateFps: 30,
        stalePreviewFrames: 0,
        stalePreviewWhileTargetMoved: 0,
        previewFreezeEvents: 0,
        healthAnomalies: 0,
        previewPathCounts: {
          'worker-only:none': 12,
        },
      },
      workerFirstRenderer: {
        w5GateEvidenceMode: 'stats-observation',
        w5Prerequisites: {
          canStartWorkerWebGpu: false,
          canStartWorkerPresentation: false,
          canStartRenderDispatcherCutover: false,
        },
      },
    },
  };
}

function runDiagnostics(
  source = 'worker-only:none',
  playbackOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const previewPathCounts = playbackOverrides.previewPathCounts ?? {
    [source]: 24,
  };
  return {
    windowMs: 1000,
    wcEventCount: 0,
    vfEventCount: 0,
    startup: {
      firstPreviewFrameMs: 20,
      firstPreviewUpdateMs: 20,
      initialTargetMovedStaleFrames: 0,
      initialTargetMovedStaleMs: 0,
    },
    playback: {
      status: 'ok',
      previewFrames: 24,
      previewUpdates: 22,
      previewRenderFps: 30,
      previewUpdateFps: 30,
      stalePreviewFrames: 0,
      stalePreviewWhileTargetMoved: 0,
      previewFreezeEvents: 0,
      healthAnomalies: 0,
      activeVideos: 2,
      playingVideos: 2,
      seekingVideos: 0,
      worstReadyState: 4,
      previewPathCounts,
      ...playbackOverrides,
    },
  };
}

function createDeps(overrides: Partial<WorkerFirstRuntimeExportPlaybackSmokeDeps> = {}): WorkerFirstRuntimeExportPlaybackSmokeDeps {
  let renderHostMode: ReturnType<NonNullable<WorkerFirstRuntimeExportPlaybackSmokeDeps['getRenderHostDevMode']>> = null;
  return {
    materializeFixture: vi.fn(async () => ({
      success: true,
      data: { projectId: 'solid-text-image', durationSeconds: 2.25 },
    })),
    getStats: vi.fn(async () => statsResult()),
    simulatePlayback: vi.fn(async () => ({
      success: true,
      data: {
        requestedDurationMs: 1000,
        actualDurationMs: 1016,
        initialPosition: 0,
        finalPosition: 1,
        deltaSeconds: 1,
        framesObserved: 60,
        movingFrames: 58,
        stalledFrames: 2,
        longestStallFrames: 1,
        endedPlaying: false,
        renderHostBeforePause: {
          mode: 'worker-only',
          strictWorkerOnly: true,
        },
        runDiagnostics: runDiagnostics(),
      },
    })),
    simulateScrub: vi.fn(async () => ({
      success: true,
      data: {
        pattern: 'custom',
        speed: 'normal',
        requestedDurationMs: 1800,
        durationMs: 1800,
        initialPosition: 0.25,
        finalPosition: 5.25,
        minVisited: 0.25,
        maxVisited: 5.25,
        framesApplied: 90,
        dragMode: 'dom_playhead',
        runDiagnostics: runDiagnostics(),
      },
    })),
    debugExport: vi.fn(async () => ({
      success: true,
      data: {
        elapsedMs: 800,
        timedOut: false,
        blob: { size: 4096, type: 'video/mp4' },
        progressSamples: [{ percent: 0 }, { percent: 100 }],
        exportHostBefore: {
          mode: 'worker-software',
          presentationStrategy: 'worker-software-readback',
          worker: {
            readbackFrameCount: 0,
            fallbackFrameCount: 0,
          },
        },
        exportHostAfter: {
          mode: 'worker-software',
          presentationStrategy: 'worker-software-readback',
          worker: {
            readbackFrameCount: 4,
            fallbackFrameCount: 0,
          },
        },
        errors: [],
      },
    })),
    getPlaybackTrace: vi.fn(async () => traceResult()),
    getRenderHostDevMode: vi.fn(() => renderHostMode),
    setRenderHostDevMode: vi.fn((mode) => {
      renderHostMode = mode;
    }),
    requestRenderFrame: vi.fn(),
    now: (() => {
      let value = 1000;
      return () => value += 25;
    })(),
    ...overrides,
  };
}

describe('worker-first runtime export/playback smoke', () => {
  it('materializes a controlled fixture, runs playback/export, and verifies runtime diagnostics stay observation-only', async () => {
    const deps = createDeps();

    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({
      width: 640,
      height: 360,
      playbackDurationMs: 750,
      exportDurationSeconds: 0.5,
      exportWidth: 160,
      exportHeight: 90,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith({
      resetProject: true,
      width: 640,
      height: 360,
      durationSeconds: 2.25,
    });
    expect(deps.simulatePlayback).toHaveBeenCalledWith(expect.objectContaining({
      startTime: 0,
      durationMs: 750,
      restorePlaybackState: false,
    }));
    expect(deps.debugExport).toHaveBeenCalledWith(expect.objectContaining({
      startTime: 0,
      durationSeconds: 0.5,
      width: 160,
      height: 90,
      includeAudio: false,
      download: false,
    }));
    expect(deps.getStats).toHaveBeenCalledTimes(2);
    expect(deps.getPlaybackTrace).toHaveBeenCalledWith({ windowMs: 5000, limit: 200 });
    expect(deps.setRenderHostDevMode).toHaveBeenNthCalledWith(1, 'worker-only');
    expect(deps.setRenderHostDevMode).toHaveBeenLastCalledWith(null);
    expect(result.data).toMatchObject({
      settings: {
        renderHostMode: 'worker-only',
        previousRenderHostMode: null,
        activeRenderHostMode: 'worker-only',
      },
      checks: {
        playbackSucceeded: true,
        playbackObservedMotion: true,
        exportSucceeded: true,
        exportProducedBlob: true,
        exportUsedWorkerReadback: true,
        exportReadbackObserved: true,
        exportStayedOffMainFallback: true,
        exportHadNoErrors: true,
        runtimeFeedsPresent: true,
        statsStartPermissionsRemainFalse: true,
        traceStartPermissionsRemainFalse: true,
      },
      playback: {
        movingFrames: 58,
      },
      export: {
        blobSize: 4096,
        exportHostMode: 'worker-software',
        exportHostStrategy: 'worker-software-readback',
        workerReadbackFrameCount: 4,
        workerFallbackFrameCount: 0,
        workerReadbackFrameDelta: 4,
        workerFallbackFrameDelta: 0,
        exportErrorCount: 0,
      },
      statsAfter: {
        w5GateEvidenceMode: 'stats-observation',
        canStartWorkerWebGpu: false,
      },
      w5StartPermissionsRemainStatsGuarded: true,
    });
  });

  it('rejects caller-supplied proof or start-permission evidence', async () => {
    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({
      fingerprint: { hash: 'spoof' },
      canStartWorkerWebGpu: true,
    }, createDeps());

    expect(result.success).toBe(false);
    expect(result.error).toContain('caller-supplied proof fields');
    expect(result.data).toMatchObject({
      forbiddenFields: ['fingerprint', 'canStartWorkerWebGpu'],
    });
  });

  it('fails when export evidence or start-permission invariants are not satisfied', async () => {
    const deps = createDeps({
      getStats: vi.fn(async () => statsResult({ startPermissions: true })),
      debugExport: vi.fn(async () => ({
        success: true,
        data: {
          elapsedMs: 100,
          timedOut: false,
          blob: { size: 0, type: 'video/mp4' },
          progressSamples: [],
        },
      })),
    });

    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({}, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('did not satisfy');
    expect(result.data).toMatchObject({
      checks: {
        exportSucceeded: true,
        exportProducedBlob: false,
        statsStartPermissionsRemainFalse: false,
      },
      statsAfter: {
        canStartWorkerWebGpu: true,
      },
    });
  });

  it('fails when export succeeds through the main fallback instead of worker readback', async () => {
    const deps = createDeps({
      debugExport: vi.fn(async () => ({
        success: true,
        data: {
          elapsedMs: 500,
          timedOut: false,
          blob: { size: 4096, type: 'video/webm' },
          progressSamples: [],
          exportHostAfter: {
            mode: 'main',
            presentationStrategy: 'main-host-fallback',
            worker: {
              readbackFrameCount: 0,
              fallbackFrameCount: 1,
            },
          },
          errors: [],
        },
      })),
    });

    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({}, deps);

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      checks: {
        exportSucceeded: true,
        exportProducedBlob: true,
        exportUsedWorkerReadback: false,
        exportReadbackObserved: false,
        exportStayedOffMainFallback: false,
      },
      export: {
        exportHostMode: 'main',
        exportHostStrategy: 'main-host-fallback',
        workerReadbackFrameCount: 0,
        workerFallbackFrameCount: 1,
      },
    });
  });

  it('uses export counter deltas so old fallback history does not fail a clean worker run', async () => {
    const deps = createDeps({
      debugExport: vi.fn(async () => ({
        success: true,
        data: {
          elapsedMs: 500,
          timedOut: false,
          blob: { size: 4096, type: 'video/webm' },
          progressSamples: [],
          exportHostBefore: {
            mode: 'worker-software',
            presentationStrategy: 'worker-software-readback',
            worker: {
              readbackFrameCount: 20,
              fallbackFrameCount: 3,
            },
          },
          exportHostAfter: {
            mode: 'worker-software',
            presentationStrategy: 'worker-software-readback',
            worker: {
              readbackFrameCount: 24,
              fallbackFrameCount: 3,
            },
          },
          errors: [],
        },
      })),
    });

    const result = await handleRunWorkerFirstRuntimeExportPlaybackSmoke({}, deps);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      checks: {
        exportReadbackObserved: true,
        exportStayedOffMainFallback: true,
      },
      export: {
        workerReadbackFrameCount: 24,
        workerFallbackFrameCount: 3,
        workerReadbackFrameDelta: 4,
        workerFallbackFrameDelta: 0,
      },
    });
  });

  it('materializes the multi-video fixture and validates worker-only real-video playback modes', async () => {
    const simulatePlayback = vi.fn(async (playbackArgs: Record<string, unknown>) => {
      const speed = typeof playbackArgs.playbackSpeed === 'number' ? playbackArgs.playbackSpeed : 1;
      const initialPosition = typeof playbackArgs.startTime === 'number' ? playbackArgs.startTime : 0;
      const deltaSeconds = speed < 0 ? -0.7 : 0.45 * speed;
      return {
        success: true,
        data: {
          requestedDurationMs: playbackArgs.durationMs,
          actualDurationMs: playbackArgs.durationMs,
          playbackSpeed: speed,
          initialPosition,
          finalPosition: initialPosition + deltaSeconds,
          deltaSeconds,
          expectedDeltaSeconds: deltaSeconds,
          driftSeconds: 0,
          framesObserved: 30,
          movingFrames: 29,
          stalledFrames: 1,
          longestStallFrames: 1,
          minVisited: Math.min(initialPosition, initialPosition + deltaSeconds),
          maxVisited: Math.max(initialPosition, initialPosition + deltaSeconds),
          maxStepSeconds: Math.abs(deltaSeconds) / 30,
          endedPlaying: false,
          renderHostBeforePause: {
            mode: 'worker-only',
            strictWorkerOnly: true,
          },
          reverseWorkerWebCodecsBeforePause: {
            cachedSourceCount: speed < 0 ? 1 : 0,
            lastStatus: speed < 0 ? 'ready' : null,
          },
          runDiagnostics: runDiagnostics(speed < 0 ? 'worker-only:WebCodecs' : 'worker-only:none'),
        },
      };
    });
    const deps = createDeps({
      materializeFixture: vi.fn(async () => ({
        success: true,
        data: {
          projectId: 'multi-video',
          durationSeconds: 6,
          clipCount: 3,
          videoClipIds: ['video-a', 'video-b', 'video-c'],
        },
      })),
      simulatePlayback,
    });

    const result = await handleRunWorkerFirstRealVideoRuntimeSmoke({
      mediaSettleMs: 0,
      playbackDurationMs: 500,
      fastPlaybackDurationMs: 500,
      reversePlaybackDurationMs: 500,
      scrubDurationMs: 500,
      exportDurationSeconds: 0.5,
      exportWidth: 160,
      exportHeight: 90,
    }, deps);

    expect(result.success).toBe(true);
    expect(deps.materializeFixture).toHaveBeenCalledWith({
      resetProject: true,
      width: 1280,
      height: 720,
      durationSeconds: 6,
    });
    expect(simulatePlayback).toHaveBeenCalledTimes(4);
    expect(simulatePlayback).toHaveBeenCalledWith(expect.objectContaining({ playbackSpeed: 1 }));
    expect(simulatePlayback).toHaveBeenCalledWith(expect.objectContaining({ playbackSpeed: 2 }));
    expect(simulatePlayback).toHaveBeenCalledWith(expect.objectContaining({ playbackSpeed: 3 }));
    expect(simulatePlayback).toHaveBeenCalledWith(expect.objectContaining({ playbackSpeed: -1 }));
    expect(deps.simulateScrub).toHaveBeenCalledWith(expect.objectContaining({
      pattern: 'custom',
      resetDiagnostics: true,
    }));
    expect(deps.requestRenderFrame).toHaveBeenCalledOnce();
    expect(deps.debugExport).toHaveBeenCalledWith(expect.objectContaining({
      exportMode: 'fast',
      includeAudio: false,
      download: false,
    }));
    expect(result.data).toMatchObject({
      checks: {
        fixtureIsRealMultiVideo: true,
        normalPlaybackMovedForward: true,
        speed2PlaybackMovedForward: true,
        speed3PlaybackMovedForward: true,
        reversePlaybackMovedBackward: true,
        reversePlaybackUsedWorkerWebCodecs: true,
        scrubPreviewHealthy: true,
        playbackRunsStayedWorkerOnly: true,
        workerOnlyPreviewEventsObserved: true,
        exportStayedWorkerReadback: true,
      },
      playback: {
        reverse: {
          deltaSeconds: -0.7,
          renderHostModeBeforePause: 'worker-only',
        },
      },
      export: {
        workerReadbackFrameDelta: 4,
        workerFallbackFrameDelta: 0,
      },
    });
  });

  it('fails the real-video smoke when a playback leg reports bad diagnostics', async () => {
    const simulatePlayback = vi.fn(async (playbackArgs: Record<string, unknown>) => {
      const speed = typeof playbackArgs.playbackSpeed === 'number' ? playbackArgs.playbackSpeed : 1;
      const initialPosition = typeof playbackArgs.startTime === 'number' ? playbackArgs.startTime : 0;
      const deltaSeconds = speed < 0 ? -0.7 : 0.45 * speed;
      return {
        success: true,
        data: {
          requestedDurationMs: playbackArgs.durationMs,
          actualDurationMs: playbackArgs.durationMs,
          playbackSpeed: speed,
          initialPosition,
          finalPosition: initialPosition + deltaSeconds,
          deltaSeconds,
          framesObserved: 30,
          movingFrames: 29,
          stalledFrames: 0,
          longestStallFrames: 0,
          renderHostBeforePause: {
            mode: 'worker-only',
            strictWorkerOnly: true,
          },
          reverseWorkerWebCodecsBeforePause: {
            cachedSourceCount: speed < 0 ? 1 : 0,
            lastStatus: speed < 0 ? 'ready' : null,
          },
          runDiagnostics: runDiagnostics(
            speed < 0 ? 'worker-only:WebCodecs' : 'worker-only:none',
            speed < 0
              ? { status: 'bad', previewUpdates: 10, previewUpdateFps: 15 }
              : {}
          ),
        },
      };
    });
    const deps = createDeps({
      materializeFixture: vi.fn(async () => ({
        success: true,
        data: {
          projectId: 'multi-video',
          durationSeconds: 6,
          clipCount: 3,
        },
      })),
      simulatePlayback,
    });

    const result = await handleRunWorkerFirstRealVideoRuntimeSmoke({
      mediaSettleMs: 0,
      playbackDurationMs: 500,
      fastPlaybackDurationMs: 500,
      reversePlaybackDurationMs: 500,
      scrubDurationMs: 500,
      exportDurationSeconds: 0.5,
      exportWidth: 160,
      exportHeight: 90,
    }, deps);

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      checks: {
        reversePlaybackPreviewHealthy: false,
      },
      playback: {
        reverse: {
          runDiagnostics: {
            playbackStatus: 'bad',
          },
        },
      },
    });
  });

  it('allows a warning final playback trace when run-scoped preview checks are healthy', async () => {
    const simulatePlayback = vi.fn(async (playbackArgs: Record<string, unknown>) => {
      const speed = typeof playbackArgs.playbackSpeed === 'number' ? playbackArgs.playbackSpeed : 1;
      const initialPosition = typeof playbackArgs.startTime === 'number' ? playbackArgs.startTime : 0;
      const deltaSeconds = speed < 0 ? -0.7 : 0.45 * speed;
      return {
        success: true,
        data: {
          requestedDurationMs: playbackArgs.durationMs,
          actualDurationMs: playbackArgs.durationMs,
          playbackSpeed: speed,
          initialPosition,
          finalPosition: initialPosition + deltaSeconds,
          deltaSeconds,
          framesObserved: 30,
          movingFrames: 29,
          stalledFrames: 0,
          longestStallFrames: 0,
          renderHostBeforePause: {
            mode: 'worker-only',
            strictWorkerOnly: true,
          },
          reverseWorkerWebCodecsBeforePause: {
            cachedSourceCount: speed < 0 ? 1 : 0,
            lastStatus: speed < 0 ? 'ready' : null,
          },
          runDiagnostics: runDiagnostics(speed < 0 ? 'worker-only:WebCodecs' : 'worker-only:none'),
        },
      };
    });
    const deps = createDeps({
      materializeFixture: vi.fn(async () => ({
        success: true,
        data: {
          projectId: 'multi-video',
          durationSeconds: 6,
          clipCount: 3,
        },
      })),
      simulatePlayback,
      getPlaybackTrace: vi.fn(async () => ({
        success: true,
        data: {
          playback: {
            status: 'warn',
            previewFrames: 30,
            previewUpdates: 20,
            previewRenderFps: 60,
            previewUpdateFps: 18,
            stalePreviewWhileTargetMoved: 0,
            previewFreezeEvents: 0,
            healthAnomalies: 0,
            previewPathCounts: {
              'worker-only:HTMLVideo': 30,
            },
          },
          workerFirstRenderer: {
            w5Prerequisites: {
              canStartWorkerWebGpu: false,
              canStartWorkerPresentation: false,
              canStartRenderDispatcherCutover: false,
            },
          },
        },
      })),
    });

    const result = await handleRunWorkerFirstRealVideoRuntimeSmoke({ mediaSettleMs: 0 }, deps);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      checks: {
        playbackTraceHealthy: true,
      },
      playbackTrace: {
        playbackStatus: 'warn',
      },
    });
  });

  it('fails the real-video smoke when the final playback trace is bad', async () => {
    const deps = createDeps({
      materializeFixture: vi.fn(async () => ({
        success: true,
        data: {
          projectId: 'multi-video',
          durationSeconds: 6,
          clipCount: 3,
        },
      })),
      getPlaybackTrace: vi.fn(async () => ({
        success: true,
        data: {
          playback: {
            status: 'bad',
            previewFrames: 30,
            previewUpdates: 20,
            previewRenderFps: 60,
            previewUpdateFps: 18,
            stalePreviewWhileTargetMoved: 0,
            previewFreezeEvents: 0,
            healthAnomalies: 0,
            previewPathCounts: {
              'worker-only:HTMLVideo': 30,
            },
          },
          workerFirstRenderer: {
            w5Prerequisites: {
              canStartWorkerWebGpu: false,
              canStartWorkerPresentation: false,
              canStartRenderDispatcherCutover: false,
            },
          },
        },
      })),
    });

    const result = await handleRunWorkerFirstRealVideoRuntimeSmoke({ mediaSettleMs: 0 }, deps);

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      checks: {
        playbackTraceHealthy: false,
      },
      playbackTrace: {
        playbackStatus: 'bad',
      },
    });
  });

  it('fails the real-video smoke when preview events are not attributed to worker-only', async () => {
    const deps = createDeps({
      materializeFixture: vi.fn(async () => ({
        success: true,
        data: {
          projectId: 'multi-video',
          durationSeconds: 6,
          clipCount: 3,
        },
      })),
      simulatePlayback: vi.fn(async (playbackArgs: Record<string, unknown>) => {
        const speed = typeof playbackArgs.playbackSpeed === 'number' ? playbackArgs.playbackSpeed : 1;
        const initialPosition = typeof playbackArgs.startTime === 'number' ? playbackArgs.startTime : 0;
        const deltaSeconds = speed < 0 ? -0.7 : 0.7;
        return {
          success: true,
          data: {
            requestedDurationMs: 500,
            actualDurationMs: 500,
            playbackSpeed: speed,
            initialPosition,
            finalPosition: initialPosition + deltaSeconds,
            deltaSeconds,
            framesObserved: 30,
            movingFrames: 29,
            stalledFrames: 1,
            longestStallFrames: 1,
            renderHostBeforePause: {
              mode: 'worker-only',
              strictWorkerOnly: true,
            },
            runDiagnostics: runDiagnostics('worker-presenting:none'),
          },
        };
      }),
      simulateScrub: vi.fn(async () => ({
        success: true,
        data: {
          framesApplied: 60,
          minVisited: 0.25,
          maxVisited: 5.25,
          runDiagnostics: runDiagnostics('worker-presenting:none'),
        },
      })),
      getPlaybackTrace: vi.fn(async () => ({
        success: true,
        data: {
          playback: {
            status: 'ok',
            previewFrames: 12,
            previewUpdates: 12,
            stalePreviewFrames: 0,
            previewFreezeEvents: 0,
            previewPathCounts: {
              'worker-presenting:none': 12,
            },
          },
          workerFirstRenderer: {
            w5Prerequisites: {
              canStartWorkerWebGpu: false,
              canStartWorkerPresentation: false,
              canStartRenderDispatcherCutover: false,
            },
          },
        },
      })),
    });

    const result = await handleRunWorkerFirstRealVideoRuntimeSmoke({ mediaSettleMs: 0 }, deps);

    expect(result.success).toBe(false);
    expect(result.data).toMatchObject({
      checks: {
        workerOnlyPreviewEventsObserved: false,
      },
    });
  });
});
