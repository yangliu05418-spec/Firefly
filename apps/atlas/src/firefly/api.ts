import type {
  AtlasAgentOperation,
  AtlasAgentOperationResult,
  AtlasAgentPlan,
  AtlasAgentRun,
  AtlasAsset,
  AtlasBootstrap,
  AtlasDocument,
  AtlasProjectSummary,
  FireflyLibraryAsset,
  MediaKind,
} from './model';
import { stripRuntimeUrls } from './model';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const record = (value: unknown, label = '响应'): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(`${label}格式无效`, 502, 'ATLAS_RESPONSE_INVALID');
  return value as Record<string, unknown>;
};
const requiredText = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value) throw new ApiError(`${label}缺失`, 502, 'ATLAS_RESPONSE_INVALID');
  return value;
};
const requiredNumber = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ApiError(`${label}无效`, 502, 'ATLAS_RESPONSE_INVALID');
  return value;
};
const timestamp = (value: unknown, label: string) => {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  throw new ApiError(`${label}无效`, 502, 'ATLAS_RESPONSE_INVALID');
};

async function requestUnknown(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const responseText = response.status === 204 ? '' : await response.text();
  let payload: unknown;
  try { payload = responseText ? JSON.parse(responseText) : undefined; }
  catch { payload = responseText; }
  if (!response.ok) {
    const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
    throw new ApiError(
      typeof body.error === 'string' ? body.error : `请求失败（${response.status}）`,
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
      body.details,
    );
  }
  return payload;
}

const DEFAULT_IDEMPOTENT_TIMEOUT_MS = 30_000;
const ATLAS_COMPLETE_TIMEOUT_MS = 210_000;

async function idempotentRequestUnknown(
  path: string,
  init: RequestInit,
  attempts = 4,
  timeoutMs = DEFAULT_IDEMPOTENT_TIMEOUT_MS,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const timeout = new AbortController();
    const timeoutId = globalThis.setTimeout(() => timeout.abort(), timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
    try {
      return await requestUnknown(path, { ...init, signal });
    } catch (error) {
      const userAborted = init.signal?.aborted === true;
      lastError = timeout.signal.aborted && !userAborted
        ? new ApiError('网络响应超时，正在核对服务端结果', 504, 'ATLAS_NETWORK_TIMEOUT')
        : error;
      const retryable = !userAborted && (
        !(lastError instanceof ApiError)
        || lastError.status === 408
        || lastError.status === 429
        || lastError.status >= 500
      );
      if (!retryable || attempt === attempts - 1) throw lastError;
      await abortableDelay(1_000 * 2 ** attempt, init.signal ?? undefined);
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }
  throw lastError;
}

export function parseBootstrap(value: unknown): AtlasBootstrap {
  const root = record(value, '启动信息');
  const user = record(root.user, '用户信息');
  const capabilities = record(root.capabilities, '能力信息');
  return {
    user: {
      id: requiredText(user.id, '用户ID'),
      name: typeof user.name === 'string' && user.name ? user.name : 'Firefly 用户',
      email: typeof user.email === 'string' ? user.email : '',
      avatarUrl: typeof user.avatarUrl === 'string' && user.avatarUrl ? user.avatarUrl : undefined,
    },
    capabilities: {
      agent: capabilities.agent !== false,
      maxUploadBytes: requiredNumber(capabilities.maxUploadBytes, '上传上限'),
      partSize: requiredNumber(capabilities.partSize, '分片大小'),
      uploadConcurrency: requiredNumber(capabilities.uploadConcurrency, '上传并发数'),
    },
  };
}

export function parseProject(value: unknown): AtlasProjectSummary {
  const item = record(value, '项目信息');
  return {
    id: requiredText(item.id, '项目ID'),
    title: requiredText(item.title, '项目名称'),
    revision: requiredNumber(item.revision, '项目版本'),
    hasCheckpoint: item.hasCheckpoint === true,
    leaseDeviceId: typeof item.leaseDeviceId === 'string' ? item.leaseDeviceId : undefined,
    leaseExpiresAt: typeof item.leaseExpiresAt === 'number' ? item.leaseExpiresAt : undefined,
    createdAt: timestamp(item.createdAt, '创建时间'),
    updatedAt: timestamp(item.updatedAt, '更新时间'),
  };
}

const normalizeKind = (value: unknown): MediaKind | null => {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('video')) return 'video';
  if (normalized.includes('audio')) return 'audio';
  if (normalized.includes('image') || normalized.includes('photo')) return 'image';
  return null;
};

