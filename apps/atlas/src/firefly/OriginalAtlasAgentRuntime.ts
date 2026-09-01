import { executeAIToolCalls } from '../services/aiTools';
import { useMediaStore } from '../stores/mediaStore';
import { useTimelineStore } from '../stores/timeline';
import { useDockStore } from '../stores/dockStore';
import type { TimelineClip } from '../types';
import { ATLAS_AGENT_CATALOGS } from './atlas-agent-catalog.generated';
import { validateAgentSchema } from './atlasAgentSchema';
import type { AtlasAgentPlan, AtlasAgentSemanticSnapshot } from './OriginalAtlasAgentClient';

const allCatalogs = Object.values(ATLAS_AGENT_CATALOGS);
const catalogByDigest = new Map<string, (typeof allCatalogs)[number]>(allCatalogs.map((catalog) => [catalog.digest, catalog]));
const v1CatalogVersion = '1';
const v1CatalogDigest = 'a1f8a8d0e7529464ee6d6fdf79a71e8f47d25b2eb2e6c76ee7c82486614395e2';

const clipKind = (clip: TimelineClip): 'video' | 'audio' | 'image' | 'text' => {
  const type = clip.source?.type;
  if (type === 'audio') return 'audio';
  if (type === 'image') return 'image';
  if (type === 'text' || clip.textProperties) return 'text';
  return 'video';
};
const boundedMs = (seconds: number) => Math.max(0, Math.min(86_400_000, Math.round(seconds * 1000)));

export function createOriginalAtlasAgentSnapshot(revision: number): AtlasAgentSemanticSnapshot {
  const timeline = useTimelineStore.getState(); const media = useMediaStore.getState();
  const tracks = timeline.tracks.filter((track) => track.type === 'video' || track.type === 'audio').slice(0, 128);
  const trackIds = new Set(tracks.map((track) => track.id));
  const files = media.files.filter((file) => ['video', 'audio', 'image'].includes(file.type)).slice(0, 500);
  const assetIds = new Set(files.map((file) => file.id));
  const clips = timeline.clips.filter((clip) => trackIds.has(clip.trackId)).slice(0, 2_000);
  return {
    version: 2, revision,
    durationMs: boundedMs(clips.reduce((maximum, clip) => Math.max(maximum, clip.startTime + clip.duration), 0)),
    tracks: tracks.map((track) => ({ id: track.id, kind: track.type as 'video' | 'audio', muted: track.muted, locked: track.locked === true, clipIds: clips.filter((clip) => clip.trackId === track.id).sort((left, right) => left.startTime - right.startTime).map((clip) => clip.id) })),
    clips: clips.map((clip) => ({ id: clip.id, trackId: clip.trackId, ...(clip.mediaFileId && assetIds.has(clip.mediaFileId) ? { assetId: clip.mediaFileId } : {}), kind: clipKind(clip), startMs: boundedMs(clip.startTime), durationMs: boundedMs(clip.duration), sourceInMs: boundedMs(clip.inPoint), sourceOutMs: boundedMs(clip.outPoint), muted: clip.audioState?.muted === true, transform: { positionX: clip.transform.position.x, positionY: clip.transform.position.y, scaleX: clip.transform.scale.x, scaleY: clip.transform.scale.y, rotationDeg: clip.transform.rotation.z, opacity: clip.transform.opacity }, features: { effects: clip.effects.length, keyframes: clip.effects.reduce((count, effect) => count + (Array.isArray((effect as unknown as { keyframes?: unknown }).keyframes) ? ((effect as unknown as { keyframes: unknown[] }).keyframes.length) : 0), 0), masks: clip.masks?.length ?? 0, transcriptWords: clip.transcript?.length ?? 0, hasText: Boolean(clip.textProperties), hasCaptions: Boolean(clip.captionProperties), hasStoryboard: Boolean(clip.storyboardProperties), ...(clip.textProperties?.text ? { textPreview: clip.textProperties.text.slice(0, 1_000) } : {}), ...(clip.analysisStatus ? { analysisStatus: String(clip.analysisStatus).slice(0, 64) } : {}) } })),
    assets: files.map((file) => ({ id: file.id, kind: file.type as 'video' | 'audio' | 'image', name: file.name.slice(0, 300) || '未命名素材', ...(typeof file.duration === 'number' ? { durationMs: boundedMs(file.duration) } : {}), ...(typeof file.width === 'number' ? { width: Math.round(file.width) } : {}), ...(typeof file.height === 'number' ? { height: Math.round(file.height) } : {}) })),
    selection: { clipIds: [...timeline.selectedClipIds].filter((id) => clips.some((clip) => clip.id === id)).slice(0, 500), trackIds: [] },
    markers: timeline.markers.slice(0, 1_000).map((marker) => ({ id: marker.id, timeMs: boundedMs(marker.time), label: marker.label.slice(0, 300) })),
  };
}

export function originalAtlasAgentSemanticFingerprint(snapshot: AtlasAgentSemanticSnapshot): string {
  const { revision: _revision, ...semantic } = snapshot; return JSON.stringify(semantic);
}

export function validateOriginalAtlasAgentPlan(plan: AtlasAgentPlan): string | null {
  if (plan.catalogVersion === v1CatalogVersion && plan.catalogDigest === v1CatalogDigest) return '旧版 Agent 计划仅可查看，请重新生成后执行';
  const catalog = catalogByDigest.get(plan.catalogDigest);
  if (!catalog || plan.catalogVersion !== catalog.version) return 'Agent 工具目录已更新，请重新生成计划';
  const definitions = new Map<string, (typeof catalog.tools)[number]>(catalog.tools.map((tool) => [tool.name, tool]));
  if (plan.operations.some((operation, index) => operation.sequence !== index + 1 || !operation.requiresConfirmation)) return '计划缺少必要的确认保护';
  for (const operation of plan.operations) {
    const definition = definitions.get(operation.tool);
    if (!definition || !validateAgentSchema(definition.schema, operation.args)) return `计划中的 ${operation.tool} 参数无效`;
  }
  return null;
}

export async function applyOriginalAtlasAgentPlan(plan: AtlasAgentPlan, signal?: AbortSignal): Promise<{ historyNodeId: string; beforeRevision: number; afterRevision: number }> {
  const validationError = validateOriginalAtlasAgentPlan(plan); if (validationError) throw new Error(validationError);
  const nativeOperations = plan.operations.filter((operation) => operation.tool !== 'requestFireflyExport');
  const exportRequested = plan.operations.some((operation) => operation.tool === 'requestFireflyExport');
  if (nativeOperations.length) {
    const results = await executeAIToolCalls(nativeOperations.map((operation) => ({ id: operation.operationKey, tool: operation.tool, args: operation.args })), 'fireflyAgent', { guidedReplay: false, signal });
    const failed = results.find((result) => !result.result.success);
    if (failed) throw new Error(failed.result.error ?? `${failed.tool} 执行失败`);
  }
  if (exportRequested) useDockStore.getState().activatePanelType('export');
  return { historyNodeId: crypto.randomUUID(), beforeRevision: plan.baseRevision, afterRevision: plan.baseRevision + 1 };
}
