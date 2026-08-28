import type { AudioRouteEffectSettings, LiveAudioRouteProcessor } from '../audio/audioGraphRouteSettings';

export interface ScrubAudioOptions {
  volume?: number;
  eqGains?: number[];
  pan?: number;
  processors?: LiveAudioRouteProcessor[];
  masterRoute?: AudioRouteEffectSettings;
}

export interface ScrubGrain {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startTime: number;
}
