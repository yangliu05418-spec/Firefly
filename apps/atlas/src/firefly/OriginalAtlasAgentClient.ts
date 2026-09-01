export type AtlasAgentRisk = 'low' | 'medium' | 'destructive' | 'external';

export type AtlasAgentOperation = {
  sequence: number;
  tool: string;
  args: Record<string, unknown>;
  risk: AtlasAgentRisk;
  requiresConfirmation: boolean;
  operationKey: string;
  operationDigest: string;
};

export type AtlasAgentPlan = {
  version: 1 | 2;
  summary: string;
  catalogVersion: string;
  catalogDigest: string;
  baseRevision: number;
  operations: AtlasAgentOperation[];
  planDigest: string;
};

export type AtlasAgentRun = {
  id: string;
  projectId: string;
  status: 'queued' | 'planning' | 'awaiting_confirmation' | 'ready' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  baseRevision: number;
  plan?: AtlasAgentPlan;
  errorCode?: string;
};

export type AtlasAgentSemanticSnapshot = {
  version: 1 | 2;
  revision: number;
  durationMs: number;
  tracks: Array<{ id: string; kind: 'video' | 'audio'; muted: boolean; locked: boolean; clipIds: string[] }>;
  clips: Array<{
    id: string;
    trackId: string;
    assetId?: string;
    kind: 'video' | 'audio' | 'image' | 'text';
    startMs: number;
    durationMs: number;
    sourceInMs?: number;
    sourceOutMs?: number;
    volume?: number;
    muted?: boolean;
    transform?: { positionX?: number; positionY?: number; scaleX?: number; scaleY?: number; rotationDeg?: number; opacity?: number };
    features?: { effects: number; keyframes: number; masks: number; transcriptWords: number; hasText: boolean; hasCaptions: boolean; hasStoryboard: boolean; textPreview?: string; analysisStatus?: string };
  }>;
  assets: Array<{ id: string; kind: 'video' | 'audio' | 'image'; name: string; durationMs?: number; width?: number; height?: number }>;
  selection: { clipIds: string[]; trackIds: string[] };
  markers?: Array<{ id: string; timeMs: number; label: string }>;
};

export class OriginalAtlasAgentApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'OriginalAtlasAgentApiError';
    this.status = status;
    this.code = code;
  }
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new OriginalAtlasAgentApiError('Atlas Agent 返回了无效响应', 502, 'AGENT_RESPONSE_INVALID');
  }
  return value as Record<string, unknown>;
};

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  let payload: unknown;
  try { payload = response.status === 204 ? undefined : await response.json(); }
  catch { payload = undefined; }
  if (!response.ok) {
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown> : {};
    throw new OriginalAtlasAgentApiError(
      typeof body.error === 'string' ? body.error : `Atlas Agent 请求失败（${response.status}）`,
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
    );
  }
  return payload;
}

const parsePlan = (value: unknown): AtlasAgentPlan => {
  const item = record(value);
  if (item.version !== 1 || !Array.isArray(item.operations) || item.operations.length < 1 || item.operations.length > 32) {
    throw new OriginalAtlasAgentApiError('Atlas Agent 计划格式无效', 502, 'AGENT_PLAN_INVALID');
  }
  const operations = item.operations.map((raw, index): AtlasAgentOperation => {
    const operation = record(raw);
    const args = record(operation.args);
    if (operation.sequence !== index + 1 || typeof operation.tool !== 'string'
      || !['low', 'medium', 'destructive', 'external'].includes(String(operation.risk))
      || typeof operation.operationKey !== 'string' || typeof operation.operationDigest !== 'string') {
      throw new OriginalAtlasAgentApiError('Atlas Agent 操作格式无效', 502, 'AGENT_PLAN_INVALID');
    }
    return {
      sequence: operation.sequence,
      tool: operation.tool,
      args,
      risk: operation.risk as AtlasAgentRisk,
      requiresConfirmation: operation.requiresConfirmation === true,
      operationKey: operation.operationKey,
      operationDigest: operation.operationDigest,
    };
  });
  if (typeof item.summary !== 'string' || typeof item.catalogVersion !== 'string'
    || typeof item.catalogDigest !== 'string' || typeof item.planDigest !== 'string'
    || !Number.isSafeInteger(item.baseRevision)) {
    throw new OriginalAtlasAgentApiError('Atlas Agent 计划字段不完整', 502, 'AGENT_PLAN_INVALID');
  }
  return {
    version: 1,
    summary: item.summary,
    catalogVersion: item.catalogVersion,
    catalogDigest: item.catalogDigest,
    baseRevision: item.baseRevision as number,
    operations,
    planDigest: item.planDigest,
  };
};

const parseRun = (value: unknown): AtlasAgentRun => {
  const item = record(value);
  const allowed = ['queued', 'planning', 'awaiting_confirmation', 'ready', 'running', 'succeeded', 'failed', 'cancelled'];
  if (typeof item.id !== 'string' || typeof item.projectId !== 'string'
    || !allowed.includes(String(item.status)) || !Number.isSafeInteger(item.baseRevision)) {
    throw new OriginalAtlasAgentApiError('Atlas Agent 任务格式无效', 502, 'AGENT_RESPONSE_INVALID');
  }
  return {
    id: item.id,
    projectId: item.projectId,
    status: item.status as AtlasAgentRun['status'],
    baseRevision: item.baseRevision as number,
    plan: item.plan ? parsePlan(item.plan) : undefined,
    errorCode: typeof item.errorCode === 'string' ? item.errorCode : undefined,
  };
};

const projectPath = (projectId: string) => `/api/atlas/projects/${encodeURIComponent(projectId)}/agent`;

export const originalAtlasAgentApi = {
  createRun: async (projectId: string, input: { instruction: string; baseRevision: number; snapshot: AtlasAgentSemanticSnapshot; idempotencyKey: string }) =>
    parseRun(await request(`${projectPath(projectId)}/runs`, { method: 'POST', body: JSON.stringify(input) })),
  readRun: async (projectId: string, runId: string) =>
    parseRun(await request(`${projectPath(projectId)}/runs/${encodeURIComponent(runId)}`)),
  eventsUrl: (projectId: string, runId: string) => `${projectPath(projectId)}/runs/${encodeURIComponent(runId)}/events`,
  confirmRun: async (projectId: string, runId: string, approved: boolean, leaseToken: string) =>
    parseRun(await request(`${projectPath(projectId)}/runs/${encodeURIComponent(runId)}/confirm`, {
      method: 'POST', body: JSON.stringify({ approved, leaseToken }),
    })),
  reportResult: (projectId: string, runId: string, body: Record<string, unknown>) =>
    request(`${projectPath(projectId)}/runs/${encodeURIComponent(runId)}/operation-results`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  reportExecutionResults: (projectId: string, runId: string, body: Record<string, unknown>) =>
    request(`${projectPath(projectId)}/runs/${encodeURIComponent(runId)}/execution-results`, {
      method: 'POST', body: JSON.stringify(body),
    }),
  cancelRun: (projectId: string, runId: string) =>
    request(`${projectPath(projectId)}/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST', body: '{}' }),
};
