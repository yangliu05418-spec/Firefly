import type { Effect, MasterAudioState, TimelineClip, TimelineTrack } from '../../types';
import { collectClipRouteEffectSettings, collectAudioRegionEffectRouteSettings } from './graphRoute/clipRouteSettings';
import { collectMasterRouteEffectSettings } from './graphRoute/masterRouteSettings';
import {
  audioGraphPlanStepsToEffectInstances,
  collectAudioEffectInstanceRouteSettings,
  collectLegacyAudioEffectRouteSettings,
} from './graphRoute/processorInstanceMapping';
import {
  createNeutralEffectSettings,
  getTrackAudioMuted,
  getTrackAudioSolo,
  getTrackPan,
  getTrackVolumeDb,
  hasAnyAudibleSolo,
  isAudibleTrack,
  mergeEffectSettings,
} from './graphRoute/routeSettingsMath';
import { collectTrackRouteEffectSettings } from './graphRoute/trackRouteSettings';
import type { LiveAudioRouteSettings } from './graphRoute/routeSettingsModel';

export type {
  AudioRouteEffectSettings,
  LiveAudioBiquadFilterType,
  LiveAudioRouteProcessor,
  LiveAudioRouteSettings,
} from './graphRoute/routeSettingsModel';

export {
  audioGraphPlanStepsToEffectInstances,
  collectAudioEffectInstanceRouteSettings,
  collectAudioRegionEffectRouteSettings,
  collectLegacyAudioEffectRouteSettings,
  getTrackAudioMuted,
  getTrackAudioSolo,
  getTrackPan,
  getTrackVolumeDb,
  hasAnyAudibleSolo,
  isAudibleTrack,
};

/**
 * Track-level live route settings (no clip), used to route a generated per-track
 * source -- the MIDI synth bus -- through the same gain/EQ/FX/pan/sends/master path
 * as media tracks (issue #182, Phase 4b Step 2). Mirrors the track + master parts
 * of createLiveAudioRouteSettings.
 */
export function createTrackLiveAudioRouteSettings(input: {
  track: TimelineTrack;
  masterAudioState?: MasterAudioState;
}): LiveAudioRouteSettings {
  const trackEffectSettings = collectTrackRouteEffectSettings(input.track);
  const masterEffectSettings = collectMasterRouteEffectSettings(input.masterAudioState);

  const route = createNeutralEffectSettings();
  mergeEffectSettings(route, trackEffectSettings);

  return {
    ...route,
    master: masterEffectSettings,
    muted: getTrackAudioMuted(input.track),
    pan: getTrackPan(input.track),
  };
}

export function createLiveAudioRouteSettings(input: {
  clip: TimelineClip;
  track?: TimelineTrack;
  masterAudioState?: MasterAudioState;
  interpolatedClipEffects: readonly Effect[];
  sourceTime?: number;
}): LiveAudioRouteSettings {
  const clipEffectSettings = collectClipRouteEffectSettings({
    clip: input.clip,
    interpolatedClipEffects: input.interpolatedClipEffects,
    sourceTime: input.sourceTime,
  });
  const trackEffectSettings = collectTrackRouteEffectSettings(input.track);
  const masterEffectSettings = collectMasterRouteEffectSettings(input.masterAudioState);

  const route = createNeutralEffectSettings();
  mergeEffectSettings(route, clipEffectSettings);
  mergeEffectSettings(route, trackEffectSettings);

  return {
    ...route,
    master: masterEffectSettings,
    muted: input.clip.audioState?.muted === true || (input.track ? getTrackAudioMuted(input.track) : false),
    pan: input.track ? getTrackPan(input.track) : 0,
  };
}
