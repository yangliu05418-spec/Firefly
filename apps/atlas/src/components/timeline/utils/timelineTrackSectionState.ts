import type { RefObject } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { ClipDragState } from '../types';
import type { TrackSectionKind } from './timelineHostTypes';
import { FOCUS_CONTEXT_SECTION_HEIGHT } from './timelineHostConstants';
import { clampScrollY } from './timelineHostLayout';

interface BuildTimelineTrackSectionStateProps {
  audioScrollY: number;
  audioSectionHeight: number;
  audioSectionViewportRef: RefObject<HTMLDivElement | null>;
  clipAnimationPhase: string;
  clipDrag: ClipDragState | null;
  clipMap: Map<string, TimelineClip>;
  displayedAudioTracks: TimelineTrack[];
  displayedVideoTracks: TimelineTrack[];
  expandedVideoSectionContentHeight: number;
  forceVideoBottomScroll: boolean;
  getFocusContextTrackHeight: (sectionKind: TrackSectionKind) => number;
  getSectionTrackHeight: (track: TimelineTrack, sectionKind: TrackSectionKind) => number;
  isSectionCollapsed: (sectionKind: TrackSectionKind) => boolean;
  sectionKind: TrackSectionKind;
  splitDragPinVideoBottom: boolean;
  timelineViewAudioTracks: TimelineTrack[];
  timelineViewTrackMap: Map<string, TimelineTrack>;
  timelineViewVideoTracks: TimelineTrack[];
  trackMap: Map<string, TimelineTrack>;
  videoScrollY: number;
  videoSectionHeight: number;
  videoSectionViewportRef: RefObject<HTMLDivElement | null>;
}

export function buildTimelineTrackSectionState({
  audioScrollY,
  audioSectionHeight,
  audioSectionViewportRef,
  clipAnimationPhase,
  clipDrag,
  clipMap,
  displayedAudioTracks,
  displayedVideoTracks,
  expandedVideoSectionContentHeight,
  forceVideoBottomScroll,
  getFocusContextTrackHeight,
  getSectionTrackHeight,
  isSectionCollapsed,
  sectionKind,
  splitDragPinVideoBottom,
  timelineViewAudioTracks,
  timelineViewTrackMap,
  timelineViewVideoTracks,
  trackMap,
  videoScrollY,
  videoSectionHeight,
  videoSectionViewportRef,
}: BuildTimelineTrackSectionStateProps) {
  const isVideoSection = sectionKind === 'video';
  const sectionTracks = isVideoSection ? displayedVideoTracks : displayedAudioTracks;
  const allSectionTracks = isVideoSection ? timelineViewVideoTracks : timelineViewAudioTracks;
  const sectionHeight = isVideoSection ? videoSectionHeight : audioSectionHeight;
  const sectionScrollY = isVideoSection && (splitDragPinVideoBottom || forceVideoBottomScroll)
    ? clampScrollY(
        expandedVideoSectionContentHeight - sectionHeight,
        expandedVideoSectionContentHeight,
        sectionHeight,
      )
    : isVideoSection
      ? videoScrollY
      : audioScrollY;
  const sectionViewportRef = isVideoSection ? videoSectionViewportRef : audioSectionViewportRef;
  const sectionCollapsed = isSectionCollapsed(sectionKind);
  const sectionContextTrackHeight = sectionCollapsed
    ? getFocusContextTrackHeight(sectionKind)
    : FOCUS_CONTEXT_SECTION_HEIGHT;
  const sectionPhaseClass = clipAnimationPhase === 'exiting'
    ? 'phase-exiting'
    : clipAnimationPhase === 'entering'
      ? 'phase-entering'
      : '';
  const draggedClipForNewTrack = clipDrag ? clipMap.get(clipDrag.clipId) : undefined;

  const getSectionTrackHeightById = (trackId: string, fallbackBaseHeight: number) => {
    const track = allSectionTracks.find(candidate => candidate.id === trackId)
      ?? timelineViewTrackMap.get(trackId)
      ?? trackMap.get(trackId);
    return track ? getSectionTrackHeight(track, sectionKind) : fallbackBaseHeight;
  };

  const getSectionTrackHeightForOverlay = (track: TimelineTrack) =>
    getSectionTrackHeight(track, sectionKind);

  return {
    allSectionTracks,
    draggedClipForNewTrack,
    getSectionTrackHeightById,
    getSectionTrackHeightForOverlay,
    isVideoSection,
    sectionCollapsed,
    sectionContextTrackHeight,
    sectionHeight,
    sectionPhaseClass,
    sectionScrollY,
    sectionTracks,
    sectionViewportRef,
  };
}
