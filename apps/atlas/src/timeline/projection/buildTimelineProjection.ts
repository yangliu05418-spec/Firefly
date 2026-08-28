import type {
  TimelineSchemaClip,
  TimelineSchemaSnapshot,
  TimelineSchemaTrack,
} from '../contracts/schema';
import type {
  TimelinePassiveBadgeState,
  TimelineProjection,
  TimelineProjectionClip,
  TimelineProjectionPalette,
  TimelineProjectionTrack,
  TimelineProjectionTrackKind,
} from './TimelineProjection';

const DEFAULT_TRACK_COLORS: Record<TimelineProjectionTrackKind, string> = {
  video: '#4f86ff',
  audio: '#22c55e',
  mixed: '#a855f7',
  data: '#f59e0b',
  control: '#64748b',
};

const DEFAULT_TRACK_HEIGHTS: Record<TimelineProjectionTrackKind, number> = {
  video: 76,
  audio: 52,
  mixed: 76,
  data: 44,
  control: 44,
};

const DEFAULT_CLIP_PALETTE: TimelineProjectionPalette = {
  fill: '#334155',
  stroke: '#94a3b8',
  text: '#ffffff',
};

export interface BuildTimelineProjectionOptions {
  generatedAtMs?: number;
  hoveredClipId?: string | null;
  trackColors?: Readonly<Record<string, string>>;
  clipPalettes?: Readonly<Record<string, Partial<TimelineProjectionPalette>>>;
  clipBadges?: Readonly<Record<string, TimelinePassiveBadgeState>>;
}

function buildProjectionTrack(
  track: TimelineSchemaTrack,
  options: BuildTimelineProjectionOptions,
): TimelineProjectionTrack {
  return {
    id: track.id,
    index: track.index,
    name: track.name,
    kind: track.kind,
    color: options.trackColors?.[track.id] ?? DEFAULT_TRACK_COLORS[track.kind],
    locked: track.locked,
    muted: track.muted,
    hidden: track.hidden,
    expanded: track.expanded,
    dimmed: track.hidden,
    baseHeightPx: DEFAULT_TRACK_HEIGHTS[track.kind],
    heightPx: track.expanded ? DEFAULT_TRACK_HEIGHTS[track.kind] : Math.max(28, DEFAULT_TRACK_HEIGHTS[track.kind] * 0.65),
  };
}

function buildProjectionClip(
  clip: TimelineSchemaClip,
  options: BuildTimelineProjectionOptions,
): TimelineProjectionClip {
  return {
    id: clip.id,
    trackId: clip.trackId,
    index: clip.index,
    startTime: clip.timing.startTime,
    duration: clip.timing.duration,
    inPoint: clip.timing.inPoint,
    outPoint: clip.timing.outPoint,
    speed: clip.timing.speed,
    reversed: clip.timing.reversed,
    sourceKind: clip.source.kind,
    sourceId: clip.source.sourceId,
    mediaFileId: clip.source.mediaAssetId,
    label: clip.label,
    palette: {
      ...DEFAULT_CLIP_PALETTE,
      ...options.clipPalettes?.[clip.id],
    },
    state: {
      selected: false,
      hovered: options.hoveredClipId === clip.id,
      locked: clip.locked,
      muted: clip.muted,
      linked: Boolean(clip.linkedClipId || clip.linkedGroupId),
      inLinkedGroup: Boolean(clip.linkedGroupId),
      dimmed: clip.disabled,
      disabled: clip.disabled,
    },
    badges: options.clipBadges?.[clip.id] ?? {},
    cacheRefs: {},
    markers: [],
  };
}

export function buildTimelineProjection(
  snapshot: TimelineSchemaSnapshot,
  options: BuildTimelineProjectionOptions = {},
): TimelineProjection {
  const selectedClipIds = [...snapshot.selectedClipIds];
  return {
    schemaVersion: 1,
    tracks: snapshot.tracks
      .map((track) => buildProjectionTrack(track, options))
      .toSorted((a, b) => a.index - b.index),
    clips: snapshot.clips
      .map((clip) => buildProjectionClip(clip, options))
      .toSorted((a, b) => a.index - b.index),
    selectedClipIds,
    primarySelectedClipId: snapshot.primarySelectedClipId ?? selectedClipIds[0] ?? null,
    hoveredClipId: options.hoveredClipId ?? null,
    generatedAtMs: options.generatedAtMs,
  };
}