export function parseAsset(value: unknown): AtlasAsset {
  const item = record(value, '素材信息');
  const kind = normalizeKind(item.kind);
  if (!kind) throw new ApiError('素材类型无效', 502, 'ATLAS_RESPONSE_INVALID');
  const rawStatus = typeof item.status === 'string' ? item.status : 'failed';
  const status = rawStatus === 'ready' ? 'ready' : rawStatus === 'failed' ? 'failed' : 'uploading';
  return {
    id: requiredText(item.id, '素材ID'),
    name: requiredText(item.fileName, '素材名称'),
    kind,
    mimeType: requiredText(item.contentType, '素材类型'),
    size: requiredNumber(item.size, '素材大小'),
    duration: kind === 'image' ? 5 : 10,
    status,
    source: 'firefly',
    sourceId: typeof item.sourceId === 'string' ? item.sourceId : undefined,
    mediaUrl: typeof item.mediaUrl === 'string' ? item.mediaUrl : undefined,
    error: typeof item.error === 'string' ? item.error : undefined,
  };
}

const parseSignedPart = (value: unknown): SignedPart => {
  const item = record(value, '分片签名');
  return { partNumber: requiredNumber(item.partNumber, '分片编号'), url: requiredText(item.url, '分片地址') };
};
const parseCompletedPart = (value: unknown): CompletedPart => {
  const item = record(value, '已上传分片');
  return { partNumber: requiredNumber(item.partNumber, '分片编号'), etag: requiredText(item.etag, '分片ETag') };
};

export function parseAgentPlan(value: unknown): AtlasAgentPlan {
  const item = record(value, 'Agent计划');
  if (item.version !== 1) throw new ApiError('Agent计划版本不受支持', 502, 'ATLAS_AGENT_RESPONSE_INVALID');
  const operations = Array.isArray(item.operations) ? item.operations.map((raw): AtlasAgentOperation => {
    const operation = record(raw, 'Agent操作');
    const risk = operation.risk;
    if (!['low', 'medium', 'destructive', 'external'].includes(String(risk))) throw new ApiError('Agent风险等级无效', 502, 'ATLAS_AGENT_RESPONSE_INVALID');
    return {
      sequence: requiredNumber(operation.sequence, 'Agent操作序号'),
      tool: requiredText(operation.tool, 'Agent工具'),
      args: record(operation.args, 'Agent操作参数'),
      risk: risk as AtlasAgentOperation['risk'],
      requiresConfirmation: operation.requiresConfirmation === true,
      operationKey: requiredText(operation.operationKey, 'Agent操作键'),
      operationDigest: requiredText(operation.operationDigest, 'Agent操作摘要'),
    };
  }) : [];
  if (!operations.length || operations.length > 32) throw new ApiError('Agent操作数量无效', 502, 'ATLAS_AGENT_RESPONSE_INVALID');
  return {
    version: 1,
    summary: requiredText(item.summary, 'Agent计划摘要'),
    catalogVersion: requiredText(item.catalogVersion, 'Agent目录版本'),
    catalogDigest: requiredText(item.catalogDigest, 'Agent目录摘要'),
    baseRevision: requiredNumber(item.baseRevision, 'Agent基础版本'),
    operations,
    planDigest: requiredText(item.planDigest, 'Agent计划摘要值'),
  };
}

