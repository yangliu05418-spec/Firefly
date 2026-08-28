import {
  createId,
  type AtlasAgentOperation,
  type AtlasAgentPlan,
  type AtlasClip,
  type AtlasDocument,
  type AtlasTrack,
  type TransitionKind,
} from './model';

export interface EditorHistory {
  past: AtlasDocument[];
  present: AtlasDocument;
  future: AtlasDocument[];
}

export interface TimelinePlaybackState {
  playhead: number;
  playing: boolean;
}

export type TimelinePlaybackAction =
  | { type: 'seek'; time: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle' }
  | { type: 'advance'; delta: number; duration: number };

export const createTimelinePlayback = (playhead = 0): TimelinePlaybackState => ({
  playhead: Math.max(0, playhead),
  playing: false,
});

/** Playback is UI state: it must never increment a document revision or trigger cloud persistence. */
export function timelinePlaybackReducer(state: TimelinePlaybackState, action: TimelinePlaybackAction): TimelinePlaybackState {
  switch (action.type) {
    case 'seek':
      return { ...state, playhead: Math.max(0, action.time) };
    case 'play':
      return state.playing ? state : { ...state, playing: true };
    case 'pause':
      return state.playing ? { ...state, playing: false } : state;
    case 'toggle':
      return { ...state, playing: !state.playing };
    case 'advance': {
      if (!state.playing) return state;
      const duration = Math.max(0, action.duration);
      const next = Math.min(duration, state.playhead + Math.max(0, action.delta));
      return { playhead: next, playing: next < duration };
    }
  }
}

export type EditorAction =
  | { type: 'replace'; document: AtlasDocument }
  | { type: 'rename-document'; title: string }
  | { type: 'add-assets'; assets: AtlasDocument['assets'] }
  | { type: 'sync-asset'; assetId: string; patch: Partial<AtlasDocument['assets'][number]> }
  | { type: 'set-playhead'; time: number }
  | { type: 'add-clip'; assetId: string; trackId?: string; startTime?: number }
  | { type: 'move-clip'; clipId: string; trackId: string; startTime: number }
  | { type: 'delete-clip'; clipId: string }
  | { type: 'split-clip'; clipId: string; time: number }
  | { type: 'reorder-clip'; clipId: string; beforeClipId?: string }
  | { type: 'update-trim'; clipId: string; inPoint: number; outPoint: number }
  | { type: 'update-volume'; clipId: string; volume: number }
  | { type: 'update-transform'; clipId: string; patch: Partial<AtlasClip['transform']> }
  | { type: 'toggle-clip-muted'; clipId: string }
  | { type: 'set-transition'; clipId: string; transition: TransitionKind }
  | { type: 'add-track'; kind: AtlasTrack['kind'] }
  | { type: 'toggle-track-muted'; trackId: string }
  | { type: 'toggle-track-locked'; trackId: string }
  | { type: 'apply-agent-plan'; operations: AtlasAgentOperation[] }
  | { type: 'commit-agent-document'; document: AtlasDocument }
  | { type: 'undo' }
  | { type: 'redo' };

const MAX_HISTORY = 80;

const touched = (document: AtlasDocument): AtlasDocument => ({
  ...document,
  updatedAt: new Date().toISOString(),
});

function addClip(document: AtlasDocument, assetId: string, trackId?: string, requestedStart?: number): AtlasDocument {
  const asset = document.assets.find((candidate) => candidate.id === assetId);
  if (!asset) return document;
  const requestedKind = asset.kind === 'audio' ? 'audio' : 'video';
  const track = document.tracks.find((candidate) => candidate.id === trackId && candidate.kind === requestedKind)
    ?? document.tracks.find((candidate) => candidate.kind === requestedKind && !candidate.locked);
  if (!track || track.locked) return document;
  const trackClips = document.clips.filter((clip) => clip.trackId === track.id);
  const startTime = requestedStart === undefined
    ? trackClips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0)
    : Math.max(0, requestedStart);
  const duration = Math.max(0.1, asset.duration || (asset.kind === 'image' ? 5 : 10));
  const clip: AtlasClip = {
    id: createId('clip'),
    assetId,
    trackId: track.id,
    name: asset.name,
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    volume: 1,
    muted: false,
    transitionIn: 'none',
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
  };
  return touched({ ...document, clips: [...document.clips, clip] });
}

