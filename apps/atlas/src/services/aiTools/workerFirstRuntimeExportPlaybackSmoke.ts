import { useTimelineStore } from '../../stores/timeline';
import { FrameExporter } from '../../engine/export';
import type { ToolResult } from './types';
import { handleDebugExport } from './handlers/export';
import { handleSimulatePlayback, handleSimulateScrub } from './handlers/playback';
import { handleGetPlaybackTrace, handleGetStats } from './handlers/stats';
import { materializeWorkerFirstMultiVideoFixture } from './workerFirstMultiVideoGoldenFixture';
import { materializeWorkerFirstSolidTextImageFixture } from './workerFirstSolidTextImageGoldenFixture';
import {
  getRenderHostDevMode,
  renderHostPort,
  setRenderHostDevMode,
  type RenderHostDevMode,
} from '../render/renderHostPort';

export interface WorkerFirstRuntimeExportPlaybackSmokeDeps {
  readonly materializeFixture?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly simulatePlayback?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly simulateScrub?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly debugExport?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly getStats?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly getPlaybackTrace?: (args: Record<string, unknown>) => Promise<ToolResult>;
  readonly getRenderHostDevMode?: () => RenderHostDevMode | null;
  readonly setRenderHostDevMode?: (mode: RenderHostDevMode | null) => unknown;
  readonly requestRenderFrame?: () => void;
  readonly now?: () => number;
}

const FORBIDDEN_CALLER_EVIDENCE_FIELDS = [
  'fingerprint',
  'mainFingerprint',
  'workerFingerprint',
  'proofCaptures',
  'goldenFixtures',
  'shadowSamples',
  'visibleProofs',
  'w5Prerequisites',
  'acceptedSnapshot',
  'allowW5StartFromCapturedEvidence',
  'canStartWorkerWebGpu',
  'canStartWorkerPresentation',
  'canStartRenderDispatcherCutover',
] as const;

type RuntimeSmokeRenderHostMode = RenderHostDevMode | 'current';

const DEFAULT_RUNTIME_SMOKE_RENDER_HOST_MODE: RuntimeSmokeRenderHostMode = 'worker-only';
const RUNTIME_SMOKE_RENDER_HOST_MODES = new Set<RuntimeSmokeRenderHostMode>([
  'main',
  'worker-shadow',
  'worker-presenting',
  'worker-only',
  'worker-gpu-only',
  'current',
]);

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readNumberRecord(value: unknown): Record<string, number> {
  const source = readObject(value);
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(source)) {
    if (typeof count === 'number' && Number.isFinite(count)) {
      result[key] = count;
    }
  }
  return result;
}

function readNumberArg(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, readNumber(args[key], fallback)));
}

function readRenderHostModeArg(value: unknown): RuntimeSmokeRenderHostMode {
  return typeof value === 'string' && RUNTIME_SMOKE_RENDER_HOST_MODES.has(value as RuntimeSmokeRenderHostMode)
    ? value as RuntimeSmokeRenderHostMode
    : DEFAULT_RUNTIME_SMOKE_RENDER_HOST_MODE;
}

function findForbiddenEvidenceFields(args: Record<string, unknown>): string[] {
  return FORBIDDEN_CALLER_EVIDENCE_FIELDS.filter((field) => args[field] !== undefined);
}

function summarizePlayback(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  const runDiagnostics = summarizeRunDiagnostics(data);
  const renderHostBeforePause = readObject(data.renderHostBeforePause);
  const renderHostDiagnosticsBeforePause = readObject(renderHostBeforePause.diagnostics);
  const reverseWorkerWebCodecsBeforePause = readObject(data.reverseWorkerWebCodecsBeforePause);
  return {
    requestedDurationMs: readNumber(data.requestedDurationMs),
    actualDurationMs: readNumber(data.actualDurationMs),
    playbackSpeed: readNumber(data.playbackSpeed, 1),
    initialPosition: readNumber(data.initialPosition),
    finalPosition: readNumber(data.finalPosition),
    deltaSeconds: readNumber(data.deltaSeconds),
    expectedDeltaSeconds: readNumber(data.expectedDeltaSeconds),
    driftSeconds: readNumber(data.driftSeconds),
    framesObserved: readNumber(data.framesObserved),
    movingFrames: readNumber(data.movingFrames),
    stalledFrames: readNumber(data.stalledFrames),
    longestStallFrames: readNumber(data.longestStallFrames),
    minVisited: readNumber(data.minVisited),
    maxVisited: readNumber(data.maxVisited),
    maxStepSeconds: readNumber(data.maxStepSeconds),
    endedPlaying: readBool(data.endedPlaying),
    renderHostModeBeforePause: renderHostBeforePause.mode ?? null,
    renderHostStrictWorkerOnlyBeforePause: readBool(
      renderHostBeforePause.strictWorkerOnly,
      readBool(renderHostDiagnosticsBeforePause.strictWorkerOnly),
    ),
    reverseWorkerWebCodecs: {
      cachedSourceCount: readNumber(reverseWorkerWebCodecsBeforePause.cachedSourceCount),
      lastStatus: reverseWorkerWebCodecsBeforePause.lastStatus ?? null,
    },
    runDiagnostics,
  };
}

