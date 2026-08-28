import { createAudioRegionEffectInstance } from '../audioRegionEffectOperation';
import type { AudioEffectInstance, Effect, TimelineClip } from '../../nodeGraph/clipGraphProjectionDomain';
import {
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from './processorInstanceMapping';
import { createNeutralEffectSettings, mergeEffectSettings } from './routeSettingsMath';
import type { AudioRouteEffectSettings } from './routeSettingsModel';

interface ClipRouteEffectSettingsInput {
  clip: TimelineClip;
  interpolatedClipEffects: readonly Effect[];
  sourceTime?: number;
}

function sourceTimeInAudioEditOperationRange(
  operation: { timeRange?: { start: number; end: number } },
  sourceTime: number,
): boolean {
  if (!operation.timeRange || !Number.isFinite(sourceTime)) return false;
  const start = Math.min(operation.timeRange.start, operation.timeRange.end);
  const end = Math.max(operation.timeRange.start, operation.timeRange.end);
  return sourceTime >= start && sourceTime <= end;
}

export function collectAudioRegionEffectRouteSettings(
  clip: Pick<TimelineClip, 'audioState'>,
  sourceTime: number,
): AudioRouteEffectSettings {
  const effects = (clip.audioState?.editStack ?? [])
    .filter(operation =>
      operation.enabled !== false &&
      operation.type === 'effect' &&
      sourceTimeInAudioEditOperationRange(operation, sourceTime)
    )
    .map(operation => createAudioRegionEffectInstance(operation))
    .filter((effect): effect is AudioEffectInstance => effect !== null);

  return collectAudioEffectInstanceRouteSettings(effects);
}

export function collectClipRouteEffectSettings(
  input: ClipRouteEffectSettingsInput,
): AudioRouteEffectSettings {
  const clipAudioEffectIds = new Set((input.clip.audioState?.effectStack ?? []).map(effect => effect.id));
  const clipAudioSettings = collectAudioEffectInstanceRouteSettings(input.clip.audioState?.effectStack);
  const legacyClipSettings = collectLegacyAudioEffectRouteSettings(input.interpolatedClipEffects, clipAudioEffectIds);
  const regionEffectSettings = typeof input.sourceTime === 'number'
    ? collectAudioRegionEffectRouteSettings(input.clip, input.sourceTime)
    : createNeutralEffectSettings();

  const settings = createNeutralEffectSettings();
  mergeEffectSettings(settings, clipAudioSettings);
  mergeEffectSettings(settings, legacyClipSettings);
  mergeEffectSettings(settings, regionEffectSettings);

  return settings;
}
