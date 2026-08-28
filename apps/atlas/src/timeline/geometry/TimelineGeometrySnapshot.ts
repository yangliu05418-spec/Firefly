export type TimelineGeometrySnapshotVersion = 1;

export interface TimelinePoint {
  x: number;
  y: number;
}

export interface TimelineRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TimelineTimeRange {
  startTime: number;
  duration: number;
}

export interface TimelineViewportGeometry {
  scrollContainerRect: TimelineRect;
  visibleContentRect: TimelineRect;
  viewportRect: TimelineRect;
  scrollX: number;
  scrollY: number;
  pxPerSecond: number;
  measuredAtMs?: number;
}

export interface TimelineTrackLaneGeometry {
  trackId: string;
  index: number;
  laneRect: TimelineRect;
  rowViewportRect: TimelineRect;
  clipRowRect: TimelineRect;
  keyframeAreaRect?: TimelineRect;
}

export interface TimelineSourceExtensionGhostGeometry {
  clipId: string;
  edge: 'left' | 'right';
  rect: TimelineRect;
  sourceStartTime: number;
  sourceEndTime: number;
}

export interface TimelineTrimPreviewGeometry {
  clipId: string;
  leadClipId: string;
  edge: 'left' | 'right';
  bodyRect: TimelineRect;
  trimGhostRect?: TimelineRect;
  role: 'lead' | 'linked-follower' | 'selected-follower';
}

export interface TimelineFadeCurveGeometry {
  id: string;
  clipId: string;
  edge: 'left' | 'right' | 'both';
  controlPoints: TimelinePoint[];
  boundingRect: TimelineRect;
  handleRectIds?: Partial<Record<'left' | 'right', string>>;
}

export interface TimelineClipBodyGeometry {
  clipId: string;
  trackId: string;
  bodyRect: TimelineRect;
  visibleBodyRect: TimelineRect;
  labelRect?: TimelineRect;
  thumbnailStripRect?: TimelineRect;
  waveformRect?: TimelineRect;
  spectrogramRect?: TimelineRect;
  badgeAnchorRects: Record<string, TimelineRect>;
  sourceExtensionGhosts: TimelineSourceExtensionGhostGeometry[];
  trimPreview?: TimelineTrimPreviewGeometry;
  fadeCurve?: TimelineFadeCurveGeometry;
}

export type TimelineHandleKind =
  | 'trim-left'
  | 'trim-right'
  | 'fade-left'
  | 'fade-right'
  | 'keyframe-diamond'
  | 'audio-gain'
  | 'spectral-region'
  | 'video-bake'
  | 'stem-menu';

export interface TimelineHandleGeometry {
  id: string;
  clipId: string;
  trackId: string;
  kind: TimelineHandleKind;
  rect: TimelineRect;
  hitRect: TimelineRect;
  active: boolean;
}

export interface TimelineKeyframeDiamondGeometry {
  keyframeId: string;
  rectId: string;
  clipId: string;
  trackId: string;
  property: string;
  time: number;
  rect: TimelineRect;
  selected: boolean;
}

export interface TimelineKeyframeRowGeometry {
  id: string;
  trackId: string;
  clipId?: string;
  property: string;
  rowRect: TimelineRect;
  diamonds: TimelineKeyframeDiamondGeometry[];
}

export interface TimelineTransitionJunctionGeometry {
  id: string;
  trackId: string;
  time: number;
  rect: TimelineRect;
  dropZoneRect: TimelineRect;
  beforeClipId?: string;
  afterClipId?: string;
  transitionId?: string;
}

export type TimelineMarqueeExclusionKind =
  | 'timeline-header'
  | 'track-resize'
  | 'clip-handle'
  | 'active-control'
  | 'context-menu'
  | 'keyframe-editor'
  | 'scrollbar'
  | 'custom';

export interface TimelineMarqueeExclusionGeometry {
  id: string;
  kind: TimelineMarqueeExclusionKind;
  rect: TimelineRect;
  clipId?: string;
  trackId?: string;
}

export type TimelineDropTargetKind =
  | 'clip-body'
  | 'track-empty'
  | 'new-track'
  | 'transition'
  | 'image-layer'
  | 'spectral-region'
  | 'audio-region'
  | 'tool'
  | 'split-target';

export interface TimelineDropTargetGeometry {
  id: string;
  kind: TimelineDropTargetKind;
  rect: TimelineRect;
  trackId?: string;
  clipId?: string;
  accepts: string[];
}

export interface TimelineRulerGeometry {
  rect: TimelineRect;
  contentWidth: number;
  timeOrigin: number;
  pxPerSecond: number;
}

export interface VisibleSet {
  clipIds: readonly string[];
  rowIds: readonly string[];
  facetIds: readonly string[];
  tileBands: readonly string[];
}

export interface TimelineSpatialIndex {
  geometryEpoch: string;
  visibleSet: VisibleSet;
}

export interface TimelineGeometrySnapshot {
  schemaVersion: TimelineGeometrySnapshotVersion;
  viewport: TimelineViewportGeometry;
  contentWidth: number;
  geometryEpoch?: string;
  tracks: TimelineTrackLaneGeometry[];
  clips: TimelineClipBodyGeometry[];
  trimPreviews: TimelineTrimPreviewGeometry[];
  handles: TimelineHandleGeometry[];
  keyframeRows: TimelineKeyframeRowGeometry[];
  transitionJunctions: TimelineTransitionJunctionGeometry[];
  marqueeExclusions: TimelineMarqueeExclusionGeometry[];
  dropTargets: TimelineDropTargetGeometry[];
  ruler: TimelineRulerGeometry;
}