export function parseAgentRun(value: unknown): AtlasAgentRun {
  const item = record(value, 'Agent任务');
  const allowed = ['queued', 'planning', 'awaiting_confirmation', 'ready', 'running', 'succeeded', 'failed', 'cancelled'];
  if (!allowed.includes(String(item.status))) throw new ApiError('Agent任务状态无效', 502, 'ATLAS_AGENT_RESPONSE_INVALID');
  return {
    id: requiredText(item.id, 'Agent任务ID'),
    projectId: requiredText(item.projectId, 'Agent项目ID'),
    status: item.status as AtlasAgentRun['status'],
    instruction: typeof item.instruction === 'string' ? item.instruction : '',
    baseRevision: requiredNumber(item.baseRevision, 'Agent基础版本'),
    catalogVersion: requiredText(item.catalogVersion, 'Agent目录版本'),
    catalogDigest: requiredText(item.catalogDigest, 'Agent目录摘要'),
    plan: item.plan ? parseAgentPlan(item.plan) : undefined,
    errorCode: typeof item.errorCode === 'string' ? item.errorCode : undefined,
    createdAt: requiredNumber(item.createdAt, 'Agent创建时间'),
    updatedAt: requiredNumber(item.updatedAt, 'Agent更新时间'),
    completedAt: typeof item.completedAt === 'number' ? item.completedAt : undefined,
  };
}

export const atlasApi = {
  bootstrap: async () => parseBootstrap(await requestUnknown('/api/atlas/bootstrap')),
  listProjects: async () => {
    const root = record(await requestUnknown('/api/atlas/projects'), '项目列表');
    if (!Array.isArray(root.items)) throw new ApiError('项目列表格式无效', 502, 'ATLAS_RESPONSE_INVALID');
    return root.items.map(parseProject);
  },
  createProject: async (title: string) => parseProject(await requestUnknown('/api/atlas/projects', {
    method: 'POST', body: JSON.stringify({ title }),
  })),
  getProject: async (projectId: string) => parseProject(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}`)),
  renameProject: async (projectId: string, title: string, expectedRevision: number) => parseProject(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}`, {
    method: 'PUT', body: JSON.stringify({ title, expectedRevision }),
  })),
  deleteProject: (projectId: string) => requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).then(() => undefined),
  acquireLease: async (projectId: string, deviceId: string, takeover = false) => parseLease(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/lease`, {
    method: 'POST', body: JSON.stringify({ deviceId, takeover }),
  })),
  renewLease: async (projectId: string, token: string) => parseLease(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/lease`, {
    method: 'PUT', body: JSON.stringify({ token }),
  }), token),
  releaseLease: (projectId: string, token: string) => requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/lease`, {
    method: 'DELETE', body: JSON.stringify({ token }),
  }).then(() => undefined),
  loadCheckpoint,
  saveCheckpoint,
  listProjectAssets: async (projectId: string) => {
    const root = record(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/assets`), '项目素材列表');
    if (!Array.isArray(root.items)) throw new ApiError('项目素材列表格式无效', 502, 'ATLAS_RESPONSE_INVALID');
    return root.items.map(parseAsset);
  },
  importAsset: async (projectId: string, asset: FireflyLibraryAsset) => parseAsset(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/assets/import`, {
    method: 'POST', body: JSON.stringify({ sourceType: asset.sourceType, sourceId: asset.id }),
  })),
  listLibrary: loadFireflyLibrary,
  createAgentRun: async (projectId: string, instruction: string, document: AtlasDocument, idempotencyKey: string) => parseAgentRun(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/agent/runs`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey, instruction, baseRevision: document.revision, snapshot: createAgentSnapshot(document) }),
  })),
  getAgentRun: async (projectId: string, runId: string) => parseAgentRun(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(runId)}`)),
  confirmAgentRun: async (projectId: string, runId: string, approved: boolean, leaseToken: string) => parseAgentRun(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(runId)}/confirm`, {
    method: 'POST', body: JSON.stringify({ approved, leaseToken }),
  })),
  reportAgentResult: (projectId: string, runId: string, input: AtlasAgentOperationResult, leaseToken: string) => requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(runId)}/operation-results`, {
    method: 'POST', body: JSON.stringify({ ...input, leaseToken }),
  }),
  cancelAgentRun: async (projectId: string, runId: string) => parseAgentRun(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/agent/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST', body: '{}',
  })),
  createExportTransfer: async (projectId: string, idempotencyKey: string) => parseUploadSession(await idempotentRequestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/uploads`, {
    method: 'POST', body: JSON.stringify({ idempotencyKey, name: 'result.mp4', contentType: 'video/mp4', kind: 'video', purpose: 'export', size: null }),
  })),
  signExportParts: async (projectId: string, uploadId: string, partNumbers: number[]) => parsePartSigning(await idempotentRequestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(uploadId)}/parts/sign`, {
    method: 'POST', body: JSON.stringify({ partNumbers }),
  })),
  completeExportTransfer: async (projectId: string, uploadId: string, parts: CompletedPart[], totalSize: number) => parseAsset(await idempotentRequestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: 'POST', body: JSON.stringify({ parts, totalSize, purpose: 'export' }),
  }, 4, ATLAS_COMPLETE_TIMEOUT_MS)),
  cancelExportTransfer: (projectId: string, uploadId: string) => requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }).then(() => undefined),
};

export function redirectToFeishu(): void {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/auth/feishu/start?returnTo=${encodeURIComponent(returnTo)}`);
}

