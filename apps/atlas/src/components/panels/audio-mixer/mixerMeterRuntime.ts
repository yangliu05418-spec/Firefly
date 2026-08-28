import { useRuntimeAudioMeterSnapshot } from '../../../services/audio/runtimeAudioMeterHooks';
import type { RuntimeAudioMeterFeature, RuntimeAudioMeterScope } from '../../../services/audio/runtimeAudioMeterBus';
import type { AudioMeterSnapshot } from '../../../types/audio';
import type { FxWindowTarget } from './audioMixerTypes';

// Mixer strips render many meters at once. Keep the hot strip path to level +
// stereo only; detailed panels opt into phase/dynamics/spectrum when needed.
export const MIXER_METER_VISUAL_FEATURES = ['level', 'stereo'] as const;
export const MIXER_METER_READOUT_FEATURES = ['level'] as const;
export const MIXER_METER_DYNAMICS_FEATURES = ['dynamics'] as const;

const MIXER_METER_READOUT_MAX_FPS = 4;

export function getMixerRuntimeAudioMeterScope(
  scope: FxWindowTarget['scope'] | undefined,
  trackId?: string,
): RuntimeAudioMeterScope | undefined {
  return scope === 'track' && trackId
    ? { kind: 'track', trackId }
    : scope === 'master'
      ? { kind: 'master' }
      : undefined;
}

export function useMixerRuntimeAudioMeter(
  scope: FxWindowTarget['scope'] | undefined,
  trackId?: string,
  features: readonly RuntimeAudioMeterFeature[] = MIXER_METER_READOUT_FEATURES,
): AudioMeterSnapshot | undefined {
  const busScope = getMixerRuntimeAudioMeterScope(scope, trackId);
  return useRuntimeAudioMeterSnapshot(busScope, {
    features,
    maxFps: MIXER_METER_READOUT_MAX_FPS,
  });
}
