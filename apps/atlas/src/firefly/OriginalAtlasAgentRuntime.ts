import type { TransitionType } from '../transitions/types';
import { useHistoryStore } from '../stores/historyStore';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import {
  acquireExclusiveTimelineMutationLease,
  releaseExclusiveTimelineMutationLease,
  runWithExclusiveTimelineMutationLease,
} from '../stores/timeline/exclusiveMutationLease';
import type { TimelineClip } from '../types';
import type { AtlasAgentOperation, AtlasAgentPlan, AtlasAgentSemanticSnapshot } from './OriginalAtlasAgentClient';

export const ORIGINAL_ATLAS_AGENT_CATALOG_VERSION = '1';
export const ORIGINAL_ATLAS_AGENT_CATALOG_DIGEST = 'a1f8a8d0e7529464ee6d6fdf79a71e8f47d25b2eb2e6c76ee7c82486614395e2';

const supportedTools = new Set([
  'split_clip', 'trim_clip', 'move_clip', 'reorder_clips', 'delete_clip', 'create_track',
  'set_track_muted', 'set_clip_volume', 'set_transform', 'add_transition', 'remove_transition',
]);

const clipKind = (clip: TimelineClip): 'video' | 'audio' | 'image' | 'text' => {
  const type = clip.source?.type;
  if (type === 'audio') return 'audio';
  if (type === 'image') return 'image';
  if (type === 'text' || clip.textProperties) return 'text';
  return 'video';
};

const boundedMs = (seconds: number) => Math.max(0, Math.min(86_400_000, Math.round(seconds * 1000)));

export function createOriginalAtlasAgentSnapshot(revision: number): AtlasAgentSemanticSnapshot {
  const timeline = useTimelineStore.getState();
  const media = useMediaStore.getState();
  const tracks = timeline.tracks.filter((track) => track.type === 'video' || track.type === 'audio').slice(0, 128);
  const trackIds = new Set(tracks.map((track) => track.id));
  const files = media.files.filter((file) => ['video', 'audio', 'image'].includes(file.type)).slice(0, 500);
  const assetIds = new Set(files.map((file) => file.id));
  const clips = timeline.clips.filter((clip) => trackIds.has(clip.trackId)).slice(0, 2_000);
  return {
    version: 1,
    revision,
    durationMs: boundedMs(clips.reduce((maximum, clip) => Math.max(maximum, clip.startTime + clip.duration), 0)),
    tracks: tracks.map((track) => ({
      id: track.id,
      kind: track.type as 'video' | 'audio',
      muted: track.muted,
      locked: track.locked === true,
      clipIds: clips.filter((clip) => clip.trackId === track.id).sort((left, right) => left.startTime - right.startTime).map((clip) => clip.id),
    })),
    clips: clips.map((clip) => ({
      id: clip.id,
      trackId: clip.trackId,
      ...(clip.mediaFileId && assetIds.has(clip.mediaFileId) ? { assetId: clip.mediaFileId } : {}),
      kind: clipKind(clip),
      startMs: boundedMs(clip.startTime),
      durationMs: boundedMs(clip.duration),
      sourceInMs: boundedMs(clip.inPoint),
      sourceOutMs: boundedMs(clip.outPoint),
      muted: clip.audioState?.muted === true,
      transform: {
        positionX: clip.transform.position.x,
        positionY: clip.transform.position.y,
        scaleX: clip.transform.scale.x,
        scaleY: clip.transform.scale.y,
        rotationDeg: clip.transform.rotation.z,
        opacity: clip.transform.opacity,
      },
    })),
    assets: files.map((file) => ({
      id: file.id,
      kind: file.type as 'video' | 'audio' | 'image',
      name: file.name.slice(0, 300) || '未命名素材',
      ...(typeof file.duration === 'number' ? { durationMs: boundedMs(file.duration) } : {}),
      ...(typeof file.width === 'number' ? { width: Math.round(file.width) } : {}),
      ...(typeof file.height === 'number' ? { height: Math.round(file.height) } : {}),
    })),
    selection: {
      clipIds: [...timeline.selectedClipIds].filter((id) => clips.some((clip) => clip.id === id)).slice(0, 500),
      trackIds: [],
    },
  };
}