function deleteClip(document: AtlasDocument, clipId: string): AtlasDocument {
  const target = document.clips.find((clip) => clip.id === clipId);
  if (!target || document.tracks.find((track) => track.id === target.trackId)?.locked) return document;
  return touched({
    ...document,
    clips: document.clips.filter((clip) => clip.id !== clipId).map((clip) => clip.transitionFromClipId === clipId
      ? { ...clip, transitionIn: 'none', transitionId: undefined, transitionFromClipId: undefined, transitionDuration: undefined }
      : clip),
  });
}

function splitClip(document: AtlasDocument, clipId: string, time: number): AtlasDocument {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip || document.tracks.find((track) => track.id === clip.trackId)?.locked
    || time <= clip.startTime + 0.05 || time >= clip.startTime + clip.duration - 0.05) return document;
  const leftDuration = time - clip.startTime;
  const rightDuration = clip.duration - leftDuration;
  const left: AtlasClip = { ...clip, duration: leftDuration, outPoint: clip.inPoint + leftDuration };
  const right: AtlasClip = {
    ...clip,
    id: createId('clip'),
    startTime: time,
    duration: rightDuration,
    inPoint: clip.inPoint + leftDuration,
    transitionIn: 'none',
    transitionId: undefined,
    transitionFromClipId: undefined,
    transitionDuration: undefined,
  };
  return touched({
    ...document,
    clips: document.clips.flatMap((candidate) => candidate.id === clipId ? [left, right] : [candidate]),
  });
}

function reorderClip(document: AtlasDocument, clipId: string, beforeClipId?: string): AtlasDocument {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return document;
  const track = document.tracks.find((candidate) => candidate.id === clip.trackId);
  if (!track || track.locked) return document;
  const ordered = document.clips
    .filter((candidate) => candidate.trackId === clip.trackId && candidate.id !== clipId)
    .sort((a, b) => a.startTime - b.startTime);
  const index = beforeClipId ? ordered.findIndex((candidate) => candidate.id === beforeClipId) : -1;
  ordered.splice(index < 0 ? ordered.length : index, 0, clip);
  let cursor = 0;
  const replacements = new Map<string, AtlasClip>();
  for (const candidate of ordered) {
    replacements.set(candidate.id, { ...candidate, startTime: cursor });
    cursor += candidate.duration;
  }
  return touched({
    ...document,
    clips: document.clips.map((candidate) => replacements.get(candidate.id) ?? candidate),
  });
}

function updateClip(document: AtlasDocument, clipId: string, patch: Partial<AtlasClip>): AtlasDocument {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip || document.tracks.find((track) => track.id === clip.trackId)?.locked) return document;
  return touched({
    ...document,
    clips: document.clips.map((candidate) => candidate.id === clipId ? { ...candidate, ...patch } : candidate),
  });
}

function moveClip(document: AtlasDocument, clipId: string, trackId: string, startTime: number): AtlasDocument {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  const sourceTrack = clip ? document.tracks.find((track) => track.id === clip.trackId) : undefined;
  const asset = clip ? document.assets.find((candidate) => candidate.id === clip.assetId) : undefined;
  const requiredKind = asset?.kind === 'audio' ? 'audio' : 'video';
  const targetTrack = document.tracks.find((track) => track.id === trackId && track.kind === requiredKind);
  if (!clip || !sourceTrack || sourceTrack.locked || !targetTrack || targetTrack.locked || !Number.isFinite(startTime)) return document;
  return touched({
    ...document,
    clips: document.clips.map((candidate) => candidate.id === clipId
      ? { ...candidate, trackId, startTime: Math.max(0, startTime) }
      : candidate),
  });
}