function summarizeScrub(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  return {
    pattern: data.pattern ?? null,
    speed: data.speed ?? null,
    requestedDurationMs: readNumber(data.requestedDurationMs),
    actualDurationMs: readNumber(data.durationMs),
    framesApplied: readNumber(data.framesApplied),
    initialPosition: readNumber(data.initialPosition),
    finalPosition: readNumber(data.finalPosition),
    minVisited: readNumber(data.minVisited),
    maxVisited: readNumber(data.maxVisited),
    dragMode: data.dragMode ?? null,
    runDiagnostics: summarizeRunDiagnostics(data),
  };
}

function summarizeRunDiagnostics(data: Record<string, unknown>): Record<string, unknown> {
  const runDiagnostics = readObject(data.runDiagnostics);
  const playback = readObject(runDiagnostics.playback);
  const startup = readObject(runDiagnostics.startup);
  return {
    windowMs: readNumber(runDiagnostics.windowMs),
    wcEventCount: readNumber(runDiagnostics.wcEventCount),
    vfEventCount: readNumber(runDiagnostics.vfEventCount),
    playbackStatus: playback.status ?? null,
    previewFrames: readNumber(playback.previewFrames),
    previewUpdates: readNumber(playback.previewUpdates),
    previewRenderFps: readNumber(playback.previewRenderFps),
    previewUpdateFps: readNumber(playback.previewUpdateFps),
    avgPreviewRenderGapMs: readNumber(playback.avgPreviewRenderGapMs),
    p95PreviewRenderGapMs: readNumber(playback.p95PreviewRenderGapMs),
    maxPreviewRenderGapMs: readNumber(playback.maxPreviewRenderGapMs),
    avgPreviewUpdateGapMs: readNumber(playback.avgPreviewUpdateGapMs),
    p95PreviewUpdateGapMs: readNumber(playback.p95PreviewUpdateGapMs),
    maxPreviewUpdateGapMs: readNumber(playback.maxPreviewUpdateGapMs),
    stalePreviewFrames: readNumber(playback.stalePreviewFrames),
    stalePreviewWhileTargetMoved: readNumber(playback.stalePreviewWhileTargetMoved),
    previewFreezeEvents: readNumber(playback.previewFreezeEvents),
    previewFreezeFrames: readNumber(playback.previewFreezeFrames),
    longestPreviewFreezeMs: readNumber(playback.longestPreviewFreezeMs),
    healthAnomalies: readNumber(playback.healthAnomalies),
    readyStateDrops: readNumber(playback.readyStateDrops),
    activeVideos: readNumber(playback.activeVideos),
    playingVideos: readNumber(playback.playingVideos),
    seekingVideos: readNumber(playback.seekingVideos),
    worstReadyState: readNumber(playback.worstReadyState),
    previewPathCounts: readNumberRecord(playback.previewPathCounts),
    startup: {
      firstDecodeOutputMs: readNumber(startup.firstDecodeOutputMs),
      firstPreviewFrameMs: readNumber(startup.firstPreviewFrameMs),
      firstPreviewUpdateMs: readNumber(startup.firstPreviewUpdateMs),
      startupCatchUpMs: readNumber(startup.startupCatchUpMs),
      initialTargetMovedStaleFrames: readNumber(startup.initialTargetMovedStaleFrames),
      initialTargetMovedStaleMs: readNumber(startup.initialTargetMovedStaleMs),
    },
  };
}

