import type { TimelineTrack } from '../../nodeGraph/clipGraphProjectionDomain';
import { collectAudioEffectInstanceRouteSettings } from './processorInstanceMapping';
import { getTrackLinearVolume, getTrackSendReturnGain } from './routeSettingsMath';
import type { AudioRouteEffectSettings } from './routeSettingsModel';

export function collectTrackRouteEffectSettings(
  track: TimelineTrack | undefined,
): AudioRouteEffectSettings {
  const settings = collectAudioEffectInstanceRouteSettings(track?.audioState?.effectStack);
  if (!track) return settings;

  const trackVolume = getTrackLinearVolume(track);
  const sendReturnGain = getTrackSendReturnGain(track, trackVolume);
  settings.volume *= trackVolume + sendReturnGain;

  return settings;
}