function parseLease(value: unknown, existingToken?: string): Lease {
  const item = record(value, '编辑租约');
  return {
    token: typeof item.token === 'string' ? item.token : existingToken ?? '',
    deviceId: requiredText(item.deviceId, '租约设备'),
    expiresAt: requiredNumber(item.expiresAt, '租约到期时间'),
  };
}

export interface FireflyLibraryResult {
  items: FireflyLibraryAsset[];
  partial: boolean;
}

async function loadFireflyLibrary(): Promise<FireflyLibraryResult> {
  const [assetsResult, generationsResult] = await Promise.allSettled([
    requestUnknown('/api/assets?page=1&pageSize=100'),
    requestUnknown('/api/generations'),
  ]);
  if (assetsResult.status === 'rejected' && generationsResult.status === 'rejected') {
    throw assetsResult.reason instanceof Error ? assetsResult.reason : generationsResult.reason;
  }
  const assetsRoot = assetsResult.status === 'fulfilled' ? assetsResult.value : undefined;
  const assetsRecord = assetsRoot && typeof assetsRoot === 'object' && !Array.isArray(assetsRoot) ? assetsRoot as Record<string, unknown> : {};
  const assetItems = Array.isArray(assetsRecord.Items) ? assetsRecord.Items : Array.isArray(assetsRecord.items) ? assetsRecord.items : [];
  const assets = assetItems.flatMap((raw): FireflyLibraryAsset[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    const id = item.Id ?? item.id;
    const kind = normalizeKind(item.AssetType ?? item.type);
    if (typeof id !== 'string' || !kind) return [];
    return [{
      id, name: String(item.Name ?? item.name ?? '未命名素材'), kind,
      previewUrl: typeof item.URL === 'string' ? item.URL : `/api/assets/${encodeURIComponent(id)}/source${kind === 'image' ? '?variant=thumbnail' : ''}`,
      size: typeof item.Size === 'number' ? item.Size : undefined,
      duration: typeof item.Duration === 'number' ? item.Duration : undefined,
      sourceType: 'user_asset',
    }];
  });
  const generationRoot = generationsResult.status === 'fulfilled' ? generationsResult.value : [];
  const generationItems = Array.isArray(generationRoot)
    ? generationRoot
    : generationRoot && typeof generationRoot === 'object' && Array.isArray((generationRoot as Record<string, unknown>).items)
      ? (generationRoot as Record<string, unknown>).items as unknown[] : [];
  const generations = generationItems.flatMap((raw): FireflyLibraryAsset[] => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== 'string' || item.status !== 'succeeded') return [];
    return [{
      id: item.id, name: String(item.title ?? item.promptSummary ?? `视频 ${item.id.slice(0, 6)}`), kind: 'video',
      previewUrl: typeof item.videoUrl === 'string' ? item.videoUrl : `/api/generations/${encodeURIComponent(item.id)}/media`,
      posterUrl: typeof item.posterUrl === 'string' ? item.posterUrl : undefined,
      sourceType: 'generation',
    }];
  });
  return {
    items: [...assets, ...generations],
    partial: assetsResult.status === 'rejected' || generationsResult.status === 'rejected',
  };
}