function applyOperation(document: AtlasDocument, operation: AtlasAgentOperation): AtlasDocument {
  const args = operation.args;
  switch (operation.tool) {
    case 'split_clip':
      if (typeof args.clipId === 'string' && typeof args.atMs === 'number') {
        const clip = document.clips.find((candidate) => candidate.id === args.clipId);
        return clip ? splitClip(document, args.clipId, clip.startTime + args.atMs / 1000) : document;
      }
      return document;
    case 'trim_clip':
      return typeof args.clipId === 'string' && typeof args.sourceInMs === 'number' && typeof args.sourceOutMs === 'number'
        ? updateTrim(document, args.clipId, args.sourceInMs / 1000, args.sourceOutMs / 1000)
        : document;
    case 'delete_clip':
      return typeof args.clipId === 'string' ? deleteClip(document, args.clipId) : document;
    case 'move_clip': {
      if (typeof args.clipId !== 'string' || typeof args.startMs !== 'number' || typeof args.trackId !== 'string') return document;
      return moveClip(document, args.clipId, args.trackId, args.startMs / 1000);
    }
    case 'insert_project_asset':
      return typeof args.assetId === 'string' && typeof args.trackId === 'string' && typeof args.startMs === 'number'
        ? addClip(document, args.assetId, args.trackId, args.startMs / 1000)
        : document;
    case 'reorder_clips':
      return typeof args.trackId === 'string' && Array.isArray(args.clipIds) && args.clipIds.every((id) => typeof id === 'string')
        ? reorderClipIds(document, args.trackId, args.clipIds)
        : document;
    case 'set_clip_volume':
      return typeof args.clipId === 'string' && typeof args.volume === 'number'
        ? updateClip(document, args.clipId, { volume: Math.max(0, Math.min(4, args.volume)) })
        : document;
    case 'set_track_muted':
      if (typeof args.trackId === 'string' && typeof args.muted === 'boolean') {
        const trackId = args.trackId;
        const muted = args.muted;
        if (!document.tracks.some((track) => track.id === trackId)) return document;
        return touched({ ...document, tracks: document.tracks.map((track) => track.id === trackId ? { ...track, muted } : track) });
      }
      return document;
    case 'set_transform': {
      if (typeof args.clipId !== 'string') return document;
      const clip = document.clips.find((candidate) => candidate.id === args.clipId);
      if (!clip) return document;
      return updateClip(document, args.clipId, {
        transform: {
          x: typeof args.positionX === 'number' ? args.positionX : clip.transform.x,
          y: typeof args.positionY === 'number' ? args.positionY : clip.transform.y,
          scaleX: typeof args.scaleX === 'number' ? Math.max(0.01, Math.min(100, args.scaleX)) : clip.transform.scaleX,
          scaleY: typeof args.scaleY === 'number' ? Math.max(0.01, Math.min(100, args.scaleY)) : clip.transform.scaleY,
          rotation: typeof args.rotationDeg === 'number' ? args.rotationDeg : clip.transform.rotation,
          opacity: typeof args.opacity === 'number' ? Math.max(0, Math.min(1, args.opacity)) : clip.transform.opacity,
        },
      });
    }
    case 'add_transition': {
      const transition = providerTransition(args.type);
      if (typeof args.transitionId !== 'string' || typeof args.fromClipId !== 'string' || typeof args.toClipId !== 'string'
        || typeof args.durationMs !== 'number' || !transition) return document;
      const from = document.clips.find((clip) => clip.id === args.fromClipId);
      const to = document.clips.find((clip) => clip.id === args.toClipId);
      if (!from || !to || from.id === to.id || from.trackId !== to.trackId || document.clips.some((clip) => clip.transitionId === args.transitionId)) return document;
      if (previousAdjacentClip(document, to)?.id !== from.id) return document;
      return updateClip(document, to.id, {
        transitionIn: transition,
        transitionId: args.transitionId,
        transitionFromClipId: from.id,
        transitionDuration: Math.max(0.05, Math.min(10, from.duration, to.duration, args.durationMs / 1000)),
      });
    }
    case 'remove_transition': {
      if (typeof args.transitionId !== 'string') return document;
      const target = document.clips.find((clip) => clip.transitionId === args.transitionId);
      return target ? updateClip(document, target.id, {
        transitionIn: 'none', transitionId: undefined, transitionFromClipId: undefined, transitionDuration: undefined,
      }) : document;
    }
    case 'create_track':
      return (args.kind === 'video' || args.kind === 'audio') && typeof args.trackId === 'string'
        ? addTrack(document, args.kind, args.trackId, typeof args.index === 'number' ? args.index : undefined)
        : document;
    case 'request_export':
      return document;
    default:
      return document;
  }
}

