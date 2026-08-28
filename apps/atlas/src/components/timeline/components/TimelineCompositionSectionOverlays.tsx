import type { ComponentProps } from 'react';
import type { TimelineTrack, VideoBakeRegion } from '../../../types';
import type { TimelineVideoBakeRegionSelection } from '../../../stores/timeline/types';
import type {
  CompositionVideoBakeOverlayRegion,
  TrackSectionKind,
} from '../utils/timelineHostTypes';
import { TimelineCompositionExitOverlay } from './TimelineCompositionExitOverlay';
import { TimelineCompositionVideoBakeRegions } from './TimelineCompositionVideoBakeRegions';

type CompositionExitOverlayProps = ComponentProps<typeof TimelineCompositionExitOverlay>;
type CompositionVideoBakeRegionsProps = ComponentProps<typeof TimelineCompositionVideoBakeRegions>;

interface TimelineCompositionSectionOverlaysProps {
  audioDisplayMode: CompositionExitOverlayProps['audioDisplayMode'];
  clipAnimationPhase: string;
  clips: CompositionExitOverlayProps['clips'];
  compositionSwitchDirection: 'forward' | 'backward';
  duration: number;
  formatTime: CompositionVideoBakeRegionsProps['formatTime'];
  getExpandedTrackHeight: CompositionExitOverlayProps['getExpandedTrackHeight'];
  getSectionTrackBaseHeight: CompositionExitOverlayProps['getSectionTrackBaseHeight'];
  getSectionTrackHeight: (track: TimelineTrack, sectionKind: TrackSectionKind) => number;
  isCompositionTrackMorphing: boolean;
  isTrackExpandedFromState: CompositionExitOverlayProps['isTrackExpandedFromState'];
  isVideoSection: boolean;
  onBakeRegion: CompositionVideoBakeRegionsProps['onBakeRegion'];
  onRemoveRegion: CompositionVideoBakeRegionsProps['onRemoveRegion'];
  onUnbakeRegion: CompositionVideoBakeRegionsProps['onUnbakeRegion'];
  scrollX: number;
  sectionCollapsed: boolean;
  sectionKind: TrackSectionKind;
  sectionTracks: TimelineTrack[];
  selectedClipIds: Set<string>;
  timeToPixel: CompositionExitOverlayProps['timeToPixel'];
  timelineTrackColorsVisible: boolean;
  tracks: TimelineTrack[];
  videoBakeRegions: VideoBakeRegion[];
  videoBakeRegionSelection: TimelineVideoBakeRegionSelection | null;
  viewportWidth: number;
  waveformsEnabled: boolean;
  zoom: number;
}

const buildCompositionSwitchClipMotionClass = (
  clipAnimationPhase: string,
  compositionSwitchDirection: 'forward' | 'backward',
) => {
  if (clipAnimationPhase === 'exiting') {
    return compositionSwitchDirection === 'backward' ? 'exit-animate-left' : 'exit-animate-right';
  }

  if (clipAnimationPhase === 'entering') {
    return compositionSwitchDirection === 'backward' ? 'entrance-animate-right' : 'entrance-animate-left';
  }

  return '';
};

const buildCompositionVideoBakeOverlayRegions = (
  videoBakeRegions: VideoBakeRegion[],
  videoBakeRegionSelection: TimelineVideoBakeRegionSelection | null,
): CompositionVideoBakeOverlayRegion[] => [
  ...videoBakeRegions
    .filter(region => region.scope === 'composition')
    .map(region => ({
      id: region.id,
      startTime: region.startTime,
      endTime: region.endTime,
      status: region.status,
      progress: region.progress,
    })),
  ...(videoBakeRegionSelection?.scope === 'composition'
    ? [{
        id: 'composition-video-bake-selection',
        startTime: videoBakeRegionSelection.startTime,
        endTime: videoBakeRegionSelection.endTime,
        status: 'marked' as const,
        progress: undefined,
        selection: true,
      }]
    : []),
];

export function TimelineCompositionSectionOverlays({
  audioDisplayMode,
  clipAnimationPhase,
  clips,
  compositionSwitchDirection,
  duration,
  formatTime,
  getExpandedTrackHeight,
  getSectionTrackBaseHeight,
  getSectionTrackHeight,
  isCompositionTrackMorphing,
  isTrackExpandedFromState,
  isVideoSection,
  onBakeRegion,
  onRemoveRegion,
  onUnbakeRegion,
  scrollX,
  sectionCollapsed,
  sectionKind,
  sectionTracks,
  selectedClipIds,
  timeToPixel,
  timelineTrackColorsVisible,
  tracks,
  videoBakeRegions,
  videoBakeRegionSelection,
  viewportWidth,
  waveformsEnabled,
  zoom,
}: TimelineCompositionSectionOverlaysProps) {
  const videoBakeOverlayHeight = isVideoSection && !sectionCollapsed
    ? sectionTracks.reduce((total, track) => total + getSectionTrackHeight(track, sectionKind), 0)
    : 0;
  const compositionVideoBakeOverlayRegions = isVideoSection && !sectionCollapsed
    ? buildCompositionVideoBakeOverlayRegions(videoBakeRegions, videoBakeRegionSelection)
    : [];
  const compositionSwitchClipMotionClass = buildCompositionSwitchClipMotionClass(
    clipAnimationPhase,
    compositionSwitchDirection,
  );

  return (
    <>
      <TimelineCompositionVideoBakeRegions
        bakeRegionHeight={videoBakeOverlayHeight}
        duration={duration}
        formatTime={formatTime}
        onBakeRegion={onBakeRegion}
        onRemoveRegion={onRemoveRegion}
        onUnbakeRegion={onUnbakeRegion}
        regions={compositionVideoBakeOverlayRegions}
        timeToPixel={timeToPixel}
      />

      {isCompositionTrackMorphing && (
        <TimelineCompositionExitOverlay
          audioDisplayMode={audioDisplayMode}
          clips={clips}
          contentWidth={Math.max(duration * zoom + 500, 2000)}
          getExpandedTrackHeight={getExpandedTrackHeight}
          getSectionTrackBaseHeight={getSectionTrackBaseHeight}
          isTrackExpandedFromState={isTrackExpandedFromState}
          scrollX={scrollX}
          sectionCollapsed={sectionCollapsed}
          sectionKind={sectionKind}
          selectedClipIds={selectedClipIds}
          switchMotionClass={compositionSwitchClipMotionClass}
          timeToPixel={timeToPixel}
          timelineTrackColorsVisible={timelineTrackColorsVisible}
          tracks={tracks}
          viewportWidth={viewportWidth}
          waveformsEnabled={waveformsEnabled}
        />
      )}
    </>
  );
}