export function createAgentSnapshot(document: AtlasDocument) {
  const clipIdsByTrack = new Map(document.tracks.map((track) => [track.id, document.clips.filter((clip) => clip.trackId === track.id).map((clip) => clip.id)]));
  return {
    version: 1,
    revision: document.revision,
    durationMs: Math.round(document.clips.reduce((maximum, clip) => Math.max(maximum, clip.startTime + clip.duration), 0) * 1000),
    tracks: document.tracks.slice(0, 128).map(({ id, kind, muted, locked }) => ({ id, kind, muted, locked, clipIds: clipIdsByTrack.get(id) ?? [] })),
    clips: document.clips.slice(0, 2_000).map((clip) => ({
      id: clip.id, trackId: clip.trackId, assetId: clip.assetId, kind: document.assets.find((asset) => asset.id === clip.assetId)?.kind ?? 'video',
      startMs: Math.round(clip.startTime * 1000), durationMs: Math.round(clip.duration * 1000),
      sourceInMs: Math.round(clip.inPoint * 1000), sourceOutMs: Math.round(clip.outPoint * 1000),
      volume: clip.volume, muted: clip.muted,
      transform: { positionX: clip.transform.x, positionY: clip.transform.y, scaleX: clip.transform.scaleX, scaleY: clip.transform.scaleY, rotationDeg: clip.transform.rotation, opacity: clip.transform.opacity },
    })),
    assets: document.assets.slice(0, 500).map(({ id, name, kind, duration, width, height }) => ({
      id, name: name.slice(0, 300), kind, durationMs: Math.round(duration * 1000), width, height,
    })),
    selection: { clipIds: [], trackIds: [] },
  };
}

/**
 * Stable semantic identity for stale-plan detection. Cloud revision and local
 * timestamps are deliberately excluded: a checkpoint may complete while the
 * provider is planning without changing the timeline the user authorized.
 */
