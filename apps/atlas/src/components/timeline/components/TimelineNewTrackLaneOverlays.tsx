import type { DragEvent, DragEventHandler } from 'react';
import type { MediaFile } from '../../../stores/mediaStore/types';
import type { TimelineClipDragPreview } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types';
import type { ClipDragState, ExternalDragState } from '../types';
import type { ClipDragNewTrackType } from '../utils/clipDragTrackTargeting';
import {
  TimelineClipDragNewTrackPreview,
  TimelineExternalNewTrackPreview,
  TimelineNewTrackDropZone,
} from './TimelineNewTrackPreviews';

type NewTrackType = 'video' | 'audio';

interface TimelineNewTrackLaneOverlaysProps {
  audioPreviewHeight: number;
  clipDrag: ClipDragState | null;
  clipDragNewTrackType: ClipDragNewTrackType | null;
  clipDragPreview: TimelineClipDragPreview | null;
  draggedClip?: TimelineClip;
  externalDrag: ExternalDragState | null;
  getMediaFileForClip: (clip: TimelineClip) => MediaFile | null | undefined;
  isVideoSection: boolean;
  onDragEnter: () => void;
  onDragLeave: DragEventHandler<HTMLDivElement>;
  onDragOver: (event: DragEvent<HTMLDivElement>, trackType: NewTrackType) => void;
  onDrop: (event: DragEvent<HTMLDivElement>, trackType: NewTrackType) => void;
  placement: 'beforeRows' | 'afterOverlays';
  sectionCollapsed: boolean;
  timeToPixel: (time: number) => number;
  videoPreviewHeight: number;
}

export function TimelineNewTrackLaneOverlays({
  audioPreviewHeight,
  clipDrag,
  clipDragNewTrackType,
  clipDragPreview,
  draggedClip,
  externalDrag,
  getMediaFileForClip,
  isVideoSection,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  placement,
  sectionCollapsed,
  timeToPixel,
  videoPreviewHeight,
}: TimelineNewTrackLaneOverlaysProps) {
  if (sectionCollapsed) {
    return null;
  }

  if (isVideoSection && placement === 'beforeRows') {
    return (
      <>
        {clipDragNewTrackType === 'video' && draggedClip && clipDrag && (
          <TimelineClipDragNewTrackPreview
            clip={draggedClip}
            clipDrag={clipDrag}
            clipDragPreview={clipDragPreview}
            mediaFile={getMediaFileForClip(draggedClip)}
            previewHeight={videoPreviewHeight}
            timeToPixel={timeToPixel}
            trackType="video"
          />
        )}

        {externalDrag && !externalDrag.isAudio && externalDrag.showVideoNewTrackZone && (
          <TimelineNewTrackDropZone
            active={externalDrag.newTrackType === 'video'}
            externalDrag={externalDrag}
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={(event) => onDragOver(event, 'video')}
            onDrop={(event) => onDrop(event, 'video')}
            previewLabel="New clip"
            timeToPixel={timeToPixel}
            trackType="video"
          />
        )}
      </>
    );
  }

  if (isVideoSection) {
    return externalDrag?.videoTrackId === '__new_video_track__'
      ? (
          <TimelineExternalNewTrackPreview
            externalDrag={externalDrag}
            label="+ New Video Track"
            previewHeight={videoPreviewHeight}
            timeToPixel={timeToPixel}
            trackType="video"
          />
        )
      : null;
  }

  if (placement === 'beforeRows') {
    return null;
  }

  return (
    <>
      {externalDrag?.audioTrackId === '__new_audio_track__' && (
        <TimelineExternalNewTrackPreview
          externalDrag={externalDrag}
          label="+ New Audio Track"
          previewHeight={audioPreviewHeight}
          timeToPixel={timeToPixel}
          trackType="audio"
        />
      )}

      {clipDragNewTrackType === 'audio' && draggedClip && clipDrag && (
        <TimelineClipDragNewTrackPreview
          clip={draggedClip}
          clipDrag={clipDrag}
          clipDragPreview={clipDragPreview}
          mediaFile={getMediaFileForClip(draggedClip)}
          previewHeight={audioPreviewHeight}
          timeToPixel={timeToPixel}
          trackType="audio"
        />
      )}

      {externalDrag && (externalDrag.newTrackType === 'audio' || externalDrag.hasAudio !== false) && (
        <TimelineNewTrackDropZone
          active={
            externalDrag.newTrackType === 'audio' ||
            (externalDrag.newTrackType === 'video' && externalDrag.hasAudio !== false)
          }
          externalDrag={externalDrag}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={(event) => onDragOver(event, 'audio')}
          onDrop={(event) => onDrop(event, 'audio')}
          previewLabel={externalDrag.newTrackType === 'video' ? 'Audio (linked)' : 'New clip'}
          timeToPixel={timeToPixel}
          trackType="audio"
        />
      )}
    </>
  );
}