function summarizeExport(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  const blob = readObject(data.blob);
  const exportHostBefore = readObject(data.exportHostBefore);
  const exportHostAfter = readObject(data.exportHostAfter);
  const workerBefore = readObject(exportHostBefore.worker);
  const worker = readObject(exportHostAfter.worker);
  const errors = Array.isArray(data.errors) ? data.errors : [];
  const readbackFrameCountBefore = readNumber(workerBefore.readbackFrameCount);
  const fallbackFrameCountBefore = readNumber(workerBefore.fallbackFrameCount);
  const readbackFrameCountAfter = readNumber(worker.readbackFrameCount);
  const fallbackFrameCountAfter = readNumber(worker.fallbackFrameCount);
  return {
    elapsedMs: readNumber(data.elapsedMs),
    timedOut: readBool(data.timedOut),
    blobSize: readNumber(blob.size),
    blobType: typeof blob.type === 'string' ? blob.type : null,
    progressSamples: Array.isArray(data.progressSamples) ? data.progressSamples.length : 0,
    exportHostMode: exportHostAfter.mode ?? null,
    exportHostStrategy: exportHostAfter.presentationStrategy ?? null,
    workerReadbackFrameCount: readbackFrameCountAfter,
    workerFallbackFrameCount: fallbackFrameCountAfter,
    workerReadbackFrameDelta: Math.max(0, readbackFrameCountAfter - readbackFrameCountBefore),
    workerFallbackFrameDelta: Math.max(0, fallbackFrameCountAfter - fallbackFrameCountBefore),
    exportErrorCount: errors.length,
  };
}

function summarizeStats(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  const cacheRuntime = readObject(data.cacheRuntime);
  const providerRuntime = readObject(data.providerRuntime);
  const independentRenderScheduler = readObject(data.independentRenderScheduler);
  const workerFirstRenderer = readObject(data.workerFirstRenderer);
  const prerequisites = readObject(workerFirstRenderer.w5Prerequisites);

  return {
    engineReady: readBool(data.engineReady),
    cacheRuntimeRecordCount: Array.isArray(cacheRuntime.records) ? cacheRuntime.records.length : null,
    providerRuntimeRecordCount: Array.isArray(providerRuntime.providers) ? providerRuntime.providers.length : null,
    independentRenderSchedulerJobCount: Array.isArray(independentRenderScheduler.jobs)
      ? independentRenderScheduler.jobs.length
      : null,
    workerFirstRendererPresent: Object.keys(workerFirstRenderer).length > 0,
    w5GateEvidenceMode: workerFirstRenderer.w5GateEvidenceMode ?? null,
    canStartWorkerWebGpu: readBool(prerequisites.canStartWorkerWebGpu),
    canStartWorkerPresentation: readBool(prerequisites.canStartWorkerPresentation),
    canStartRenderDispatcherCutover: readBool(prerequisites.canStartRenderDispatcherCutover),
  };
}

function summarizeTrace(result: ToolResult): Record<string, unknown> {
  const data = readObject(result.data);
  const playback = readObject(data.playback);
  const workerFirstRenderer = readObject(data.workerFirstRenderer);
  const prerequisites = readObject(workerFirstRenderer.w5Prerequisites);
  return {
    playbackStatus: playback.status ?? null,
    previewFrames: readNumber(playback.previewFrames),
    previewUpdates: readNumber(playback.previewUpdates),
    previewRenderFps: readNumber(playback.previewRenderFps),
    previewUpdateFps: readNumber(playback.previewUpdateFps),
    stalePreviewFrames: readNumber(playback.stalePreviewFrames),
    stalePreviewWhileTargetMoved: readNumber(playback.stalePreviewWhileTargetMoved),
    previewFreezeEvents: readNumber(playback.previewFreezeEvents),
    previewFreezeFrames: readNumber(playback.previewFreezeFrames),
    longestPreviewFreezeMs: readNumber(playback.longestPreviewFreezeMs),
    healthAnomalies: readNumber(playback.healthAnomalies),
    previewPathCounts: readNumberRecord(playback.previewPathCounts),
    workerFirstRendererPresent: Object.keys(workerFirstRenderer).length > 0,
    w5GateEvidenceMode: workerFirstRenderer.w5GateEvidenceMode ?? null,
    canStartWorkerWebGpu: readBool(prerequisites.canStartWorkerWebGpu),
    canStartWorkerPresentation: readBool(prerequisites.canStartWorkerPresentation),
    canStartRenderDispatcherCutover: readBool(prerequisites.canStartRenderDispatcherCutover),
  };
}

function runtimeFeedsPresent(statsSummary: Record<string, unknown>): boolean {
  return typeof statsSummary.cacheRuntimeRecordCount === 'number'
    && typeof statsSummary.providerRuntimeRecordCount === 'number'
    && typeof statsSummary.independentRenderSchedulerJobCount === 'number'
    && statsSummary.workerFirstRendererPresent === true;
}

function startPermissionsRemainFalse(summary: Record<string, unknown>): boolean {
  return summary.canStartWorkerWebGpu === false
    && summary.canStartWorkerPresentation === false
    && summary.canStartRenderDispatcherCutover === false;
}