function reorderClipIds(document: AtlasDocument, trackId: string, clipIds: string[]): AtlasDocument {
  const track = document.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.locked) return document;
  const sameTrackIds = new Set(document.clips.filter((clip) => clip.trackId === track.id).map((clip) => clip.id));
  if (clipIds.some((id) => !sameTrackIds.has(id))) return document;
  const requested = clipIds.map((id) => document.clips.find((clip) => clip.id === id)).filter((clip): clip is AtlasClip => Boolean(clip));
  const requestedIds = new Set(clipIds);
  const remaining = document.clips.filter((clip) => clip.trackId === track.id && !requestedIds.has(clip.id)).sort((a, b) => a.startTime - b.startTime);
  let cursor = 0;
  const replacements = new Map<string, AtlasClip>();
  for (const clip of [...requested, ...remaining]) {
    replacements.set(clip.id, { ...clip, startTime: cursor });
    cursor += clip.duration;
  }
  return touched({ ...document, clips: document.clips.map((clip) => replacements.get(clip.id) ?? clip) });
}

function providerTransition(value: unknown): TransitionKind | null {
  const map: Record<string, TransitionKind> = {
    crossfade: 'crossfade', wipe_left: 'wipe-left', wipe_right: 'wipe-right',
    wipe_up: 'wipe-up', wipe_down: 'wipe-down', dip_to_black: 'dip-black',
  };
  return typeof value === 'string' ? map[value] ?? null : null;
}

function previousAdjacentClip(document: AtlasDocument, target: AtlasClip): AtlasClip | undefined {
  const candidates = document.clips
    .filter((clip) => clip.trackId === target.trackId && clip.id !== target.id && clip.startTime <= target.startTime)
    .sort((left, right) => (right.startTime + right.duration) - (left.startTime + left.duration));
  const previous = candidates[0];
  return previous && Math.abs(previous.startTime + previous.duration - target.startTime) <= 0.01 ? previous : undefined;
}

function updateTrim(document: AtlasDocument, clipId: string, inPoint: number, outPoint: number): AtlasDocument {
  const clip = document.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return document;
  const assetDuration = document.assets.find((asset) => asset.id === clip.assetId)?.duration ?? Math.max(clip.outPoint, outPoint);
  const safeIn = Math.max(0, Math.min(inPoint, assetDuration - 0.1));
  const safeOut = Math.min(assetDuration, Math.max(safeIn + 0.1, outPoint));
  return updateClip(document, clipId, { inPoint: safeIn, outPoint: safeOut, duration: safeOut - safeIn });
}

function addTrack(document: AtlasDocument, kind: AtlasTrack['kind'], id = createId(`track-${kind}`), index?: number): AtlasDocument {
  if (document.tracks.some((track) => track.id === id)) return document;
  const count = document.tracks.filter((track) => track.kind === kind).length + 1;
  const track: AtlasTrack = {
    id,
    name: `${kind === 'video' ? '画面' : '声音'} ${count}`,
    kind,
    muted: false,
    locked: false,
  };
  const tracks = [...document.tracks];
  tracks.splice(index === undefined ? tracks.length : Math.max(0, Math.min(tracks.length, Math.floor(index))), 0, track);
  return touched({ ...document, tracks });
}

