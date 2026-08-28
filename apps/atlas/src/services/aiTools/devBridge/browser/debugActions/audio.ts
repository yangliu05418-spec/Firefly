import { useTimelineStore } from '../../../../../stores/timeline';
import { useMediaStore } from '../../../../../stores/mediaStore';
import { DEFAULT_STEM_MODEL_ID, getStemModelManager } from '../../../../audio/stemSeparation';
import { projectFileService } from '../../../../projectFileService';
import { getRuntimeDiagnostics } from '../../../../runtimeDiagnostics';
import { summarizeNumberList } from './performance';

async function withDebugTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

export async function collectStemDebugState(args: Record<string, unknown> = {}) {
  const timelineState = useTimelineStore.getState();
  const modelId = typeof args.modelId === 'string' && args.modelId.trim()
    ? args.modelId.trim()
    : DEFAULT_STEM_MODEL_ID;
  const now = Date.now();
  let modelCacheStatus: unknown = null;
  let modelCacheError: string | null = null;

  try {
    modelCacheStatus = await withDebugTimeout(
      getStemModelManager().getCacheStatus(modelId),
      2500,
      'Timed out while reading stem model cache status.',
    );
  } catch (error) {
    modelCacheError = error instanceof Error ? error.message : String(error);
  }

  const interestingClipIds = new Set<string>([
    ...Array.from(timelineState.selectedClipIds),
    ...Object.keys(timelineState.clipStemSeparationJobs),
  ]);
  const includeAllClips = args.includeAll === true || args.all === true;
  if (timelineState.primarySelectedClipId) {
    interestingClipIds.add(timelineState.primarySelectedClipId);
  }
  if (typeof args.clipId === 'string' && args.clipId.trim()) {
    interestingClipIds.add(args.clipId.trim());
  }
  for (const job of Object.values(timelineState.clipStemSeparationJobs)) {
    interestingClipIds.add(job.clipId);
    interestingClipIds.add(job.requestedClipId);
  }

  const clips = timelineState.clips
    .filter((clip) =>
      includeAllClips ||
      interestingClipIds.has(clip.id) ||
      (typeof clip.linkedClipId === 'string' && interestingClipIds.has(clip.linkedClipId))
    )
    .map((clip) => ({
      id: clip.id,
      name: clip.name,
      trackId: clip.trackId,
      sourceType: clip.source?.type ?? null,
      linkedClipId: clip.linkedClipId ?? null,
      hasFile: clip.file instanceof File,
      fileName: clip.file instanceof File ? clip.file.name : null,
      fileType: clip.file instanceof File ? clip.file.type : null,
      fileSize: clip.file instanceof File ? clip.file.size : null,
      duration: clip.duration,
      inPoint: clip.inPoint ?? null,
      outPoint: clip.outPoint ?? null,
      hasSourceAnalysisRefs: Boolean(clip.audioState?.sourceAnalysisRefs),
      hasProcessedAnalysisRefs: Boolean(clip.audioState?.processedAnalysisRefs),
      hasStemSeparation: Boolean(clip.audioState?.stemSeparation),
      stemCount: clip.audioState?.stemSeparation?.stems.length ?? 0,
      waveformLength: clip.waveform?.length ?? 0,
      waveformChannelLengths: clip.waveformChannels?.map(channel => channel.length) ?? [],
      stemSeparation: clip.audioState?.stemSeparation
        ? {
            mixMode: clip.audioState.stemSeparation.mixMode,
            soloStemId: clip.audioState.stemSeparation.soloStemId ?? null,
            sourceGainDb: clip.audioState.stemSeparation.sourceGainDb ?? 0,
            stems: clip.audioState.stemSeparation.stems.map((stem) => ({
              id: stem.id,
              kind: stem.kind,
              label: stem.label,
              enabled: stem.enabled,
              gainDb: stem.gainDb,
              mediaFileId: stem.mediaFileId ?? null,
              hasWaveform: Boolean(stem.waveform?.length),
              waveformLength: stem.waveform?.length ?? 0,
            })),
          }
        : null,
    }));

  return {
    success: true,
    data: {
      selectedClipIds: Array.from(timelineState.selectedClipIds),
      primarySelectedClipId: timelineState.primarySelectedClipId,
      clipStemSeparationJobs: Object.fromEntries(
        Object.entries(timelineState.clipStemSeparationJobs).map(([clipId, job]) => [
          clipId,
          {
            ...job,
            progressPercent: Math.round(Math.max(0, Math.min(1, job.progress)) * 100),
            ageMs: now - job.startedAt,
            updatedAgoMs: now - job.updatedAt,
          },
        ]),
      ),
      clips,
      modelCacheStatus,
      modelCacheError,
      runtimeStemDiagnostics: getRuntimeDiagnostics({ limit: 50, level: 'DEBUG', search: 'stem' }),
      runtimeWarnings: getRuntimeDiagnostics({ limit: 30, level: 'WARN' }),
    },
  };
}