async function resolveDebugExportCodec(
  width: number,
  height: number,
): Promise<{ readonly codec: 'h264' | 'vp9'; readonly container: 'mp4' | 'webm' }> {
  if (await FrameExporter.checkCodecSupport('h264', width, height)) {
    return { codec: 'h264', container: 'mp4' };
  }
  if (await FrameExporter.checkCodecSupport('vp9', width, height)) {
    return { codec: 'vp9', container: 'webm' };
  }
  return { codec: 'h264', container: 'mp4' };
}

function hasWorkerOnlyPreviewEvents(...summaries: readonly Record<string, unknown>[]): boolean {
  return summaries.some((summary) => {
    const runDiagnostics = readObject(summary.runDiagnostics);
    const pathCounts = readNumberRecord(summary.previewPathCounts ?? runDiagnostics.previewPathCounts);
    return Object.entries(pathCounts).some(([source, count]) => source.startsWith('worker-only:') && count > 0);
  });
}

function hasWorkerWebCodecsPreviewEvents(summary: Record<string, unknown>): boolean {
  const runDiagnostics = readObject(summary.runDiagnostics);
  const pathCounts = readNumberRecord(summary.previewPathCounts ?? runDiagnostics.previewPathCounts);
  return Object.entries(pathCounts).some(([source, count]) => (
    count > 0 &&
    (
      source.startsWith('worker-only:WebCodecs') ||
      source.startsWith('worker-presenting:WebCodecs')
    )
  ));
}

function previewSummaryIsHealthy(summary: Record<string, unknown>): boolean {
  const previewFrames = readNumber(summary.previewFrames);
  const staleWhileMoved = readNumber(summary.stalePreviewWhileTargetMoved);
  const staleBudget = Math.max(3, Math.floor(previewFrames * 0.55));
  const longestFreezeMs = readNumber(summary.longestPreviewFreezeMs);
  const playbackStatus = summary.playbackStatus;
  return playbackStatus !== 'bad'
    && previewFrames > 0
    && readNumber(summary.previewUpdates) > 0
    && readNumber(summary.previewRenderFps) >= 20
    && readNumber(summary.previewUpdateFps) >= 20
    && readNumber(summary.p95PreviewUpdateGapMs) <= 120
    && staleWhileMoved <= staleBudget
    && longestFreezeMs < 180;
}

function runPreviewIsHealthy(summary: Record<string, unknown>): boolean {
  return previewSummaryIsHealthy(readObject(summary.runDiagnostics));
}

function playbackTraceIsHealthy(summary: Record<string, unknown>): boolean {
  const previewFrames = readNumber(summary.previewFrames);
  const staleWhileMoved = readNumber(summary.stalePreviewWhileTargetMoved);
  const staleBudget = Math.max(3, Math.floor(previewFrames * 0.55));
  return summary.playbackStatus !== 'bad'
    && previewFrames > 0
    && staleWhileMoved <= staleBudget
    && readNumber(summary.longestPreviewFreezeMs) < 180;
}

function playbackMovedForward(summary: Record<string, unknown>): boolean {
  return readNumber(summary.movingFrames) > 0 && readNumber(summary.deltaSeconds) > 0.01;
}

function playbackMovedBackward(summary: Record<string, unknown>): boolean {
  return readNumber(summary.movingFrames) > 0 && readNumber(summary.deltaSeconds) < -0.01;
}

function playbackStayedWorkerOnly(summary: Record<string, unknown>): boolean {
  return (
    summary.renderHostModeBeforePause === 'worker-only' ||
    summary.renderHostModeBeforePause === 'worker-gpu-only'
  )
    && summary.renderHostStrictWorkerOnlyBeforePause === true;
}

