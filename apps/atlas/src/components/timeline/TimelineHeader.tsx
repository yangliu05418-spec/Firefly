// TimelineHeader component - Track headers (left side)

import { memo, type CSSProperties, useEffect, useRef, useState } from 'react';
import type { TimelineHeaderProps } from './types';
import { useTimelineStore } from '../../stores/timeline';
import {
  TimelineHeaderAudioSummaryMeter,
  TimelineHeaderMixerControls,
  TimelineHeaderMixerMainControls,
  TimelineHeaderMixerTypeBadge,
} from './components/TimelineHeaderAudioControls';
import { TimelineHeaderPropertyLabels } from './components/TimelineHeaderPropertyLabels';
import { TrackHeaderIcon } from './components/TimelineHeaderTrackIcons';
import {
  formatAudioTrackPan,
  formatAudioTrackVolumeDb,
  getAudioTrackHeaderDensity,
} from './utils/audioTrackHeaderDensity';
import { getTimelineTrackColor, TIMELINE_TRACK_COLOR_HIDDEN } from './trackColor';
import { useTimelineHeaderAudioPopoverState } from './hooks/useTimelineHeaderAudioPopoverState';
import { useTrackReorderDrag, trackReorderSection } from './hooks/useTrackReorderDrag';

function TimelineHeaderComponent({
  track,
  tracks,
  isDimmed,
  isExpanded,
  baseHeight,
  dynamicHeight,
  hasKeyframes,
  selectedClipIds,
  clips,
  playheadPosition,
  onToggleExpand,
  onToggleSolo,
  onToggleLocked,
  onToggleMuted,
  onToggleVisible,
  onRenameTrack,
  onContextMenu,
  onWheel,
  onResizeStart,
  isResizeActive = false,
  clipKeyframes,
  getInterpolatedTransform,
  getInterpolatedEffects,
  addKeyframe,
  setPlayheadPosition,
  setPropertyValue,
  expandedCurveProperties,
  onToggleCurveExpanded,
  hoveredKeyframeRow,
  onKeyframeRowHover,
  audioLayerAdvancedMode = true,
  showCollapsedAudioSummaryMeter = false,
}: TimelineHeaderProps) {
  const { onReorderPointerDown } = useTrackReorderDrag(track);
  const trackClips = clips.filter((c) => c.trackId === track.id);
  const selectedTrackClip = trackClips.find((c) => selectedClipIds.has(c.id));
  const effectiveMuted = track.audioState?.muted ?? track.muted;
  const effectiveSolo = track.audioState?.solo ?? track.solo;
  const trackRecordArm = track.audioState?.recordArm === true;
  const trackInputMonitor = track.audioState?.inputMonitor === true;
  const trackVolumeDb = track.audioState?.volumeDb ?? 0;
  const trackPan = track.audioState?.pan ?? 0;
  const trackVolumeLabel = formatAudioTrackVolumeDb(trackVolumeDb);
  const trackPanLabel = formatAudioTrackPan(trackPan);
  const trackVolumeUnit = Math.max(0, Math.min(1, (trackVolumeDb + 60) / 78));
  const isAudioTrack = track.type === 'audio';
  const isMidiTrack = track.type === 'midi';
  const isMixerTrack = isAudioTrack || isMidiTrack;
  const audioHeaderDensity = isMixerTrack
    ? getAudioTrackHeaderDensity(baseHeight)
    : null;
  const isMutedTrack = isMixerTrack && effectiveMuted;
  const isHiddenTrack = track.type === 'video' && track.visible === false;
  const showAudioSummaryMeter = isAudioTrack && audioLayerAdvancedMode && showCollapsedAudioSummaryMeter;
  const showAdvancedAudioControls = isMixerTrack && audioLayerAdvancedMode && !showCollapsedAudioSummaryMeter;
  const audioHeaderControlScale = showAdvancedAudioControls && audioHeaderDensity === 'full'
    ? Math.max(0.78, Math.min(1, baseHeight / 96))
    : 1;
  const audioHeaderFaderScale = showAdvancedAudioControls && audioHeaderDensity !== 'condensed'
    ? Math.max(0, Math.min(1, baseHeight / 96))
    : 1;
  const showAudioTrackVolumeFader = showAdvancedAudioControls && audioHeaderDensity === 'full';
  const trackTypeIndex = tracks
    .filter((timelineTrack) => timelineTrack.type === track.type)
    .findIndex((timelineTrack) => timelineTrack.id === track.id);
  const showTimelineTrackColor = audioLayerAdvancedMode !== false;
  const trackColor = showTimelineTrackColor ? getTimelineTrackColor(track, trackTypeIndex) : TIMELINE_TRACK_COLOR_HIDDEN;
  const isMidiDefaultTint = isMidiTrack && (!track.labelColor || track.labelColor === 'none');
  const trackHeaderStyle = {
    height: dynamicHeight,
    '--track-color': trackColor,
    ...(isMixerTrack ? {
      '--audio-strip-control-scale': audioHeaderControlScale.toFixed(3),
      '--audio-strip-fader-scale': audioHeaderFaderScale.toFixed(3),
    } : {}),
  } as CSSProperties & {
    '--track-color'?: string;
    '--audio-strip-control-scale'?: string;
    '--audio-strip-fader-scale'?: string;
  };
  const targetTrackId = useTimelineStore(state => state.targetTrackIdByType[track.type]);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const setTargetTrack = useTimelineStore(state => state.setTargetTrack);
  const isTargeted = targetTrackId === track.id;
  const isPropertiesSelected = propertiesSelection?.kind === 'track' && propertiesSelection.trackId === track.id;
  const audioPopoverState = useTimelineHeaderAudioPopoverState();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const startNameEdit = () => {
    setEditValue(track.name);
    setIsEditing(true);
  };

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startNameEdit();
  };

  const handleNameDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    startNameEdit();
  };

  const handleFinishEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== track.name) {
      onRenameTrack(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditValue(track.name);
    }
  };

  const handleHeaderClick = (e: React.MouseEvent) => {
    if (isEditing) return;
    // Bail only on real interactive controls, not the `.track-controls` grid
    // container whose empty cells/gaps (e.g. right of FX) must still select. #280
    if ((e.target as HTMLElement).closest('button, input, select, .audio-track-faders, .audio-track-popover')) return;
    setTargetTrack(track.id);
    if (isMixerTrack) {
      useTimelineStore.getState().selectTrackProperties(track.id);
    }
  };

  return (
    <div
      className={`track-header ${track.type} ${isMixerTrack ? 'mixer' : ''} ${isMidiDefaultTint ? 'midi-default-tint' : ''} ${isDimmed ? 'dimmed' : ''} ${
        isExpanded ? 'expanded' : ''
      } ${track.locked ? 'locked' : ''} ${
        isMutedTrack ? 'track-muted' : ''
      } ${
        isHiddenTrack ? 'track-hidden' : ''
      } ${
        audioHeaderDensity ? `audio-strip-${audioHeaderDensity}` : ''
      } ${isMixerTrack ? (audioLayerAdvancedMode ? 'audio-layer-advanced' : 'audio-layer-basic') : ''} ${
        showAdvancedAudioControls && (audioPopoverState.audioFxOpen || audioPopoverState.audioSendsOpen) ? 'popover-open' : ''
      } ${
        showAudioSummaryMeter ? 'audio-summary-meter-visible' : ''
      } ${
        isResizeActive ? 'resizing' : ''
      } ${
        isTargeted ? 'targeted' : ''
      } ${
        isPropertiesSelected ? 'properties-selected' : ''
      }`}
      style={trackHeaderStyle}
      data-dock-layout-child-anim-id={`timeline-track-header:${track.id}`}
      data-track-reorder-id={track.id}
      data-track-reorder-section={trackReorderSection(track)}
      onWheel={onWheel}
      onContextMenu={onContextMenu}
    >
      <div
        className="track-header-top"
        style={{ height: baseHeight, cursor: (track.type === 'video' || isMixerTrack) ? 'pointer' : 'default' }}
        onClick={handleHeaderClick}
      >
        <div
          className="track-reorder-handle"
          title="Drag to reorder"
          onPointerDown={onReorderPointerDown}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="track-reorder-grip" aria-hidden="true">{'\u22EE'}</span>
        </div>
        {showAudioSummaryMeter && <TimelineHeaderAudioSummaryMeter />}
        <div className="track-header-main">
          {isMixerTrack && <TimelineHeaderMixerTypeBadge isMidiTrack={isMidiTrack} />}
          {(track.type === 'video' || isMixerTrack) && (
            <span
              className={`track-expand-arrow ${isExpanded ? 'expanded' : ''} ${
                hasKeyframes ? 'has-keyframes' : ''
              }`}
              title={isExpanded ? 'Collapse properties' : 'Expand properties'}
              onClick={(event) => {
                event.stopPropagation();
                onToggleExpand();
              }}
            >
              {'\u25B6'}
            </span>
          )}
          {showTimelineTrackColor && (
            <span
              className="track-color-chip"
              style={{ background: trackColor }}
              title="Track color"
              onClick={(event) => event.stopPropagation()}
            />
          )}
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="track-name-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleFinishEdit}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="track-name"
              onClick={handleNameClick}
              onDoubleClick={handleNameDoubleClick}
              title="Click to rename"
            >
              {track.name}
            </span>
          )}
          {isMixerTrack && (
            <TimelineHeaderMixerMainControls
              audioHeaderDensity={audioHeaderDensity}
              isMidiTrack={isMidiTrack}
              showAdvancedAudioControls={showAdvancedAudioControls}
              track={track}
              trackPan={trackPan}
              trackPanLabel={trackPanLabel}
            />
          )}
        </div>
        {isMixerTrack ? (
          <TimelineHeaderMixerControls
            effectiveMuted={effectiveMuted}
            effectiveSolo={effectiveSolo}
            onToggleLocked={onToggleLocked}
            onToggleMuted={onToggleMuted}
            onToggleSolo={onToggleSolo}
            popoverState={audioPopoverState}
            showAdvancedAudioControls={showAdvancedAudioControls}
            showAudioSummaryMeter={showAudioSummaryMeter}
            showAudioTrackVolumeFader={showAudioTrackVolumeFader}
            track={track}
            trackInputMonitor={trackInputMonitor}
            trackRecordArm={trackRecordArm}
            trackVolumeDb={trackVolumeDb}
            trackVolumeLabel={trackVolumeLabel}
            trackVolumeUnit={trackVolumeUnit}
          />
        ) : (
          <div className="track-controls">
            <button
              className={`btn-icon ${effectiveSolo ? 'solo-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleSolo(); }}
              title={effectiveSolo ? 'Solo On' : 'Solo Off'}
            >
              S
            </button>
            <button
              className={`btn-icon ${!track.visible ? 'hidden' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
              title={track.visible ? 'Hide' : 'Show'}
            >
              <TrackHeaderIcon name={track.visible ? 'eye' : 'eyeOff'} />
            </button>
            <button
              className={`btn-icon ${track.locked ? 'locked-active' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleLocked?.(); }}
              title={track.locked ? 'Unlock Track' : 'Lock Track'}
            >
              <TrackHeaderIcon name={track.locked ? 'lock' : 'unlock'} />
            </button>
          </div>
        )}
        {onResizeStart && (
          <div
            className={`track-resize-handle ${isResizeActive ? 'active' : ''}`}
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize track height"
            onPointerDown={(event) => onResizeStart(event, track.id)}
          />
        )}
      </div>
      {(track.type === 'video' || isMixerTrack) && isExpanded && (
        <TimelineHeaderPropertyLabels
          trackId={track.id}
          selectedClip={selectedTrackClip || null}
          isAudioTrack={isAudioTrack}
          clipKeyframes={clipKeyframes}
          playheadPosition={playheadPosition}
          getInterpolatedTransform={getInterpolatedTransform}
          getInterpolatedEffects={getInterpolatedEffects}
          addKeyframe={addKeyframe}
          setPlayheadPosition={setPlayheadPosition}
          setPropertyValue={setPropertyValue}
          expandedCurveProperties={expandedCurveProperties}
          onToggleCurveExpanded={onToggleCurveExpanded}
          hoveredKeyframeRow={hoveredKeyframeRow}
          onKeyframeRowHover={onKeyframeRowHover}
        />
      )}
    </div>
  );
}

export const TimelineHeader = memo(TimelineHeaderComponent);