function setClipTransition(document: AtlasDocument, clipId: string, transition: TransitionKind): AtlasDocument {
  const target = document.clips.find((clip) => clip.id === clipId);
  if (!target) return document;
  if (transition === 'none') return updateClip(document, clipId, {
    transitionIn: 'none', transitionId: undefined, transitionFromClipId: undefined, transitionDuration: undefined,
  });
  const previous = previousAdjacentClip(document, target);
  if (!previous) return document;
  const duration = Math.min(target.transitionDuration ?? 0.35, previous.duration, target.duration);
  return updateClip(document, clipId, {
    transitionIn: transition,
    transitionId: target.transitionId ?? createId('transition'),
    transitionFromClipId: previous.id,
    transitionDuration: duration,
  });
}

function mutate(document: AtlasDocument, action: Exclude<EditorAction, { type: 'replace' | 'undo' | 'redo' }>): AtlasDocument {
  switch (action.type) {
    case 'rename-document':
      return touched({ ...document, title: action.title.trim() || document.title });
    case 'add-assets': {
      const existing = new Set(document.assets.map((asset) => asset.id));
      const additions = action.assets.filter((asset) => !existing.has(asset.id));
      return additions.length ? touched({ ...document, assets: [...document.assets, ...additions] }) : document;
    }
    case 'sync-asset':
      return {
        ...document,
        assets: document.assets.map((asset) => asset.id === action.assetId ? { ...asset, ...action.patch } : asset),
      };
    case 'set-playhead':
      return { ...document, playhead: Math.max(0, action.time) };
    case 'add-clip':
      return addClip(document, action.assetId, action.trackId, action.startTime);
    case 'move-clip':
      return moveClip(document, action.clipId, action.trackId, action.startTime);
    case 'delete-clip':
      return deleteClip(document, action.clipId);
    case 'split-clip':
      return splitClip(document, action.clipId, action.time);
    case 'reorder-clip':
      return reorderClip(document, action.clipId, action.beforeClipId);
    case 'update-trim':
      return updateTrim(document, action.clipId, action.inPoint, action.outPoint);
    case 'update-volume':
      return updateClip(document, action.clipId, { volume: Math.max(0, Math.min(4, action.volume)) });
    case 'update-transform': {
      const clip = document.clips.find((candidate) => candidate.id === action.clipId);
      return clip ? updateClip(document, action.clipId, { transform: { ...clip.transform, ...action.patch } }) : document;
    }
    case 'toggle-clip-muted': {
      const clip = document.clips.find((candidate) => candidate.id === action.clipId);
      return clip ? updateClip(document, action.clipId, { muted: !clip.muted }) : document;
    }
    case 'set-transition':
      return setClipTransition(document, action.clipId, action.transition);
    case 'add-track':
      return addTrack(document, action.kind);
    case 'toggle-track-muted':
      return document.tracks.some((track) => track.id === action.trackId)
        ? touched({ ...document, tracks: document.tracks.map((track) => track.id === action.trackId ? { ...track, muted: !track.muted } : track) })
        : document;
    case 'toggle-track-locked':
      return document.tracks.some((track) => track.id === action.trackId)
        ? touched({ ...document, tracks: document.tracks.map((track) => track.id === action.trackId ? { ...track, locked: !track.locked } : track) })
        : document;
    case 'apply-agent-plan':
      return applyAgentOperations(document, action.operations) ?? document;
    case 'commit-agent-document':
      return action.document;
  }
}

export function createEditorHistory(document: AtlasDocument): EditorHistory {
  return { past: [], present: document, future: [] };
}

