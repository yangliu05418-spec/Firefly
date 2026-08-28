import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
import { useSettingsStore } from '../../../../../stores/settingsStore';
import type { AudioMeterSnapshot } from '../../../../../types';
import { runtimeAudioMeterBus } from '../../../../audio/runtimeAudioMeterBus';
import { projectFileService } from '../../../../projectFileService';
import { getRuntimeDiagnostics } from '../../../../runtimeDiagnostics';
import {
  summarizeMediaWaveformPayloads,
  summarizeNumberList,
} from './performance';

type StoreChurnEvent = {
  elapsedMs: number;
  source: string;
  detail?: Record<string, unknown>;
};

function summarizeStemClipState() {
  return useTimelineStore.getState().clips
    .filter((clip) => clip.audioState?.stemSeparation?.stems.length)
    .map((clip) => ({
      id: clip.id,
      name: clip.name,
      mixMode: clip.audioState?.stemSeparation?.mixMode ?? null,
      soloStemId: clip.audioState?.stemSeparation?.soloStemId ?? null,
      stemCount: clip.audioState?.stemSeparation?.stems.length ?? 0,
      stems: clip.audioState?.stemSeparation?.stems.map((stem) => ({
        id: stem.id,
        label: stem.label,
        enabled: stem.enabled !== false,
        gainDb: stem.gainDb ?? 0,
        mediaFileId: stem.mediaFileId ?? null,
        waveformLength: stem.waveform?.length ?? 0,
      })) ?? [],
    }));
}

function createTimelineClipsDebugSignature() {
  return JSON.stringify(useTimelineStore.getState().clips.map((clip) => ({
    id: clip.id,
    trackId: clip.trackId,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    audioState: clip.audioState
      ? {
          editStackLength: clip.audioState.editStack?.length ?? 0,
          effectStackLength: clip.audioState.effectStack?.length ?? 0,
          stemSeparation: clip.audioState.stemSeparation
            ? {
                activeSetId: clip.audioState.stemSeparation.activeSetId,
                mixMode: clip.audioState.stemSeparation.mixMode,
                soloStemId: clip.audioState.stemSeparation.soloStemId ?? null,
                sourceGainDb: clip.audioState.stemSeparation.sourceGainDb ?? 0,
                stems: clip.audioState.stemSeparation.stems.map((stem) => ({
                  id: stem.id,
                  enabled: stem.enabled !== false,
                  gainDb: stem.gainDb ?? 0,
                  mediaFileId: stem.mediaFileId ?? null,
                })),
              }
            : null,
        }
      : null,
  })));
}

function createMediaPersistedDebugSignature() {
  return JSON.stringify(useMediaStore.getState().files.map((file) => ({
    id: file.id,
    name: file.name,
    type: file.type,
    parentId: file.parentId ?? null,
    projectPath: file.projectPath ?? null,
    filePath: file.filePath ?? null,
    fileHash: file.fileHash ?? null,
    duration: file.duration ?? null,
    proxyStatus: file.proxyStatus ?? null,
    proxyFrameCount: file.proxyFrameCount ?? null,
    proxyFps: file.proxyFps ?? null,
    hasProxyAudio: file.hasProxyAudio === true,
    audioProxyStatus: file.audioProxyStatus ?? null,
    audioProxyStorageKey: file.audioProxyStorageKey ?? null,
    audioAnalysisRefs: file.audioAnalysisRefs ?? null,
    waveformStatus: file.waveformStatus ?? null,
    waveformLength: file.waveform?.length ?? 0,
    waveformChannelLengths: file.waveformChannels?.map(channel => channel.length) ?? [],
  })));
}

function createAudioRuntimeDebugSignature() {
  const state = useTimelineStore.getState() as unknown as {
    runtimeAudioMeters?: unknown;
    clipStemSeparationJobs?: unknown;
  };
  return JSON.stringify({
    runtimeAudioMeters: state.runtimeAudioMeters ?? null,
    clipStemSeparationJobs: state.clipStemSeparationJobs ?? null,
  });
}