type AudioBenchmarkMode = 'html' | 'webaudio' | 'buffer';

function isAudioBenchmarkMode(value: unknown): value is AudioBenchmarkMode {
  return value === 'html' || value === 'webaudio' || value === 'buffer';
}

async function waitForAudioReady(audio: HTMLAudioElement, timeoutMs = 5000): Promise<void> {
  if (audio.readyState >= 3) return;

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for audio element to become ready.'));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('canplaythrough', onReady);
      audio.removeEventListener('error', onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(audio.error?.message || 'Audio element failed to load.'));
    };
    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('canplaythrough', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.load();
  });
}


async function collectAudioBenchmarkSources(args: Record<string, unknown>) {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const clipId = typeof args.clipId === 'string' && args.clipId.trim()
    ? args.clipId.trim()
    : timelineState.primarySelectedClipId ?? Array.from(timelineState.selectedClipIds)[0] ?? '';
  const clip = timelineState.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    throw new Error(`Clip not found: ${clipId || '(none)'}`);
  }

  const mediaFileById = new Map(mediaState.files.map((file) => [file.id, file]));
  const entries: Array<{ role: string; label: string; mediaFileId: string }> = [];
  const includeSource = args.includeSource !== false;
  const sourceMediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  if (includeSource && sourceMediaFileId) {
    entries.push({ role: 'source', label: clip.name || 'Source', mediaFileId: sourceMediaFileId });
  }

  for (const stem of clip.audioState?.stemSeparation?.stems ?? []) {
    if (!stem.mediaFileId) continue;
    entries.push({ role: 'stem', label: stem.label, mediaFileId: stem.mediaFileId });
  }

  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.max(1, Math.floor(args.limit))
    : entries.length;

  const sources = [];
  for (const entry of entries.slice(0, limit)) {
    const mediaFile = mediaFileById.get(entry.mediaFileId);
    if (!mediaFile) continue;

    const storageKey = mediaFile.audioProxyStorageKey || mediaFile.fileHash || mediaFile.id;
    let url = mediaFile.audioProxyUrl || '';
    let revoke = false;
    let source = mediaFile.audioProxyUrl ? 'audioProxyUrl' : '';

    if (!url) {
      const proxyAudio = await projectFileService.getProxyAudio(storageKey);
      if (proxyAudio) {
        url = URL.createObjectURL(proxyAudio);
        revoke = true;
        source = 'projectProxyAudio';
      }
    }

    if (!url && mediaFile.url) {
      url = mediaFile.url;
      source = 'mediaFileUrl';
    }

    if (!url) continue;

    sources.push({
      ...entry,
      mediaFileName: mediaFile.name,
      source,
      url,
      revoke,
    });
  }

  return { clipId: clip.id, clipName: clip.name, sources };
}

