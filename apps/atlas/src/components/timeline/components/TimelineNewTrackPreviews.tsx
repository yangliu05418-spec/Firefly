import type { TimelineClip } from '../../../types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelineClipDragPreview } from '../../../stores/timeline/types';
import type { ClipDragState, ExternalDragState } from '../types';
import {
  CLIP_DRAG_NEW_AUDIO_TRACK_ID,
  CLIP_DRAG_NEW_VIDEO_TRACK_ID,
} from '../utils/clipDragTrackTargeting';

type NewTrackType = 'video' | 'audio';

const getNewTrackLabel = (trackType: NewTrackType) =>
  trackType === 'video' ? 'Video' : 'Audio';

interface TimelineNewTrackHeaderPreviewProps {
  active: boolean;
  height: number;
  trackType: NewTrackType;
}

export function TimelineNewTrackHeaderPreview({
  active,
  height,
  trackType,
}: TimelineNewTrackHeaderPreviewProps) {
  const label = getNewTrackLabel(trackType);

  return (
    <div
      className={`track-header-preview ${trackType} ${active ? 'active' : ''}`}
      style={{ height }}
    >
      <span className="track-header-preview-label">+ New {label} Track</span>
    </div>
  );
}

interface TimelineClipDragNewTrackPreviewProps {
  clip: TimelineClip;
  clipDrag: ClipDragState;
  clipDragPreview: TimelineClipDragPreview | null;
  mediaFile?: MediaFile | null;
  previewHeight: number;
  timeToPixel: (time: number) => number;
  trackType: NewTrackType;
}

export function TimelineClipDragNewTrackPreview({
  clip,
  clipDrag,
  clipDragPreview,
  mediaFile,
  previewHeight,
  timeToPixel,
  trackType,
}: TimelineClipDragNewTrackPreviewProps) {
  const trackId = trackType === 'video'
    ? CLIP_DRAG_NEW_VIDEO_TRACK_ID
    : CLIP_DRAG_NEW_AUDIO_TRACK_ID;
  const previewPatch = clipDragPreview?.patches[clip.id];
  const previewStartTime = Math.max(
    0,
    previewPatch?.startTime ?? clipDrag.snappedTime ?? clip.startTime,
  );
  const thumbnailUrl = mediaFile?.thumbnailUrl ?? clip.thumbnails?.[0];
  const label = clip.name || mediaFile?.name || 'Clip';

  return (
    <div
      className={`track-lane ${trackType} new-track-preview clip-drag-new-track-preview drag-target`}
      style={{ height: previewHeight }}
    >
      <div className="track-clip-row" style={{ height: previewHeight }}>
        <div
          className={`timeline-clip-preview ${trackType}${thumbnailUrl ? ' has-thumbnail' : ''}`}
          data-clip-id={clip.id}
          data-preview-track-id={trackId}
          style={{
            left: timeToPixel(previewStartTime),
            width: Math.max(1, timeToPixel(clip.duration)),
          }}
        >
          {thumbnailUrl && (
            <div
              className="timeline-clip-preview-thumbnail"
              style={{ backgroundImage: `url("${thumbnailUrl.replace(/"/g, '\\"')}")` }}
            />
          )}
          <div className="clip-content">
            <span className="clip-name">{label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface TimelineExternalNewTrackPreviewProps {
  externalDrag: ExternalDragState;
  label: string;
  previewHeight: number;
  timeToPixel: (time: number) => number;
  trackType: NewTrackType;
}

export function TimelineExternalNewTrackPreview({
  externalDrag,
  label,
  previewHeight,
  timeToPixel,
  trackType,
}: TimelineExternalNewTrackPreviewProps) {
  return (
    <div className={`track-lane ${trackType} new-track-preview`} style={{ height: previewHeight }}>
      <div
        className={`timeline-clip-preview ${trackType}`}
        style={{
          left: timeToPixel(externalDrag.startTime),
          width: timeToPixel(externalDrag.duration ?? 5),
        }}
      >
        <div className="clip-content">
          <span className="clip-name">{label}</span>
        </div>
      </div>
    </div>
  );
}

interface TimelineNewTrackDropZoneProps {
  active: boolean;
  externalDrag: ExternalDragState;
  onDragEnter: () => void;
  onDragLeave: React.DragEventHandler<HTMLDivElement>;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
  previewLabel: string;
  timeToPixel: (time: number) => number;
  trackType: NewTrackType;
}

export function TimelineNewTrackDropZone({
  active,
  externalDrag,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  previewLabel,
  timeToPixel,
  trackType,
}: TimelineNewTrackDropZoneProps) {
  const label = getNewTrackLabel(trackType);

  return (
    <div
      className={`new-track-drop-zone ${trackType} ${active ? 'active' : ''}`}
      onDragOver={onDragOver}
      onDragEnter={(event) => {
        event.preventDefault();
        onDragEnter();
      }}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="drop-zone-label">+ Drop to create new {label} Track</span>
      {active && (
        <div
          className={`timeline-clip-preview ${trackType}`}
          style={{
            left: timeToPixel(externalDrag.startTime),
            width: timeToPixel(externalDrag.duration ?? 5),
          }}
        >
          <div className="clip-content">
            <span className="clip-name">{previewLabel}</span>
          </div>
        </div>
      )}
    </div>
  );
}
