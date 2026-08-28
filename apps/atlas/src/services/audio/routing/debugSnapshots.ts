import type { AudioRoute, AudioRoutingDebugCounters, MasterAudioRoute } from './routeGraphTypes';

function roundDebug(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function getMediaElementSourceSummary(element: HTMLMediaElement): Record<string, unknown> {
  const currentSrc = element.currentSrc || element.src || '';
  const srcKind = currentSrc.startsWith('blob:')
    ? 'blob'
    : currentSrc.startsWith('data:')
      ? 'data'
      : currentSrc
        ? 'url'
        : 'none';
  return {
    hasSrc: Boolean(currentSrc),
    srcKind,
    srcTail: currentSrc ? currentSrc.slice(-32) : '',
  };
}

function getRouteElementDebugSnapshot(element: HTMLMediaElement): Record<string, unknown> {
  return {
    tagName: element.tagName.toLowerCase(),
    paused: element.paused,
    ended: element.ended,
    muted: element.muted,
    volume: roundDebug(element.volume),
    playbackRate: roundDebug(element.playbackRate),
    defaultPlaybackRate: roundDebug(element.defaultPlaybackRate),
    currentTime: roundDebug(element.currentTime),
    duration: Number.isFinite(element.duration) ? roundDebug(element.duration) : null,
    readyState: element.readyState,
    networkState: element.networkState,
    seeking: element.seeking,
    error: element.error
      ? {
          code: element.error.code,
          message: element.error.message,
        }
      : null,
    ...getMediaElementSourceSummary(element),
  };
}

function getProcessorDebugSnapshot(processor: AudioRoute['processorNodes'][number]): Record<string, unknown> {
  return {
    id: processor.id,
    type: processor.type,
    nodeCount: processor.nodes.length,
    hasScriptProcessor: Boolean(processor.scriptProcessor),
    lastReverbSignature: processor.lastReverbSignature,
    lastSaturationSignature: processor.lastSaturationSignature,
  };
}

interface AudioRoutingDebugSnapshotArgs {
  context: (AudioContext & { outputLatency?: number }) | null;
  masterRoute: MasterAudioRoute | null;
  routes: ReadonlyMap<HTMLMediaElement, AudioRoute>;
  counters: AudioRoutingDebugCounters;
  reverbImpulseCacheLimit: number;
  reverbImpulseCacheSize: number;
  resumePending: boolean;
}

export function buildAudioRoutingDebugSnapshot({
  context,
  masterRoute,
  routes,
  counters,
  reverbImpulseCacheLimit,
  reverbImpulseCacheSize,
  resumePending,
}: AudioRoutingDebugSnapshotArgs): Record<string, unknown> {
  return {
    context: context
      ? {
          state: context.state,
          sampleRate: context.sampleRate,
          currentTime: roundDebug(context.currentTime),
          baseLatencyMs: roundDebug((context.baseLatency ?? 0) * 1000, 2),
          outputLatencyMs: typeof context.outputLatency === 'number'
            ? roundDebug(context.outputLatency * 1000, 2)
            : undefined,
          destinationMaxChannelCount: context.destination.maxChannelCount,
          resumePending,
        }
      : null,
    routeCount: routes.size,
    masterRoute: masterRoute
      ? {
          gain: roundDebug(masterRoute.gainNode.gain.value),
          processorCount: masterRoute.processorNodes.length,
          processorTypes: masterRoute.processorNodes.map(processor => processor.type),
          processors: masterRoute.processorNodes.map(getProcessorDebugSnapshot),
          eqGains: masterRoute.lastEQGains.map(gain => roundDebug(gain, 2)),
          analyserFftSize: masterRoute.analyserNode.fftSize,
          lastProcessorSignature: masterRoute.lastProcessorSignature,
        }
      : null,
    routes: Array.from(routes.entries()).map(([element, route], index) => ({
      index,
      element: getRouteElementDebugSnapshot(element),
      gain: roundDebug(route.gainNode.gain.value),
      pan: roundDebug(route.panNode.pan.value),
      processorCount: route.processorNodes.length,
      processorTypes: route.processorNodes.map(processor => processor.type),
      processors: route.processorNodes.map(getProcessorDebugSnapshot),
      eqGains: route.lastEQGains.map(gain => roundDebug(gain, 2)),
      analyserFftSize: route.analyserNode.fftSize,
      isConnected: route.isConnected,
      lastProcessorSignature: route.lastProcessorSignature,
    })),
    counters: {
      ...counters,
      reverbImpulseCacheLimit,
      reverbImpulseCacheSize,
      reverbImpulseBuildMsAvg: counters.reverbImpulseBuilds > 0
        ? roundDebug(
            counters.reverbImpulseBuildMsTotal / counters.reverbImpulseBuilds,
            2,
          )
        : 0,
      reverbImpulseBuildMsMax: roundDebug(counters.reverbImpulseBuildMsMax, 2),
    },
  };
}