export async function runAudioElementBenchmark(args: Record<string, unknown> = {}) {
  const mode: AudioBenchmarkMode = isAudioBenchmarkMode(args.mode) ? args.mode : 'html';
  const durationMs = typeof args.durationMs === 'number' && Number.isFinite(args.durationMs)
    ? Math.max(500, Math.min(15000, Math.round(args.durationMs)))
    : 5000;
  const sampleIntervalMs = typeof args.sampleIntervalMs === 'number' && Number.isFinite(args.sampleIntervalMs)
    ? Math.max(20, Math.min(1000, Math.round(args.sampleIntervalMs)))
    : 100;
  const offsetSeconds = typeof args.offsetSeconds === 'number' && Number.isFinite(args.offsetSeconds)
    ? Math.max(0, args.offsetSeconds)
    : 62;
  const outputGain = typeof args.volume === 'number' && Number.isFinite(args.volume)
    ? Math.max(0, Math.min(1, args.volume))
    : 0.0001;
  const { clipId, clipName, sources } = await collectAudioBenchmarkSources(args);
  if (sources.length === 0) {
    return { success: false, error: 'No playable audio proxy/source URLs found for benchmark.' };
  }

  const audioContext = mode === 'webaudio' || mode === 'buffer' ? new AudioContext() : null;
  const routeNodes: AudioNode[] = [];
  const createdAudios: HTMLAudioElement[] = [];
  const samples: Array<Record<string, unknown>> = [];
  const startedAt = performance.now();
  let timerId: number | null = null;

  try {
    if (audioContext) {
      await audioContext.resume();
    }

    if (mode === 'buffer') {
      const decoded = [];
      for (const source of sources) {
        const response = await fetch(source.url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await audioContext!.decodeAudioData(arrayBuffer.slice(0));
        decoded.push({ source, buffer });
      }

      const gain = audioContext!.createGain();
      gain.gain.value = outputGain;
      gain.connect(audioContext!.destination);
      const startAtContextTime = audioContext!.currentTime + 0.15;
      for (const item of decoded) {
        const sourceNode = audioContext!.createBufferSource();
        sourceNode.buffer = item.buffer;
        sourceNode.connect(gain);
        sourceNode.start(startAtContextTime, Math.min(offsetSeconds, Math.max(0, item.buffer.duration - 0.1)));
        routeNodes.push(sourceNode);
      }

      const startPerf = performance.now();
      const startContext = audioContext!.currentTime;
      let lastSampleAt = startPerf;
      timerId = window.setInterval(() => {
        const now = performance.now();
        samples.push({
          elapsedMs: Math.round(now - startPerf),
          sampleGapMs: Math.round((now - lastSampleAt) * 100) / 100,
          contextElapsedMs: Math.round((audioContext!.currentTime - startContext) * 1000),
        });
        lastSampleAt = now;
      }, sampleIntervalMs);

      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
    } else {
      const audios = sources.map((source) => {
        const audio = new Audio();
        audio.src = source.url;
        audio.preload = 'auto';
        audio.volume = mode === 'webaudio' ? 1 : outputGain;
        createdAudios.push(audio);
        return { source, audio };
      });

      await Promise.all(audios.map(({ audio }) => waitForAudioReady(audio)));

      if (mode === 'webaudio') {
        for (const { audio } of audios) {
          const mediaNode = audioContext!.createMediaElementSource(audio);
          const gain = audioContext!.createGain();
          gain.gain.value = outputGain;
          mediaNode.connect(gain);
          gain.connect(audioContext!.destination);
          routeNodes.push(mediaNode, gain);
        }
      }

      for (const { audio } of audios) {
        audio.currentTime = Math.min(offsetSeconds, Math.max(0, (Number.isFinite(audio.duration) ? audio.duration : offsetSeconds + 1) - 0.1));
      }

      const playStart = performance.now();
      const playResults = await Promise.all(audios.map(async ({ source, audio }) => {
        const before = performance.now();
        await audio.play();
        return {
          label: source.label,
          startDelayMs: Math.round((performance.now() - before) * 100) / 100,
          readyState: audio.readyState,
        };
      }));
      const startTimes = audios.map(({ audio }) => audio.currentTime);
      let lastSampleAt = playStart;
      timerId = window.setInterval(() => {
        const now = performance.now();
        const times = audios.map(({ audio }) => audio.currentTime);
        const expected = offsetSeconds + ((now - playStart) / 1000);
        const driftsMs = times.map((time) => (time - expected) * 1000);
        const spreadMs = (Math.max(...times) - Math.min(...times)) * 1000;
        samples.push({
          elapsedMs: Math.round(now - playStart),
          sampleGapMs: Math.round((now - lastSampleAt) * 100) / 100,
          spreadMs: Math.round(spreadMs * 100) / 100,
          maxAbsDriftMs: Math.round(Math.max(...driftsMs.map((value) => Math.abs(value))) * 100) / 100,
          times: times.map((time) => Math.round(time * 1000) / 1000),
          driftsMs: driftsMs.map((value) => Math.round(value * 100) / 100),
        });
        lastSampleAt = now;
      }, sampleIntervalMs);

      await new Promise((resolve) => window.setTimeout(resolve, durationMs));
      samples.push({
        elapsedMs: Math.round(performance.now() - playStart),
        finalTimes: audios.map(({ audio }) => Math.round(audio.currentTime * 1000) / 1000),
        startTimes: startTimes.map((time) => Math.round(time * 1000) / 1000),
        playResults,
      });
    }
  } finally {
    if (timerId !== null) window.clearInterval(timerId);
    for (const audio of createdAudios) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    for (const node of routeNodes) {
      try {
        node.disconnect();
      } catch {
        // Ignore cleanup errors in debug tooling.
      }
    }
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close().catch(() => {});
    }
    for (const source of sources) {
      if (source.revoke) URL.revokeObjectURL(source.url);
    }
  }

  const sampleGaps = samples
    .map((sample) => typeof sample.sampleGapMs === 'number' ? sample.sampleGapMs : 0)
    .filter((value) => value > 0);
  const spreads = samples
    .map((sample) => typeof sample.spreadMs === 'number' ? sample.spreadMs : 0)
    .filter((value) => value > 0);
  const drifts = samples
    .map((sample) => typeof sample.maxAbsDriftMs === 'number' ? sample.maxAbsDriftMs : 0)
    .filter((value) => value > 0);

  return {
    success: true,
    data: {
      clipId,
      clipName,
      mode,
      durationMs,
      sampleIntervalMs,
      offsetSeconds,
      outputGain,
      sourceCount: sources.length,
      sources: sources.map(({ url: _url, revoke: _revoke, ...source }) => source),
      summary: {
        sampleGapMs: summarizeNumberList(sampleGaps),
        spreadMs: summarizeNumberList(spreads),
        maxAbsDriftMs: summarizeNumberList(drifts),
        longMainThreadGaps: sampleGaps.filter((gap) => gap > sampleIntervalMs * 1.75).length,
      },
      samples: samples.slice(-80),
      elapsedMs: Math.round(performance.now() - startedAt),
    },
  };
}
