import type { TimelineClip, TimelineTrack } from '../../../types';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { TrackSectionKind } from '../utils/timelineHostTypes';
import { TimelineClipCanvas } from '../TimelineClipCanvas';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from '../trackColor';

interface TimelineCompositionExitOverlayProps {
  audioDisplayMode: TimelineAudioDisplayMode;
  clips: TimelineClip[];
  contentWidth: number;
  getExpandedTrackHeight: (trackId: string, baseHeight: number) => number;
  getSectionTrackBaseHeight: (track: TimelineTrack, sectionKind: TrackSectionKind) => number;
  isTrackExpandedFromState: (trackId: string) => boolean;
  scrollX: number;
  sectionCollapsed: boolean;
  sectionKind: TrackSectionKind;
  selectedClipIds: Set<string>;
  switchMotionClass: string;
  timeToPixel: (time: number) => number;
  timelineTrackColorsVisible: boolean;
  tracks: TimelineTrack[];
  viewportWidth: number;
  waveformsEnabled: boolean;
}

export function TimelineCompositionExitOverlay({
  audioDisplayMode,
  clips,
  contentWidth,
  getExpandedTrackHeight,
  getSectionTrackBaseHeight,
  isTrackExpandedFromState,
  scrollX,
  sectionCollapsed,
  sectionKind,
  selectedClipIds,
  switchMotionClass,
  timeToPixel,
  timelineTrackColorsVisible,
  tracks,
  viewportWidth,
  waveformsEnabled,
}: TimelineCompositionExitOverlayProps) {
  return (
    <div className="composition-exit-clips-overlay">
      {tracks.map((track, trackIndex) => {
        const isExpanded = !sectionCollapsed && isTrackExpandedFromState(track.id);
        const baseHeight = getSectionTrackBaseHeight(track, sectionKind);
        const dynamicHeight = isExpanded ? getExpandedTrackHeight(track.id, baseHeight) : baseHeight;
        const trackClips = clips.filter((clip) => clip.trackId === track.id);
        const trackColor = timelineTrackColorsVisible
          ? getTimelineTrackColor(track, trackIndex)
          : TIMELINE_TRACK_COLOR_HIDDEN;

        return (
          <div
            key={`exit-${track.id}`}
            className="composition-exit-track-row"
            style={{ height: dynamicHeight }}
          >
            <div className="track-clip-row" style={{ height: baseHeight }}>
              <div className={`composition-switch-clip-canvas ${switchMotionClass}`}>
                <TimelineClipCanvas
                  clips={trackClips}
                  trackId={track.id}
                  height={baseHeight}
                  contentWidth={contentWidth}
                  timeToPixel={timeToPixel}
                  selectedClipIds={selectedClipIds}
                  hoveredClipId={null}
                  trackColor={trackColor}
                  scrollX={scrollX}
                  viewportWidth={viewportWidth}
                  waveformsEnabled={waveformsEnabled}
                  audioDisplayMode={audioDisplayMode}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