export function editorReducer(state: EditorHistory, action: EditorAction): EditorHistory {
  if (action.type === 'replace') return createEditorHistory(action.document);
  if (action.type === 'commit-agent-document') {
    return {
      past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present],
      present: action.document,
      future: [],
    };
  }
  if (action.type === 'undo') {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] };
  }
  if (action.type === 'redo') {
    const next = state.future[0];
    if (!next) return state;
    return { past: [...state.past, state.present], present: next, future: state.future.slice(1) };
  }
  const next = mutate(state.present, action);
  if (next === state.present) return state;
  if (action.type === 'set-playhead' || action.type === 'sync-asset' || action.type === 'rename-document') return { ...state, present: next };
  return {
    past: [...state.past.slice(-(MAX_HISTORY - 1)), state.present],
    present: next,
    future: [],
  };
}

/**
 * The mutation lock is enforced at the reducer boundary, rather than only by
 * disabling buttons. This also rejects delayed media callbacks and keyboard
 * actions that were queued before an Agent transaction started.
 */
export function guardedEditorReducer(state: EditorHistory, action: EditorAction, mutationLocked: boolean): EditorHistory {
  if (mutationLocked && action.type !== 'commit-agent-document') return state;
  return editorReducer(state, action);
}

export const SUPPORTED_AGENT_OPERATIONS = new Set([
  'split_clip', 'trim_clip', 'move_clip', 'delete_clip', 'insert_project_asset', 'reorder_clips',
  'set_clip_volume', 'set_track_muted', 'set_transform', 'add_transition', 'remove_transition',
  'create_track', 'request_export',
]);

export const ATLAS_AGENT_CATALOG_VERSION = '1';
export const ATLAS_AGENT_CATALOG_DIGEST = 'a1f8a8d0e7529464ee6d6fdf79a71e8f47d25b2eb2e6c76ee7c82486614395e2';

type OperationPolicy = {
  risk: AtlasAgentOperation['risk'];
  requiresConfirmation: boolean;
  validate: (args: Record<string, unknown>) => boolean;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const hasExactKeys = (value: Record<string, unknown>, required: string[], optional: string[] = []) => {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
};
const isFiniteBetween = (value: unknown, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
const isIntegerBetween = (value: unknown, minimum: number, maximum: number) =>
  Number.isInteger(value) && isFiniteBetween(value, minimum, maximum);
const isId = (value: unknown) => typeof value === 'string' && value.length >= 1 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
const isMilliseconds = (value: unknown) => isFiniteBetween(value, 0, 86_400_000);
const enumValue = (value: unknown, values: readonly string[]) => typeof value === 'string' && values.includes(value);

const policies: Record<string, OperationPolicy> = {
  split_clip: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['clipId', 'atMs']) && isId(args.clipId) && isMilliseconds(args.atMs) },
  trim_clip: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['clipId', 'sourceInMs', 'sourceOutMs']) && isId(args.clipId) && isMilliseconds(args.sourceInMs) && isMilliseconds(args.sourceOutMs) && Number(args.sourceOutMs) > Number(args.sourceInMs) },
  move_clip: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['clipId', 'trackId', 'startMs']) && isId(args.clipId) && isId(args.trackId) && isMilliseconds(args.startMs) },
  reorder_clips: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['trackId', 'clipIds']) && isId(args.trackId) && Array.isArray(args.clipIds) && args.clipIds.length >= 1 && args.clipIds.length <= 500 && args.clipIds.every(isId) && new Set(args.clipIds).size === args.clipIds.length },
  delete_clip: { risk: 'destructive', requiresConfirmation: true, validate: (args) => hasExactKeys(args, ['clipId']) && isId(args.clipId) },
  insert_project_asset: { risk: 'medium', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['assetId', 'trackId', 'startMs']) && isId(args.assetId) && isId(args.trackId) && isMilliseconds(args.startMs) },
  create_track: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['trackId', 'kind'], ['index']) && isId(args.trackId) && enumValue(args.kind, ['video', 'audio']) && (args.index === undefined || isIntegerBetween(args.index, 0, 127)) },
  set_track_muted: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['trackId', 'muted']) && isId(args.trackId) && typeof args.muted === 'boolean' },
  set_clip_volume: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['clipId', 'volume']) && isId(args.clipId) && isFiniteBetween(args.volume, 0, 4) },
  set_transform: { risk: 'low', requiresConfirmation: false, validate: (args) => {
    if (!hasExactKeys(args, ['clipId'], ['positionX', 'positionY', 'scaleX', 'scaleY', 'rotationDeg', 'opacity']) || !isId(args.clipId)) return false;
    const optional = Object.entries({ positionX: [-100_000, 100_000], positionY: [-100_000, 100_000], scaleX: [0.01, 100], scaleY: [0.01, 100], rotationDeg: [-36_000, 36_000], opacity: [0, 1] } as const);
    return optional.some(([key]) => args[key] !== undefined) && optional.every(([key, range]) => args[key] === undefined || isFiniteBetween(args[key], range[0], range[1]));
  } },
  add_transition: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['transitionId', 'fromClipId', 'toClipId', 'type', 'durationMs']) && isId(args.transitionId) && isId(args.fromClipId) && isId(args.toClipId) && args.fromClipId !== args.toClipId && enumValue(args.type, ['crossfade', 'wipe_left', 'wipe_right', 'wipe_up', 'wipe_down', 'dip_to_black']) && isFiniteBetween(args.durationMs, 50, 10_000) },
  remove_transition: { risk: 'low', requiresConfirmation: false, validate: (args) => hasExactKeys(args, ['transitionId']) && isId(args.transitionId) },
  request_export: { risk: 'external', requiresConfirmation: true, validate: (args) => hasExactKeys(args, ['preset'], ['fileName']) && args.preset === 'mp4_h264_aac_1080p30' && (args.fileName === undefined || (typeof args.fileName === 'string' && args.fileName.trim().length >= 1 && args.fileName.length <= 180)) },
};