export function originalAtlasAgentSemanticFingerprint(snapshot: AtlasAgentSemanticSnapshot): string {
  const { revision: _revision, ...semantic } = snapshot;
  return JSON.stringify(semantic);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validateOriginalAtlasAgentPlan(plan: AtlasAgentPlan): string | null {
  if (plan.catalogVersion !== ORIGINAL_ATLAS_AGENT_CATALOG_VERSION || plan.catalogDigest !== ORIGINAL_ATLAS_AGENT_CATALOG_DIGEST) {
    return 'Agent 工具目录已更新，请重新生成计划';
  }
  if (plan.operations.some((operation, index) => operation.sequence !== index + 1 || !supportedTools.has(operation.tool) || !isRecord(operation.args))) {
    return '计划包含当前编辑器无法安全执行的操作';
  }
  for (const operation of plan.operations) {
    const args = operation.args;
    if (['split_clip', 'trim_clip', 'move_clip', 'delete_clip', 'set_clip_volume', 'set_transform'].includes(operation.tool) && !text(args.clipId)) return '计划引用了无效片段';
    if (['move_clip', 'reorder_clips', 'set_track_muted'].includes(operation.tool) && !text(args.trackId)) return '计划引用了无效轨道';
    if (operation.tool === 'split_clip' && !finite(args.atMs)) return '切割时间无效';
    if (operation.tool === 'trim_clip' && (!finite(args.sourceInMs) || !finite(args.sourceOutMs) || args.sourceOutMs <= args.sourceInMs)) return '修剪范围无效';
    if (operation.tool === 'move_clip' && !finite(args.startMs)) return '移动时间无效';
    if (operation.tool === 'reorder_clips' && (!Array.isArray(args.clipIds) || !args.clipIds.every(text))) return '片段顺序无效';
    if (operation.tool === 'create_track' && (!text(args.trackId) || !['video', 'audio'].includes(String(args.kind)))) return '新轨道参数无效';
    if (operation.tool === 'set_track_muted' && typeof args.muted !== 'boolean') return '轨道静音参数无效';
    if (operation.tool === 'set_clip_volume' && (!finite(args.volume) || args.volume < 0 || args.volume > 4)) return '片段音量参数无效';
    if (operation.tool === 'add_transition' && (!text(args.transitionId) || !text(args.fromClipId) || !text(args.toClipId) || !finite(args.durationMs))) return '转场参数无效';
    if (operation.tool === 'remove_transition' && !text(args.transitionId)) return '转场标识无效';
  }
  return null;
}

const transitionType = (value: unknown): TransitionType | null => ({
  crossfade: 'crossfade',
  wipe_left: 'wipe-left',
  wipe_right: 'wipe-right',
  wipe_up: 'wipe-up',
  wipe_down: 'wipe-down',
  dip_to_black: 'dip-to-black',
} as Record<string, TransitionType>)[String(value)] ?? null;

function clipGainPatch(clip: TimelineClip, volume: number): Partial<TimelineClip> {
  const gainDb = volume <= 0 ? -60 : Math.max(-60, Math.min(12, 20 * Math.log10(volume)));
  const editStack = clip.audioState?.editStack ?? [];
  const existing = editStack.findIndex((operation) => operation.type === 'gain' && operation.params.agentClipGain === true);
  const operation = {
    id: existing >= 0 ? editStack[existing]!.id : `agent-gain-${crypto.randomUUID()}`,
    type: 'gain' as const,
    enabled: true,
    params: { label: 'Atlas Agent clip gain', agentClipGain: true, gainDb, preserveClipDuration: true },
    timeRange: { start: clip.inPoint, end: clip.outPoint },
    createdAt: existing >= 0 ? editStack[existing]!.createdAt : Date.now(),
  };
  return {
    audioState: {
      ...clip.audioState,
      editStack: existing >= 0 ? editStack.map((item, index) => index === existing ? operation : item) : [...editStack, operation],
    },
  };
}

function applyOperation(operation: AtlasAgentOperation, trackAliases: Map<string, string>, transitionAliases: Map<string, string>): void {
  const timeline = useTimelineStore.getState();
  const args = operation.args;
  const trackId = typeof args.trackId === 'string' ? (trackAliases.get(args.trackId) ?? args.trackId) : undefined;
  switch (operation.tool) {
    case 'split_clip': {
      const clip = timeline.clips.find((item) => item.id === args.clipId);
      if (!clip) throw new Error('要切割的片段已不存在');
      timeline.splitClip(clip.id, clip.startTime + Number(args.atMs) / 1000);
      return;
    }
    case 'trim_clip': timeline.trimClip(String(args.clipId), Number(args.sourceInMs) / 1000, Number(args.sourceOutMs) / 1000); return;
    case 'move_clip': timeline.moveClip(String(args.clipId), Number(args.startMs) / 1000, trackId, true, true, true); return;
    case 'delete_clip': timeline.removeClip(String(args.clipId)); return;
    case 'create_track': {
      const created = timeline.addTrack(args.kind as 'video' | 'audio');
      trackAliases.set(String(args.trackId), created);
      return;
    }
    case 'set_track_muted': timeline.setTrackMuted(String(trackId), Boolean(args.muted)); return;
    case 'set_clip_volume': {
      const clip = timeline.clips.find((item) => item.id === args.clipId);
      if (!clip || clipKind(clip) !== 'audio') throw new Error('片段不包含可调节的独立音频');
      timeline.updateClip(clip.id, clipGainPatch(clip, Number(args.volume)));
      return;
    }
    case 'set_transform': {
      const clip = timeline.clips.find((item) => item.id === args.clipId);
      if (!clip) throw new Error('要变换的片段已不存在');
      timeline.updateClipTransform(clip.id, {
        ...(finite(args.positionX) || finite(args.positionY) ? { position: { ...clip.transform.position, ...(finite(args.positionX) ? { x: args.positionX } : {}), ...(finite(args.positionY) ? { y: args.positionY } : {}) } } : {}),
        ...(finite(args.scaleX) || finite(args.scaleY) ? { scale: { ...clip.transform.scale, ...(finite(args.scaleX) ? { x: args.scaleX } : {}), ...(finite(args.scaleY) ? { y: args.scaleY } : {}) } } : {}),
        ...(finite(args.rotationDeg) ? { rotation: { ...clip.transform.rotation, z: args.rotationDeg } } : {}),
        ...(finite(args.opacity) ? { opacity: args.opacity } : {}),
      });
      return;
    }
    case 'add_transition': {
      const type = transitionType(args.type);
      if (!type) throw new Error('转场类型不受支持');
      const result = timeline.applyTransition(String(args.fromClipId), String(args.toClipId), type, Number(args.durationMs) / 1000, { source: 'ai-tool', historyLabel: 'Atlas Agent 添加转场' });
      if (!result.success) throw new Error(result.warnings[0]?.message ?? '无法添加转场');
      transitionAliases.set(String(args.transitionId), String(args.toClipId));
      return;
    }
    case 'remove_transition': {
      const id = String(args.transitionId);
      const clip = timeline.clips.find((item) => item.transitionIn?.id === id || item.transitionOut?.id === id)
        ?? timeline.clips.find((item) => item.id === transitionAliases.get(id));
      if (!clip) throw new Error('要移除的转场已不存在');
      const edge = clip.transitionIn ? 'in' : 'out';
      const result = timeline.removeTransition(clip.id, edge, { source: 'ai-tool', historyLabel: 'Atlas Agent 移除转场' });
      if (!result.success) throw new Error(result.warnings[0]?.message ?? '无法移除转场');
      return;
    }
    case 'reorder_clips': {
      let cursor = 0;
      for (const clipId of args.clipIds as string[]) {
        useTimelineStore.getState().moveClip(clipId, cursor, trackId, true, true, true);
        const moved = useTimelineStore.getState().clips.find((item) => item.id === clipId);
        if (!moved || moved.trackId !== trackId) throw new Error('片段顺序无法安全应用');
        cursor += moved.duration;
      }
      return;
    }
    default: throw new Error(`当前编辑器不支持 ${operation.tool}`);
  }
}

export function applyOriginalAtlasAgentPlan(plan: AtlasAgentPlan): { historyNodeId: string; beforeRevision: number; afterRevision: number } {
  const validationError = validateOriginalAtlasAgentPlan(plan);
  if (validationError) throw new Error(validationError);
  const beforeTimelineRevision = useTimelineStore.getState().timelineRevision;
  const lease = acquireExclusiveTimelineMutationLease(`Atlas Agent · ${plan.summary}`);
  const history = useHistoryStore.getState();
  const historyNodeId = crypto.randomUUID();
  try {
    runWithExclusiveTimelineMutationLease(lease, () => {
      const batch = history.startBatch(`Atlas Agent · ${plan.summary}`);
      if (!batch.opened) throw new Error('另一个编辑事务尚未结束，请稍后重试');
      try {
        const trackAliases = new Map<string, string>();
        const transitionAliases = new Map<string, string>();
        for (const operation of plan.operations) applyOperation(operation, trackAliases, transitionAliases);
        if (useTimelineStore.getState().timelineRevision === beforeTimelineRevision) throw new Error('计划没有产生可见更改');
        history.endBatch();
      } catch (error) {
        history.cancelBatch();
        throw error;
      }
    });
  } finally {
    releaseExclusiveTimelineMutationLease(lease);
  }
  return { historyNodeId, beforeRevision: plan.baseRevision, afterRevision: plan.baseRevision + 1 };
}
