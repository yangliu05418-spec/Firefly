import { useMemo } from 'react';
import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore/types';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineControlsProps } from '../types';
import { useTimelineProxyBatchStatus } from './useTimelineProxyBatchStatus';

type TimelineControlsBaseProps = Omit<
  TimelineControlsProps,
  | 'variant'
  | 'mediaFilesWithProxy'
  | 'mediaFilesProxyTotal'
  | 'generatingProxyIndex'
  | 'showTranscriptMarkers'
  | 'onToggleProxy'
  | 'onToggleTranscriptMarkers'
  | 'slotGridActive'
>;

interface UseTimelineControlsPropsParams extends TimelineControlsBaseProps {
  mediaFiles: readonly MediaFile[];
  slotGridProgress: number;
}

export function useTimelineControlsProps({
  isPlaying,
  loopPlayback,
  playheadPosition,
  duration,
  zoom,
  snappingEnabled,
  inPoint,
  outPoint,
  proxyEnabled,
  currentlyGeneratingProxyId,
  mediaFiles,
  thumbnailsEnabled,
  waveformsEnabled,
  audioDisplayMode,
  audioFocusMode,
  showAudioRegionEditMarkers,
  trackFocusMode,
  toolMode,
  onPlay,
  onPause,
  onStop,
  onToggleLoop,
  onSetZoom,
  onToggleSnapping,
  onToggleThumbnails,
  onToggleWaveforms,
  onSetAudioDisplayMode,
  onToggleAudioFocusMode,
  onToggleAudioRegionEditMarkers,
  onSetTrackFocusMode,
  onToggleCutTool,
  onFitToWindow,
  onToggleSlotGrid,
  slotGridProgress,
  formatTime,
}: UseTimelineControlsPropsParams): Omit<TimelineControlsProps, 'variant'> {
  const showTranscriptMarkers = useTimelineStore(state => state.showTranscriptMarkers);
  const toggleTranscriptMarkers = useTimelineStore(state => state.toggleTranscriptMarkers);
  const toggleProxyEnabled = useMediaStore(state => state.toggleProxyEnabled);
  const proxyBatchStatus = useTimelineProxyBatchStatus(mediaFiles, currentlyGeneratingProxyId);

  return useMemo(() => ({
    isPlaying,
    loopPlayback,
    playheadPosition,
    duration,
    zoom,
    snappingEnabled,
    inPoint,
    outPoint,
    proxyEnabled,
    currentlyGeneratingProxyId,
    mediaFilesWithProxy: proxyBatchStatus.readyCount,
    mediaFilesProxyTotal: proxyBatchStatus.totalCount,
    generatingProxyIndex: proxyBatchStatus.generatingIndex,
    showTranscriptMarkers,
    thumbnailsEnabled,
    waveformsEnabled,
    audioDisplayMode,
    audioFocusMode,
    showAudioRegionEditMarkers,
    trackFocusMode,
    toolMode,
    onPlay,
    onPause,
    onStop,
    onToggleLoop,
    onSetZoom,
    onToggleSnapping,
    onToggleProxy: toggleProxyEnabled,
    onToggleTranscriptMarkers: toggleTranscriptMarkers,
    onToggleThumbnails,
    onToggleWaveforms,
    onSetAudioDisplayMode,
    onToggleAudioFocusMode,
    onToggleAudioRegionEditMarkers,
    onSetTrackFocusMode,
    onToggleCutTool,
    onFitToWindow,
    onToggleSlotGrid,
    slotGridActive: slotGridProgress > 0.5,
    formatTime,
  }), [
    audioDisplayMode,
    audioFocusMode,
    currentlyGeneratingProxyId,
    duration,
    formatTime,
    inPoint,
    isPlaying,
    loopPlayback,
    onFitToWindow,
    onPause,
    onPlay,
    onSetAudioDisplayMode,
    onSetTrackFocusMode,
    onSetZoom,
    onStop,
    onToggleAudioFocusMode,
    onToggleAudioRegionEditMarkers,
    onToggleCutTool,
    onToggleLoop,
    onToggleSlotGrid,
    onToggleSnapping,
    onToggleThumbnails,
    onToggleWaveforms,
    outPoint,
    playheadPosition,
    proxyBatchStatus.generatingIndex,
    proxyBatchStatus.readyCount,
    proxyBatchStatus.totalCount,
    proxyEnabled,
    showAudioRegionEditMarkers,
    showTranscriptMarkers,
    snappingEnabled,
    slotGridProgress,
    thumbnailsEnabled,
    toggleProxyEnabled,
    toggleTranscriptMarkers,
    toolMode,
    trackFocusMode,
    waveformsEnabled,
    zoom,
  ]);
}