export async function agentSemanticFingerprint(document: AtlasDocument): Promise<string> {
  const { revision: _revision, ...semantic } = createAgentSnapshot(document);
  const bytes = new TextEncoder().encode(JSON.stringify(semantic));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function gzipDocument(document: AtlasDocument): Promise<{ blob: Blob; digest: string }> {
  if (typeof CompressionStream === 'undefined') throw new ApiError('当前浏览器不支持项目压缩，请使用最新版 Chrome 或 Edge', 400, 'ATLAS_COMPRESSION_UNSUPPORTED');
  const source = new TextEncoder().encode(JSON.stringify(stripRuntimeUrls(document)));
  const stream = new Response(source).body;
  if (!stream) throw new ApiError('无法创建项目数据流', 500, 'ATLAS_COMPRESSION_FAILED');
  const compressed = await new Response(stream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const blob = new Blob([compressed], { type: 'application/gzip' });
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', compressed))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return { blob, digest };
}

async function saveCheckpoint(projectId: string, document: AtlasDocument, expectedRevision: number, leaseToken: string): Promise<{ revision: number }> {
  const checkpoint = await gzipDocument({ ...document, revision: expectedRevision });
  const start = record(await requestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/checkpoints`, {
    method: 'POST', body: JSON.stringify({ expectedRevision, leaseToken, digest: checkpoint.digest, size: checkpoint.blob.size }),
  }), '检查点上传');
  if (start.status === 'ready') return { revision: requiredNumber(start.revision, '检查点版本') };
  const checkpointId = requiredText(start.checkpointId, '检查点ID');
  const transfer = record(start.transfer, '检查点传输');
  const partSize = requiredNumber(transfer.partSize, '检查点分片大小');
  const signed = Array.isArray(start.parts) ? start.parts.map(parseSignedPart) : [];
  const completed = new Map<number, CompletedPart>(Array.isArray(start.completedParts) ? start.completedParts.map(parseCompletedPart).map((part) => [part.partNumber, part]) : []);
  for (const part of signed) {
    const offset = (part.partNumber - 1) * partSize;
    const response = await retrySignedPut(part.url, checkpoint.blob.slice(offset, Math.min(checkpoint.blob.size, offset + partSize)));
    completed.set(part.partNumber, { partNumber: part.partNumber, etag: requireEtag(response) });
  }
  const result = record(await idempotentRequestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/checkpoints/${encodeURIComponent(checkpointId)}/complete`, {
    method: 'POST', body: JSON.stringify({ leaseToken, parts: [...completed.values()].sort((a, b) => a.partNumber - b.partNumber) }),
  }, 4, ATLAS_COMPLETE_TIMEOUT_MS), '检查点完成响应');
  return { revision: requiredNumber(result.revision, '检查点版本') };
}

async function loadCheckpoint(projectId: string): Promise<AtlasDocument> {
  const response = await fetch(`/api/atlas/projects/${encodeURIComponent(projectId)}/checkpoint`, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try { body = record(await response.json()); } catch { /* use status fallback */ }
    throw new ApiError(typeof body.error === 'string' ? body.error : `读取云端检查点失败（${response.status}）`, response.status, typeof body.code === 'string' ? body.code : undefined);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  let jsonBytes = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new ApiError('当前浏览器不支持恢复云端项目', 400, 'ATLAS_DECOMPRESSION_UNSUPPORTED');
    const stream = new Response(bytes).body;
    if (!stream) throw new ApiError('无法读取云端项目数据流', 500, 'ATLAS_DECOMPRESSION_FAILED');
    const decompressed = await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    jsonBytes = new Uint8Array(decompressed);
  }
  try { return parseDocument(JSON.parse(new TextDecoder().decode(jsonBytes)), projectId); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('云端项目数据损坏，已保留本地草稿', 502, 'ATLAS_CHECKPOINT_INVALID');
  }
}

export function parseDocument(value: unknown, expectedProjectId?: string): AtlasDocument {
  const item = record(value, '项目文档');
  if (item.version !== 1) throw new ApiError('项目文档版本不受支持', 502, 'ATLAS_CHECKPOINT_INVALID');
  const projectId = requiredText(item.projectId, '文档项目ID');
  if (expectedProjectId && projectId !== expectedProjectId) throw new ApiError('项目文档归属不匹配', 502, 'ATLAS_CHECKPOINT_INVALID');
  if (!Array.isArray(item.assets) || !Array.isArray(item.tracks) || !Array.isArray(item.clips)) throw new ApiError('项目文档内容不完整', 502, 'ATLAS_CHECKPOINT_INVALID');
  const document = item as unknown as AtlasDocument;
  if (document.assets.length > 500 || document.tracks.length > 128 || document.clips.length > 2_000) throw new ApiError('项目文档超出安全边界', 502, 'ATLAS_CHECKPOINT_INVALID');
  return document;
}

interface SignedPart { partNumber: number; url: string }
interface CompletedPart { partNumber: number; etag: string }
interface Lease { token: string; deviceId: string; expiresAt: number }
interface UploadSession { uploadId: string; partSize: number; completedParts: CompletedPart[]; parts: SignedPart[] }

function parseUploadSession(value: unknown): UploadSession {
  const root = record(value, '上传会话');
  const transfer = root.transfer && typeof root.transfer === 'object' ? record(root.transfer, '上传传输') : root;
  return {
    uploadId: requiredText(root.uploadId ?? transfer.id, '上传ID'),
    partSize: requiredNumber(root.partSize ?? transfer.partSize, '上传分片大小'),
    completedParts: Array.isArray(root.completedParts) ? root.completedParts.map(parseCompletedPart) : [],
    parts: Array.isArray(root.parts) ? root.parts.map(parseSignedPart) : [],
  };
}
function parsePartSigning(value: unknown) {
  const root = record(value, '分片续签');
  return {
    completedParts: Array.isArray(root.completedParts) ? root.completedParts.map(parseCompletedPart) : [],
    parts: Array.isArray(root.parts) ? root.parts.map(parseSignedPart) : [],
  };
}

async function retrySignedPut(url: string, body: Blob | ArrayBuffer, signal?: AbortSignal): Promise<Response> {
  let response: Response | undefined;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      response = await fetch(url, { method: 'PUT', body, credentials: 'omit', signal });
      if (response.ok) return response;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
    if (attempt < 3) await abortableDelay(2 ** attempt * 1_000, signal);
  }
  if (!response && lastError) throw lastError;
  throw new ApiError(`上传分片失败（${response?.status ?? 'network'}）`, 502, 'ATLAS_UPLOAD_PART_FAILED');
}

function abortableDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('操作已取消', 'AbortError'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('操作已取消', 'AbortError'));
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
const requireEtag = (response: Response) => {
  const etag = response.headers.get('ETag')?.replaceAll('"', '');
  if (!etag) throw new ApiError('对象存储未返回ETag，请检查TOS CORS暴露头配置', 502, 'ATLAS_UPLOAD_ETAG_MISSING');
  return etag;
};

export async function uploadLocalAsset(
  projectId: string,
  file: File,
  kind: MediaKind,
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<AtlasAsset> {
  // The key is allocated once per user upload intent and reused by every
  // transport retry. A lost HTTP response must resolve to the same server-side
  // asset and Multipart session rather than leaking a second upload.
  const session = parseUploadSession(await idempotentRequestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/uploads`, {
    method: 'POST',
    body: JSON.stringify({ idempotencyKey, name: file.name, size: file.size, contentType: file.type || `${kind}/unknown`, kind, purpose: 'asset' }),
    signal,
  }));
  const partCount = Math.ceil(file.size / session.partSize);
  const urls = new Map(session.parts.map((part) => [part.partNumber, part.url]));
  const completed = new Map(session.completedParts.map((part) => [part.partNumber, part]));
  let uploaded = [...completed.keys()].reduce((sum, partNumber) => sum + Math.min(session.partSize, file.size - (partNumber - 1) * session.partSize), 0);
  for (let cursor = 1; cursor <= partCount; cursor += 3) {
    const numbers = Array.from({ length: Math.min(3, partCount - cursor + 1) }, (_, index) => cursor + index).filter((partNumber) => !completed.has(partNumber));
    const missing = numbers.filter((partNumber) => !urls.has(partNumber));
    if (missing.length) {
      const signed = parsePartSigning(await idempotentRequestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(session.uploadId)}/parts/sign`, {
        method: 'POST', body: JSON.stringify({ partNumbers: missing }), signal,
      }));
      signed.completedParts.forEach((part) => completed.set(part.partNumber, part));
      signed.parts.forEach((part) => urls.set(part.partNumber, part.url));
    }
    await Promise.all(numbers.filter((partNumber) => !completed.has(partNumber)).map(async (partNumber) => {
      const start = (partNumber - 1) * session.partSize;
      const body = file.slice(start, Math.min(file.size, start + session.partSize));
      const url = urls.get(partNumber);
      if (!url) throw new ApiError(`第${partNumber}个分片缺少上传地址`, 502, 'ATLAS_UPLOAD_SIGNATURE_MISSING');
      const response = await retrySignedPut(url, body, signal);
      completed.set(partNumber, { partNumber, etag: requireEtag(response) });
      uploaded += body.size;
      onProgress(Math.min(99, Math.round((uploaded / file.size) * 100)));
    }));
  }
  const result = parseAsset(await idempotentRequestUnknown(`/api/atlas/projects/${encodeURIComponent(projectId)}/uploads/${encodeURIComponent(session.uploadId)}/complete`, {
    method: 'POST', body: JSON.stringify({ parts: [...completed.values()].sort((a, b) => a.partNumber - b.partNumber), totalSize: file.size, purpose: 'asset' }), signal,
  }, 4, ATLAS_COMPLETE_TIMEOUT_MS));
  onProgress(100);
  return result;
}
