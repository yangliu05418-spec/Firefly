import { createInitialProjectFile } from '../core/createInitialProjectFile';
import type { ProjectClip, ProjectTrack } from '../types/composition.types';
import type { ProjectMediaFile } from '../types/media.types';
import type { ProjectFile } from '../types/project.types';

type LegacyMediaKind = 'video' | 'audio' | 'image';

interface LegacyAsset {
  id: string;
  name: string;
  kind: LegacyMediaKind;
  duration: number;
  width?: number;
  height?: number;
  size?: number;
  mediaUrl?: string;
}

interface LegacyTrack {
  id: string;
  name: string;
  kind: 'video' | 'audio';
  muted: boolean;
  locked: boolean;
}

interface LegacyClip {
  id: string;
  assetId: string;
  trackId: string;
  name: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  volume: number;
  muted: boolean;
  transitionIn?: string;
  transitionId?: string;
  transitionFromClipId?: string;
  transitionDuration?: number;
  transform: {
    x: number;
    y: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    opacity: number;
  };
}

interface LegacyAtlasDocument {
  version: 1;
  projectId: string;
  title: string;
  updatedAt: string;
  playhead: number;
  assets: LegacyAsset[];
  tracks: LegacyTrack[];
  clips: LegacyClip[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value ? value : fallback;
}

function legacyKind(value: unknown): LegacyMediaKind | null {
  return value === 'video' || value === 'audio' || value === 'image' ? value : null;
}

function parseLegacyAtlasDocument(value: unknown, expectedProjectId: string): LegacyAtlasDocument | null {
  const root = record(value);
  if (!root
    || root.version !== 1
    || root.projectId !== expectedProjectId
    || !Array.isArray(root.assets)
    || !Array.isArray(root.tracks)
    || !Array.isArray(root.clips)
    || root.assets.length > 500
    || root.tracks.length > 128
    || root.clips.length > 2_000) {
    return null;
  }

  const assets: LegacyAsset[] = [];
  for (const candidate of root.assets) {
    const asset = record(candidate);
    const kind = legacyKind(asset?.kind);
    if (!asset || !kind || !text(asset.id)) return null;
    assets.push({
      id: text(asset.id),
      name: text(asset.name, '未命名素材'),
      kind,
      duration: Math.max(0, finite(asset.duration, kind === 'image' ? 5 : 0)),
      width: finite(asset.width, 0) || undefined,
      height: finite(asset.height, 0) || undefined,
      size: finite(asset.size, 0) || undefined,
      mediaUrl: text(asset.mediaUrl) || undefined,
    });
  }

  const tracks: LegacyTrack[] = [];
  for (const candidate of root.tracks) {
    const track = record(candidate);
    if (!track || !text(track.id) || (track.kind !== 'video' && track.kind !== 'audio')) return null;
    tracks.push({
      id: text(track.id),
      name: text(track.name, track.kind === 'video' ? '画面' : '声音'),
      kind: track.kind,
      muted: track.muted === true,
      locked: track.locked === true,
    });
  }

  const clips: LegacyClip[] = [];
  for (const candidate of root.clips) {
    const clip = record(candidate);
    const transform = record(clip?.transform);
    if (!clip || !transform || !text(clip.id) || !text(clip.assetId) || !text(clip.trackId)) return null;
    clips.push({
      id: text(clip.id),
      assetId: text(clip.assetId),
      trackId: text(clip.trackId),
      name: text(clip.name),
      startTime: Math.max(0, finite(clip.startTime, 0)),
      duration: Math.max(0.001, finite(clip.duration, 0.001)),
      inPoint: Math.max(0, finite(clip.inPoint, 0)),
      outPoint: Math.max(0.001, finite(clip.outPoint, 0.001)),
      volume: Math.max(0, finite(clip.volume, 1)),
      muted: clip.muted === true,
      transitionIn: text(clip.transitionIn) || undefined,
      transitionId: text(clip.transitionId) || undefined,
      transitionFromClipId: text(clip.transitionFromClipId) || undefined,
      transitionDuration: Math.max(0, finite(clip.transitionDuration, 0)) || undefined,
      transform: {
        x: finite(transform.x, 0),
        y: finite(transform.y, 0),
        scaleX: finite(transform.scaleX, 1),
        scaleY: finite(transform.scaleY, 1),
        rotation: finite(transform.rotation, 0),
        opacity: Math.max(0, Math.min(1, finite(transform.opacity, 1))),
      },
    });
  }

  return {
    version: 1,
    projectId: expectedProjectId,
    title: text(root.title, '未命名项目'),
    updatedAt: text(root.updatedAt, new Date(0).toISOString()),
    playhead: Math.max(0, finite(root.playhead, 0)),
    assets,
    tracks,
    clips,
  };
}

function transitionType(value: string | undefined): string | null {
  if (!value || value === 'none') return null;
  return value === 'dip-black' ? 'dip-to-black' : value;
}

/** One-way compatibility bridge for checkpoints produced by the retired thin editor. */
export function migrateLegacyAtlasDocument(
  value: unknown,
  expectedProjectId: string,
): ProjectFile | null {
  const legacy = parseLegacyAtlasDocument(value, expectedProjectId);
  if (!legacy) return null;

  const projectFile = createInitialProjectFile(legacy.title);
  const composition = projectFile.compositions[0];
  if (!composition) return null;
  const assetIds = new Set(legacy.assets.map((asset) => asset.id));
  const trackIds = new Set(legacy.tracks.map((track) => track.id));

  const media: ProjectMediaFile[] = legacy.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.kind,
    sourcePath: asset.mediaUrl ?? `/api/atlas/project-assets/${encodeURIComponent(asset.id)}/media`,
    duration: asset.duration,
    width: asset.width,
    height: asset.height,
    fileSize: asset.size,
    hasProxy: false,
    folderId: null,
    importedAt: legacy.updatedAt,
  }));
  const tracks: ProjectTrack[] = legacy.tracks.map((track) => ({
    id: track.id,
    name: track.name,
    type: track.kind,
    height: track.kind === 'video' ? 70 : 48,
    locked: track.locked,
    visible: true,
    muted: track.muted,
    solo: false,
  }));
  const clips: ProjectClip[] = legacy.clips
    .filter((clip) => assetIds.has(clip.assetId) && trackIds.has(clip.trackId))
    .map((clip) => {
      const type = transitionType(clip.transitionIn);
      return {
        id: clip.id,
        trackId: clip.trackId,
        name: clip.name,
        mediaId: clip.assetId,
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
        transform: {
          x: clip.transform.x,
          y: clip.transform.y,
          z: 0,
          scaleX: clip.transform.scaleX,
          scaleY: clip.transform.scaleY,
          scaleZ: 1,
          rotation: clip.transform.rotation,
          rotationX: 0,
          rotationY: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          opacity: clip.transform.opacity,
          blendMode: 'normal',
        },
        effects: [],
        masks: [],
        keyframes: [],
        volume: clip.volume,
        audioEnabled: !clip.muted,
        reversed: false,
        disabled: false,
        sourceType: legacy.assets.find((asset) => asset.id === clip.assetId)?.kind,
        naturalDuration: legacy.assets.find((asset) => asset.id === clip.assetId)?.duration,
        ...(type && clip.transitionFromClipId ? {
          transitionIn: {
            id: clip.transitionId ?? `transition-${clip.id}`,
            type,
            duration: clip.transitionDuration ?? 0.5,
            linkedClipId: clip.transitionFromClipId,
          },
        } : {}),
      };
    });

  composition.tracks = tracks.length > 0 ? tracks : composition.tracks;
  composition.clips = clips;
  composition.duration = Math.max(
    60,
    ...clips.map((clip) => clip.startTime + clip.duration),
  );
  projectFile.media = media;
  projectFile.updatedAt = legacy.updatedAt;
  projectFile.uiState = {
    compositionViewState: {
      [composition.id]: { playheadPosition: legacy.playhead },
    },
  };
  return projectFile;
}