function summarizeRuntimeAudioMeters() {
  // Read directly from the runtime audio meter bus (source of truth). The meter
  // shape is preserved; `demand` is added as optional diagnostics.
  const now = performance.now();
  const debug = runtimeAudioMeterBus.getDebugSnapshot();
  const summarizeSnapshot = (meter: AudioMeterSnapshot) => ({
    peakLinear: Math.round(meter.peakLinear * 10000) / 10000,
    rmsLinear: Math.round(meter.rmsLinear * 10000) / 10000,
    peakDb: Math.round(meter.peakDb * 10) / 10,
    rmsDb: Math.round(meter.rmsDb * 10) / 10,
    updatedAgeMs: Math.round(now - meter.updatedAt),
  });
  return {
    master: debug.master ? summarizeSnapshot(debug.master) : null,
    tracks: Object.fromEntries(Object.entries(debug.tracks).map(([trackId, meter]) => [
      trackId,
      summarizeSnapshot(meter),
    ])),
    demand: {
      master: debug.demand.master,
      tracks: debug.demand.tracks,
    },
  };
}

function summarizeDebugStack(stack: string | undefined): string[] {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1, 10)
    .map(line => line.trim())
    .filter(Boolean);
}

export async function measureStoreChurn(args: Record<string, unknown> = {}) {
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(60000, Math.round(args.durationMs)))
    : 10000;
  const sampleIntervalMs = typeof args.sampleIntervalMs === 'number' && Number.isFinite(args.sampleIntervalMs)
    ? Math.max(16, Math.min(1000, Math.round(args.sampleIntervalMs)))
    : 50;
  const maxEvents = typeof args.maxEvents === 'number' && Number.isFinite(args.maxEvents)
    ? Math.max(20, Math.min(500, Math.round(args.maxEvents)))
    : 200;

  const startedAt = performance.now();
  const events: StoreChurnEvent[] = [];
  const pushEvent = (source: string, detail?: Record<string, unknown>) => {
    events.push({
      elapsedMs: Math.round((performance.now() - startedAt) * 100) / 100,
      source,
      detail,
    });
    if (events.length > maxEvents) {
      events.shift();
    }
  };

  const disposers: Array<() => void> = [];
  const samples: Array<{ elapsedMs: number; gapMs: number; dirty: boolean }> = [];
  const longTasks: Array<Record<string, unknown>> = [];
  let observer: PerformanceObserver | null = null;
  let timerId: number | null = null;
  let last = startedAt;
  let previousTimelineClipsSignature = createTimelineClipsDebugSignature();
  let previousMediaPersistedSignature = createMediaPersistedDebugSignature();
  let previousAudioRuntimeSignature = createAudioRuntimeDebugSignature();

  const projectServiceForPatch = projectFileService as unknown as {
    markDirty: () => void;
    saveProject: () => Promise<boolean>;
  };
  const originalMarkDirty = projectServiceForPatch.markDirty.bind(projectFileService);
  const originalSaveProject = projectServiceForPatch.saveProject.bind(projectFileService);
  let markDirtyCount = 0;
  let saveProjectCount = 0;
  let saveProjectTotalMs = 0;
  let saveProjectMaxMs = 0;

  projectServiceForPatch.markDirty = () => {
    markDirtyCount += 1;
    pushEvent('project.markDirty', {
      dirty: projectFileService.hasUnsavedChanges(),
      stack: summarizeDebugStack(new Error().stack),
    });
    return originalMarkDirty();
  };

  projectServiceForPatch.saveProject = async () => {
    saveProjectCount += 1;
    const saveStartedAt = performance.now();
    pushEvent('project.saveProject.start', { dirty: projectFileService.hasUnsavedChanges() });
    try {
      return await originalSaveProject();
    } finally {
      const duration = performance.now() - saveStartedAt;
      saveProjectTotalMs += duration;
      saveProjectMaxMs = Math.max(saveProjectMaxMs, duration);
      pushEvent('project.saveProject.end', {
        durationMs: Math.round(duration * 100) / 100,
        dirty: projectFileService.hasUnsavedChanges(),
      });
    }
  };

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.push({
            name: entry.name,
            startTime: Math.round(entry.startTime * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
          pushEvent('performance.longtask', {
            durationMs: Math.round(entry.duration * 100) / 100,
          });
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = null;
    }
  }

  disposers.push(useTimelineStore.subscribe(
    state => state.clips,
    (clips) => {
      const nextSignature = createTimelineClipsDebugSignature();
      pushEvent('timeline.clips', {
        count: clips.length,
        signatureChanged: nextSignature !== previousTimelineClipsSignature,
      });
      previousTimelineClipsSignature = nextSignature;
    },
  ));

  disposers.push(useTimelineStore.subscribe(
    state => state.tracks,
    (tracks) => pushEvent('timeline.tracks', { count: tracks.length }),
  ));

  disposers.push(useTimelineStore.subscribe(
    state => (state as unknown as { clipStemSeparationJobs?: unknown }).clipStemSeparationJobs,
    (jobs) => pushEvent('timeline.stemJobs', { keys: Object.keys((jobs ?? {}) as Record<string, unknown>) }),
  ));

  disposers.push(useTimelineStore.subscribe(
    () => createAudioRuntimeDebugSignature(),
    (signature) => {
      pushEvent('timeline.audioRuntime', {
        signatureChanged: signature !== previousAudioRuntimeSignature,
      });
      previousAudioRuntimeSignature = signature;
    },
  ));

  disposers.push(useMediaStore.subscribe(
    state => state.files,
    (files) => {
      const nextSignature = createMediaPersistedDebugSignature();
      pushEvent('media.files', {
        count: files.length,
        signatureChanged: nextSignature !== previousMediaPersistedSignature,
      });
      previousMediaPersistedSignature = nextSignature;
    },
  ));

  try {
    timerId = window.setInterval(() => {
      const now = performance.now();
      samples.push({
        elapsedMs: Math.round(now - startedAt),
        gapMs: Math.round((now - last) * 100) / 100,
        dirty: projectFileService.hasUnsavedChanges(),
      });
      last = now;
    }, sampleIntervalMs);

    await new Promise((resolve) => window.setTimeout(resolve, durationMs));
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    observer?.disconnect();
    for (const dispose of disposers) {
      dispose();
    }
    projectServiceForPatch.markDirty = originalMarkDirty;
    projectServiceForPatch.saveProject = originalSaveProject;
  }

  const gapValues = samples.map((sample) => sample.gapMs);
  return {
    success: true,
    data: {
      durationMs,
      sampleIntervalMs,
      saveMode: useSettingsStore.getState().saveMode,
      projectDirty: projectFileService.hasUnsavedChanges(),
      markDirtyCount,
      saveProjectCount,
      saveProjectMs: {
        total: Math.round(saveProjectTotalMs * 100) / 100,
        max: Math.round(saveProjectMaxMs * 100) / 100,
        avg: saveProjectCount > 0
          ? Math.round((saveProjectTotalMs / saveProjectCount) * 100) / 100
          : 0,
      },
      stemClips: summarizeStemClipState(),
      mediaWaveforms: summarizeMediaWaveformPayloads(),
      runtimeAudioMeters: summarizeRuntimeAudioMeters(),
      sampleGapMs: summarizeNumberList(gapValues),
      overBudgetCount: gapValues.filter((gap) => gap > sampleIntervalMs * 1.75).length,
      longTasks,
      events,
      samples: samples.slice(-120),
      runtimeWarnings: getRuntimeDiagnostics({ limit: 40, level: 'WARN' }),
    },
  };
}
