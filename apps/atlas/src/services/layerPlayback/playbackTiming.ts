import type { SlotClipSettings } from '../../stores/mediaStore/types';
import type { LayerCompState, LayerPlaybackInfo, PlaybackWindow } from './layerPlaybackState';

type PlaybackEndAction = 'none' | 'hold' | 'clear';

export interface LayerPlaybackDecision extends LayerPlaybackInfo {
  endAction: PlaybackEndAction;
  nextAnchorTime?: number;
  nextPlaybackState?: LayerCompState['playbackState'];
}

export function resolvePlaybackWindow(
  duration: number,
  configured?: SlotClipSettings
): PlaybackWindow {
  const safeDuration = Math.max(duration, 0.05);

  if (!configured) {
    return {
      trimIn: 0,
      trimOut: safeDuration,
      endBehavior: 'loop',
    };
  }

  if (safeDuration <= 0.05) {
    return {
      trimIn: 0,
      trimOut: safeDuration,
      endBehavior: configured.endBehavior,
    };
  }

  const trimIn = Math.max(0, Math.min(configured.trimIn, safeDuration - 0.05));
  const trimOut = Math.max(trimIn + 0.05, Math.min(configured.trimOut, safeDuration));

  return {
    trimIn,
    trimOut,
    endBehavior: configured.endBehavior,
  };
}

export function resolveInitialLayerTime(
  duration: number,
  configured: SlotClipSettings | undefined,
  initialElapsed?: number
): number {
  const safeDuration = Math.max(duration, 0.05);
  if (!configured) {
    return Math.max(0, Math.min(initialElapsed ?? 0, safeDuration));
  }

  const trimIn = Math.max(0, Math.min(configured.trimIn, safeDuration));
  const trimOut = Math.max(trimIn, Math.min(configured.trimOut, safeDuration));
  const candidate = initialElapsed ?? trimIn;

  if (candidate < trimIn || candidate > trimOut) {
    return trimIn;
  }

  return candidate;
}

export function getAnchoredLayerTime(state: LayerCompState, nowMs: number): number {
  if (state.playbackState === 'playing') {
    const elapsed = (nowMs - state.anchorStartedAt) / 1000;
    return state.anchorTime + elapsed;
  }

  return state.anchorTime;
}

export function resolveLayerPlaybackDecision(
  state: LayerCompState,
  playbackWindow: PlaybackWindow,
  rawTime: number
): LayerPlaybackDecision {
  const { trimIn, trimOut, endBehavior } = playbackWindow;

  if (state.playbackState !== 'playing') {
    return {
      compositionId: state.compositionId,
      currentTime: Math.max(trimIn, Math.min(rawTime, trimOut)),
      trimIn,
      trimOut,
      endBehavior,
      playbackState: state.playbackState,
      shouldRender: !state.clearRequested,
      endAction: 'none',
    };
  }

  if (endBehavior === 'loop') {
    const span = Math.max(trimOut - trimIn, 0.05);
    const wrappedTime = trimIn + ((((rawTime - trimIn) % span) + span) % span);
    return {
      compositionId: state.compositionId,
      currentTime: Math.max(trimIn, Math.min(wrappedTime, trimOut)),
      trimIn,
      trimOut,
      endBehavior,
      playbackState: state.playbackState,
      shouldRender: true,
      endAction: 'none',
    };
  }

  if (rawTime <= trimOut) {
    return {
      compositionId: state.compositionId,
      currentTime: Math.max(trimIn, rawTime),
      trimIn,
      trimOut,
      endBehavior,
      playbackState: state.playbackState,
      shouldRender: true,
      endAction: 'none',
    };
  }

  if (endBehavior === 'hold') {
    return {
      compositionId: state.compositionId,
      currentTime: trimOut,
      trimIn,
      trimOut,
      endBehavior,
      playbackState: 'paused',
      shouldRender: true,
      endAction: 'hold',
      nextAnchorTime: trimOut,
      nextPlaybackState: 'paused',
    };
  }

  return {
    compositionId: state.compositionId,
    currentTime: trimOut,
    trimIn,
    trimOut,
    endBehavior,
    playbackState: 'stopped',
    shouldRender: false,
    endAction: 'clear',
    nextAnchorTime: trimIn,
    nextPlaybackState: 'stopped',
  };
}