function exportStayedWorkerReadback(summary: Record<string, unknown>): boolean {
  return summary.exportHostMode === 'worker-software'
    && summary.exportHostStrategy === 'worker-software-readback'
    && readNumber(summary.workerReadbackFrameDelta) > 0
    && readNumber(summary.workerFallbackFrameDelta) === 0
    && readNumber(summary.exportErrorCount) === 0;
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export async function handleRunWorkerFirstRuntimeExportPlaybackSmoke(
  args: Record<string, unknown>,
  deps: WorkerFirstRuntimeExportPlaybackSmokeDeps = {},
): Promise<ToolResult> {
  const forbiddenFields = findForbiddenEvidenceFields(args);
  if (forbiddenFields.length > 0) {
    return {
      success: false,
      error: 'Runtime export/playback smoke captures browser evidence itself; caller-supplied proof fields are not accepted.',
      data: { forbiddenFields },
    };
  }

  const now = deps.now ?? (() => Date.now());
  const materializeFixture = deps.materializeFixture ?? materializeWorkerFirstSolidTextImageFixture;
  const simulatePlayback = deps.simulatePlayback ?? ((playbackArgs) =>
    handleSimulatePlayback(playbackArgs, useTimelineStore.getState()));
  const debugExport = deps.debugExport ?? handleDebugExport;
  const getStats = deps.getStats ?? handleGetStats;
  const getPlaybackTrace = deps.getPlaybackTrace ?? handleGetPlaybackTrace;
  const readRenderHostMode = deps.getRenderHostDevMode ?? getRenderHostDevMode;
  const writeRenderHostMode = deps.setRenderHostDevMode ?? setRenderHostDevMode;
  const startedAt = now();

  const renderHostMode = readRenderHostModeArg(args.renderHostMode);
  const previousRenderHostMode = readRenderHostMode();
  let activeRenderHostMode = previousRenderHostMode;
  const shouldOverrideRenderHostMode = renderHostMode !== 'current';
  if (shouldOverrideRenderHostMode) {
    writeRenderHostMode(renderHostMode);
    activeRenderHostMode = readRenderHostMode();
  }

  const width = Math.round(readNumberArg(args, 'width', 1280, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', 720, 180, 2160));
  const durationSeconds = readNumberArg(args, 'durationSeconds', 2.25, 1.25, 10);
  const playbackDurationMs = Math.round(readNumberArg(args, 'playbackDurationMs', 1000, 250, 9000));
  const exportDurationSeconds = readNumberArg(args, 'exportDurationSeconds', 0.75, 0.25, durationSeconds);
  const exportWidth = Math.round(readNumberArg(args, 'exportWidth', 320, 64, 1920));
  const exportHeight = Math.round(readNumberArg(args, 'exportHeight', 180, 64, 1080));
  const exportFps = readNumberArg(args, 'exportFps', 8, 1, 60);
  const maxRuntimeMs = Math.round(readNumberArg(args, 'maxRuntimeMs', 45000, 1000, 120000));

  try {
    const exportCodec = await resolveDebugExportCodec(exportWidth, exportHeight);
    const fixtureResult = await materializeFixture({
      resetProject: true,
      width,
      height,
      durationSeconds,
    });
    if (!fixtureResult.success) {
      return {
        success: false,
        error: fixtureResult.error ?? 'Runtime smoke fixture materialization failed.',
        data: {
          projectId: 'runtime-export-playback',
          renderHostMode,
          previousRenderHostMode,
          activeRenderHostMode,
          fixture: fixtureResult.data ?? null,
        },
      };
    }

    const statsBefore = await getStats({});
    const playbackResult = await simulatePlayback({
      startTime: 0,
      durationMs: playbackDurationMs,
      settleMs: 250,
      playbackSpeed: 1,
      resetDiagnostics: true,
      restorePlaybackState: false,
    });
    const exportResult = await debugExport({
      startTime: 0,
      durationSeconds: exportDurationSeconds,
      width: exportWidth,
      height: exportHeight,
      fps: exportFps,
      exportMode: 'fast',
      codec: exportCodec.codec,
      container: exportCodec.container,
      includeAudio: false,
      download: false,
      maxRuntimeMs,
    });
    const statsAfter = await getStats({});
    const playbackTrace = await getPlaybackTrace({ windowMs: 5000, limit: 200 });

    const statsBeforeSummary = summarizeStats(statsBefore);
    const statsAfterSummary = summarizeStats(statsAfter);
    const playbackSummary = summarizePlayback(playbackResult);
    const exportSummary = summarizeExport(exportResult);
    const traceSummary = summarizeTrace(playbackTrace);
    const checks = {
      statsBeforeSucceeded: statsBefore.success,
      playbackSucceeded: playbackResult.success,
      playbackObservedMotion: readNumber(playbackSummary.movingFrames) > 0,
      exportSucceeded: exportResult.success,
      exportProducedBlob: readNumber(exportSummary.blobSize) > 0,
      exportDidNotTimeout: exportSummary.timedOut === false,
      exportUsedWorkerReadback: exportSummary.exportHostMode === 'worker-software'
        && exportSummary.exportHostStrategy === 'worker-software-readback',
      exportReadbackObserved: readNumber(exportSummary.workerReadbackFrameDelta) > 0,
      exportStayedOffMainFallback: readNumber(exportSummary.workerFallbackFrameDelta) === 0,
      exportHadNoErrors: readNumber(exportSummary.exportErrorCount) === 0,
      statsAfterSucceeded: statsAfter.success,
      playbackTraceSucceeded: playbackTrace.success,
      runtimeFeedsPresent: runtimeFeedsPresent(statsAfterSummary),
      statsStartPermissionsRemainFalse: startPermissionsRemainFalse(statsAfterSummary),
      traceStartPermissionsRemainFalse: startPermissionsRemainFalse(traceSummary),
    };
    const passed = Object.values(checks).every(Boolean);
    const finishedAt = now();
    const data = {
      projectId: 'runtime-export-playback',
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      fixture: fixtureResult.data,
      settings: {
        renderHostMode,
        previousRenderHostMode,
        activeRenderHostMode,
        width,
        height,
        durationSeconds,
        playbackDurationMs,
        exportDurationSeconds,
        exportWidth,
        exportHeight,
        exportFps,
        exportCodec: exportCodec.codec,
        exportContainer: exportCodec.container,
        maxRuntimeMs,
      },
      checks,
      statsBefore: statsBeforeSummary,
      playback: playbackSummary,
      export: exportSummary,
      statsAfter: statsAfterSummary,
      playbackTrace: traceSummary,
      errors: {
        statsBefore: statsBefore.error ?? null,
        playback: playbackResult.error ?? null,
        export: exportResult.error ?? null,
        statsAfter: statsAfter.error ?? null,
        playbackTrace: playbackTrace.error ?? null,
      },
      w5StartPermissionsRemainStatsGuarded: true,
    };

    return passed
      ? { success: true, data }
      : {
          success: false,
          error: 'Runtime export/playback smoke did not satisfy all checks.',
          data,
        };
  } finally {
    if (shouldOverrideRenderHostMode) {
      writeRenderHostMode(previousRenderHostMode);
    }
  }
}

export async function handleRunWorkerFirstRealVideoRuntimeSmoke(
  args: Record<string, unknown>,
  deps: WorkerFirstRuntimeExportPlaybackSmokeDeps = {},
): Promise<ToolResult> {
  const forbiddenFields = findForbiddenEvidenceFields(args);
  if (forbiddenFields.length > 0) {
    return {
      success: false,
      error: 'Real-video runtime smoke captures browser evidence itself; caller-supplied proof fields are not accepted.',
      data: { forbiddenFields },
    };
  }

  const now = deps.now ?? (() => Date.now());
  const materializeFixture = deps.materializeFixture ?? materializeWorkerFirstMultiVideoFixture;
  const simulatePlayback = deps.simulatePlayback ?? ((playbackArgs) =>
    handleSimulatePlayback(playbackArgs, useTimelineStore.getState()));
  const simulateScrub = deps.simulateScrub ?? ((scrubArgs) =>
    handleSimulateScrub(scrubArgs, useTimelineStore.getState()));
  const debugExport = deps.debugExport ?? handleDebugExport;
  const getStats = deps.getStats ?? handleGetStats;
  const getPlaybackTrace = deps.getPlaybackTrace ?? handleGetPlaybackTrace;
  const readRenderHostMode = deps.getRenderHostDevMode ?? getRenderHostDevMode;
  const writeRenderHostMode = deps.setRenderHostDevMode ?? setRenderHostDevMode;
  const requestRenderFrame = deps.requestRenderFrame ?? (() => renderHostPort.requestNewFrameRender());
  const startedAt = now();

  const renderHostMode = readRenderHostModeArg(args.renderHostMode);
  const previousRenderHostMode = readRenderHostMode();
  let activeRenderHostMode = previousRenderHostMode;
  const shouldOverrideRenderHostMode = renderHostMode !== 'current';
  if (shouldOverrideRenderHostMode) {
    writeRenderHostMode(renderHostMode);
    activeRenderHostMode = readRenderHostMode();
  }

  const width = Math.round(readNumberArg(args, 'width', 1280, 320, 3840));
  const height = Math.round(readNumberArg(args, 'height', 720, 180, 2160));
  const durationSeconds = readNumberArg(args, 'durationSeconds', 6, 5.25, 30);
  const mediaSettleMs = Math.round(readNumberArg(args, 'mediaSettleMs', 1800, 0, 15000));
  const playbackDurationMs = Math.round(readNumberArg(args, 'playbackDurationMs', 1000, 250, 9000));
  const fastPlaybackDurationMs = Math.round(readNumberArg(args, 'fastPlaybackDurationMs', 900, 250, 9000));
  const reversePlaybackDurationMs = Math.round(readNumberArg(args, 'reversePlaybackDurationMs', 900, 250, 9000));
  const scrubDurationMs = Math.round(readNumberArg(args, 'scrubDurationMs', 1800, 250, 9000));
  const scrubSettleMs = Math.round(readNumberArg(args, 'scrubSettleMs', 350, 0, 5000));
  const normalStartTime = readNumberArg(args, 'normalStartTime', 0.25, 0, durationSeconds - 0.5);
  const fastStartTime = readNumberArg(args, 'fastStartTime', 0.25, 0, durationSeconds - 1);
  const reverseStartTime = readNumberArg(args, 'reverseStartTime', 4.75, 0.75, durationSeconds);
  const scrubMinTime = readNumberArg(args, 'scrubMinTime', 0.25, 0, durationSeconds);
  const scrubMaxTime = readNumberArg(args, 'scrubMaxTime', 5.25, scrubMinTime, durationSeconds);
  const exportDurationSeconds = readNumberArg(args, 'exportDurationSeconds', 0.75, 0.25, durationSeconds);
  const exportWidth = Math.round(readNumberArg(args, 'exportWidth', 320, 64, 1920));
  const exportHeight = Math.round(readNumberArg(args, 'exportHeight', 180, 64, 1080));
  const exportFps = readNumberArg(args, 'exportFps', 8, 1, 60);
  const maxRuntimeMs = Math.round(readNumberArg(args, 'maxRuntimeMs', 60000, 1000, 180000));

  try {
    const exportCodec = await resolveDebugExportCodec(exportWidth, exportHeight);
    const fixtureResult = await materializeFixture({
      resetProject: true,
      width,
      height,
      durationSeconds,
    });
    if (!fixtureResult.success) {
      return {
        success: false,
        error: fixtureResult.error ?? 'Real-video runtime smoke fixture materialization failed.',
        data: {
          projectId: 'real-video-runtime',
          renderHostMode,
          previousRenderHostMode,
          activeRenderHostMode,
          fixture: fixtureResult.data ?? null,
        },
      };
    }

    if (mediaSettleMs > 0) {
      await waitMs(mediaSettleMs);
    }

    const statsBefore = await getStats({});
    const normalPlaybackResult = await simulatePlayback({
      startTime: normalStartTime,
      durationMs: playbackDurationMs,
      settleMs: 250,
      playbackSpeed: 1,
      resetDiagnostics: true,
      restorePlaybackState: false,
    });
    const speed2PlaybackResult = await simulatePlayback({
      startTime: fastStartTime,
      durationMs: fastPlaybackDurationMs,
      settleMs: 250,
      playbackSpeed: 2,
      resetDiagnostics: true,
      restorePlaybackState: false,
    });
    const speed3PlaybackResult = await simulatePlayback({
      startTime: fastStartTime,
      durationMs: fastPlaybackDurationMs,
      settleMs: 250,
      playbackSpeed: 3,
      resetDiagnostics: true,
      restorePlaybackState: false,
    });
    const reversePlaybackResult = await simulatePlayback({
      startTime: reverseStartTime,
      durationMs: reversePlaybackDurationMs,
      settleMs: 250,
      playbackSpeed: -1,
      resetDiagnostics: true,
      restorePlaybackState: false,
    });

    useTimelineStore.getState().setPlayheadPosition(scrubMinTime);
    requestRenderFrame();
    if (scrubSettleMs > 0) {
      await waitMs(scrubSettleMs);
    }
    const scrubMidTime = scrubMinTime + (scrubMaxTime - scrubMinTime) * 0.45;
    const scrubResult = await simulateScrub({
      pattern: 'custom',
      points: [
        scrubMinTime,
        scrubMidTime,
        scrubMaxTime,
        scrubMinTime + (scrubMaxTime - scrubMinTime) * 0.72,
        scrubMinTime + (scrubMaxTime - scrubMinTime) * 0.2,
        scrubMaxTime,
      ],
      durationMs: scrubDurationMs,
      minTime: scrubMinTime,
      maxTime: scrubMaxTime,
      resetDiagnostics: true,
    });

    const exportResult = await debugExport({
      startTime: 0,
      durationSeconds: exportDurationSeconds,
      width: exportWidth,
      height: exportHeight,
      fps: exportFps,
      exportMode: 'fast',
      codec: exportCodec.codec,
      container: exportCodec.container,
      includeAudio: false,
      download: false,
      maxRuntimeMs,
    });
    const statsAfter = await getStats({});
    const playbackTrace = await getPlaybackTrace({ windowMs: 10000, limit: 400 });

    const statsBeforeSummary = summarizeStats(statsBefore);
    const statsAfterSummary = summarizeStats(statsAfter);
    const normalPlayback = summarizePlayback(normalPlaybackResult);
    const speed2Playback = summarizePlayback(speed2PlaybackResult);
    const speed3Playback = summarizePlayback(speed3PlaybackResult);
    const reversePlayback = summarizePlayback(reversePlaybackResult);
    const scrub = summarizeScrub(scrubResult);
    const exportSummary = summarizeExport(exportResult);
    const traceSummary = summarizeTrace(playbackTrace);
    const checks = {
      statsBeforeSucceeded: statsBefore.success,
      fixtureIsRealMultiVideo: readObject(fixtureResult.data).projectId === 'multi-video'
        && readNumber(readObject(fixtureResult.data).clipCount) >= 2,
      normalPlaybackSucceeded: normalPlaybackResult.success,
      normalPlaybackMovedForward: playbackMovedForward(normalPlayback),
      normalPlaybackPreviewHealthy: runPreviewIsHealthy(normalPlayback),
      speed2PlaybackSucceeded: speed2PlaybackResult.success,
      speed2PlaybackMovedForward: playbackMovedForward(speed2Playback),
      speed2PlaybackPreviewHealthy: runPreviewIsHealthy(speed2Playback),
      speed3PlaybackSucceeded: speed3PlaybackResult.success,
      speed3PlaybackMovedForward: playbackMovedForward(speed3Playback),
      speed3PlaybackPreviewHealthy: runPreviewIsHealthy(speed3Playback),
      reversePlaybackSucceeded: reversePlaybackResult.success,
      reversePlaybackMovedBackward: playbackMovedBackward(reversePlayback),
      reversePlaybackPreviewHealthy: runPreviewIsHealthy(reversePlayback),
      reversePlaybackUsedWorkerWebCodecs: hasWorkerWebCodecsPreviewEvents(reversePlayback),
      scrubSucceeded: scrubResult.success,
      scrubAppliedFrames: readNumber(scrub.framesApplied) > 0,
      scrubVisitedRange: readNumber(scrub.maxVisited) - readNumber(scrub.minVisited) > 0.25,
      scrubPreviewHealthy: runPreviewIsHealthy(scrub),
      playbackRunsStayedWorkerOnly: [
        normalPlayback,
        speed2Playback,
        speed3Playback,
        reversePlayback,
      ].every(playbackStayedWorkerOnly),
      workerOnlyPreviewEventsObserved: hasWorkerOnlyPreviewEvents(
        normalPlayback,
        speed2Playback,
        speed3Playback,
        reversePlayback,
        scrub,
        traceSummary,
      ),
      exportSucceeded: exportResult.success,
      exportProducedBlob: readNumber(exportSummary.blobSize) > 0,
      exportDidNotTimeout: exportSummary.timedOut === false,
      exportStayedWorkerReadback: exportStayedWorkerReadback(exportSummary),
      statsAfterSucceeded: statsAfter.success,
      playbackTraceSucceeded: playbackTrace.success,
      playbackTraceHealthy: playbackTraceIsHealthy(traceSummary),
      runtimeFeedsPresent: runtimeFeedsPresent(statsAfterSummary),
      statsStartPermissionsRemainFalse: startPermissionsRemainFalse(statsAfterSummary),
      traceStartPermissionsRemainFalse: startPermissionsRemainFalse(traceSummary),
    };
    const passed = Object.values(checks).every(Boolean);
    const finishedAt = now();
    const data = {
      projectId: 'real-video-runtime',
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      fixture: fixtureResult.data,
      settings: {
        renderHostMode,
        previousRenderHostMode,
        activeRenderHostMode,
        width,
        height,
        durationSeconds,
        mediaSettleMs,
        playbackDurationMs,
        fastPlaybackDurationMs,
        reversePlaybackDurationMs,
        scrubDurationMs,
        scrubSettleMs,
        normalStartTime,
        fastStartTime,
        reverseStartTime,
        scrubMinTime,
        scrubMaxTime,
        exportDurationSeconds,
        exportWidth,
        exportHeight,
        exportFps,
        exportCodec: exportCodec.codec,
        exportContainer: exportCodec.container,
        maxRuntimeMs,
      },
      checks,
      statsBefore: statsBeforeSummary,
      playback: {
        normal: normalPlayback,
        speed2: speed2Playback,
        speed3: speed3Playback,
        reverse: reversePlayback,
      },
      scrub,
      export: exportSummary,
      statsAfter: statsAfterSummary,
      playbackTrace: traceSummary,
      errors: {
        statsBefore: statsBefore.error ?? null,
        normalPlayback: normalPlaybackResult.error ?? null,
        speed2Playback: speed2PlaybackResult.error ?? null,
        speed3Playback: speed3PlaybackResult.error ?? null,
        reversePlayback: reversePlaybackResult.error ?? null,
        scrub: scrubResult.error ?? null,
        export: exportResult.error ?? null,
        statsAfter: statsAfter.error ?? null,
        playbackTrace: playbackTrace.error ?? null,
      },
      w5StartPermissionsRemainStatsGuarded: true,
    };

    return passed
      ? { success: true, data }
      : {
          success: false,
          error: 'Real-video worker-only runtime smoke did not satisfy all checks.',
          data,
        };
  } finally {
    if (shouldOverrideRenderHostMode) {
      writeRenderHostMode(previousRenderHostMode);
    }
  }
}