export function validateAgentOperations(operations: AtlasAgentOperation[]): boolean {
  const exportIndex = operations.findIndex((operation) => operation.tool === 'request_export');
  if (exportIndex >= 0 && (exportIndex !== operations.length - 1 || operations.filter((operation) => operation.tool === 'request_export').length !== 1)) return false;
  return operations.length > 0 && operations.length <= 32 && operations.every((operation, index) =>
    Number.isSafeInteger(operation.sequence)
    && operation.sequence === index + 1
    && typeof operation.operationKey === 'string'
    && operation.operationKey.length >= 3
    && /^[a-f0-9]{64}$/i.test(operation.operationDigest)
    && SUPPORTED_AGENT_OPERATIONS.has(operation.tool)
    && isPlainRecord(operation.args)
    && policies[operation.tool]?.risk === operation.risk
    && policies[operation.tool]?.requiresConfirmation === operation.requiresConfirmation
    && policies[operation.tool]?.validate(operation.args) === true,
  );
}

/** Reject a plan produced against any older or unknown browser catalog. */
export function validateAgentPlan(plan: AtlasAgentPlan): boolean {
  return plan.version === 1
    && plan.catalogVersion === ATLAS_AGENT_CATALOG_VERSION
    && plan.catalogDigest === ATLAS_AGENT_CATALOG_DIGEST
    && Number.isSafeInteger(plan.baseRevision)
    && plan.baseRevision >= 0
    && typeof plan.summary === 'string'
    && plan.summary.trim().length >= 1
    && plan.summary.length <= 500
    && /^[a-f0-9]{64}$/i.test(plan.planDigest)
    && validateAgentOperations(plan.operations);
}

/** Pure, fail-closed execution used both for preflight and the reducer commit. */
export function applyAgentOperations(document: AtlasDocument, operations: AtlasAgentOperation[]): AtlasDocument | null {
  if (!validateAgentOperations(operations)) return null;
  let next = document;
  const editingOperations = operations.filter((operation) => operation.tool !== 'request_export');
  for (const operation of editingOperations) {
    const applied = applyOperation(next, operation);
    if (applied === next) return null;
    next = applied;
  }
  return editingOperations.length ? { ...next, revision: document.revision + 1 } : next;
}
