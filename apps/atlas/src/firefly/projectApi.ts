/**
 * Thin Firefly control-plane client for the embedded Atlas editor.
 *
 * This module intentionally knows nothing about Atlas' timeline, workspace or
 * serialized project format. It only owns the authenticated project boundary.
 */

export class FireflyProjectApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'FireflyProjectApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface FireflyAtlasUser {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface FireflyAtlasCapabilities {
  agent: boolean;
  maxUploadBytes: number;
  partSize: number;
  uploadConcurrency: number;
}

export interface FireflyAtlasBootstrap {
  user: FireflyAtlasUser;
  capabilities: FireflyAtlasCapabilities;
}

export interface FireflyAtlasProject {
  id: string;
  title: string;
  revision: number;
  hasCheckpoint: boolean;
  leaseDeviceId?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface FireflyProjectLease {
  token: string;
  deviceId: string;
  expiresAt: number;
}

export interface FireflyRequestOptions {
  signal?: AbortSignal;
  keepalive?: boolean;
}

export interface ListFireflyProjectsOptions extends FireflyRequestOptions {
  limit?: number;
  offset?: number;
}

export interface FireflyProjectApi {
  bootstrap(options?: FireflyRequestOptions): Promise<FireflyAtlasBootstrap>;
  listProjects(options?: ListFireflyProjectsOptions): Promise<FireflyAtlasProject[]>;
  createProject(title: string, options?: FireflyRequestOptions): Promise<FireflyAtlasProject>;
  getProject(projectId: string, options?: FireflyRequestOptions): Promise<FireflyAtlasProject>;
  renameProject(
    projectId: string,
    title: string,
    expectedRevision: number,
    options?: FireflyRequestOptions,
  ): Promise<FireflyAtlasProject>;
  deleteProject(projectId: string, options?: FireflyRequestOptions): Promise<void>;
  acquireLease(
    projectId: string,
    deviceId: string,
    takeover?: boolean,
    options?: FireflyRequestOptions,
  ): Promise<FireflyProjectLease>;
  renewLease(
    projectId: string,
    token: string,
    options?: FireflyRequestOptions,
  ): Promise<FireflyProjectLease>;
  releaseLease(
    projectId: string,
    token: string,
    options?: FireflyRequestOptions,
  ): Promise<void>;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const responseRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse(`${label}格式无效`);
  }
  return value as Record<string, unknown>;
};

const invalidResponse = (message: string) =>
  new FireflyProjectApiError(message, 502, 'ATLAS_RESPONSE_INVALID');

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw invalidResponse(`${label}缺失`);
  }
  return value;
};

const optionalString = (value: unknown, label: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw invalidResponse(`${label}无效`);
  return value;
};

const requiredBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== 'boolean') throw invalidResponse(`${label}无效`);
  return value;
};

const finiteNumber = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidResponse(`${label}无效`);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, label: string): number => {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number < 0) throw invalidResponse(`${label}无效`);
  return number;
};

const positiveInteger = (value: unknown, label: string): number => {
  const number = finiteNumber(value, label);
  if (!Number.isInteger(number) || number <= 0) throw invalidResponse(`${label}无效`);
  return number;
};

const timestamp = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw invalidResponse(`${label}无效`);
};

const optionalTimestamp = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null) return undefined;
  return timestamp(value, label);
};

export function parseFireflyBootstrap(value: unknown): FireflyAtlasBootstrap {
  const root = responseRecord(value, '启动信息');
  const user = responseRecord(root.user, '用户信息');
  const capabilities = responseRecord(root.capabilities, '能力信息');
  return {
    user: {
      id: requiredString(user.id, '用户ID'),
      name: typeof user.name === 'string' && user.name.trim() ? user.name : 'Firefly 用户',
      email: typeof user.email === 'string' ? user.email : '',
      avatarUrl: optionalString(user.avatarUrl, '用户头像'),
    },
    capabilities: {
      agent: requiredBoolean(capabilities.agent, 'Agent能力'),
      maxUploadBytes: positiveInteger(capabilities.maxUploadBytes, '上传上限'),
      partSize: positiveInteger(capabilities.partSize, '分片大小'),
      uploadConcurrency: positiveInteger(capabilities.uploadConcurrency, '上传并发数'),
    },
  };
}

export function parseFireflyProject(value: unknown): FireflyAtlasProject {
  const project = responseRecord(value, '项目信息');
  return {
    id: requiredString(project.id, '项目ID'),
    title: requiredString(project.title, '项目名称'),
    revision: nonNegativeInteger(project.revision, '项目版本'),
    hasCheckpoint: requiredBoolean(project.hasCheckpoint, '项目检查点状态'),
    leaseDeviceId: optionalString(project.leaseDeviceId, '租约设备'),
    leaseExpiresAt: optionalTimestamp(project.leaseExpiresAt, '租约到期时间'),
    createdAt: timestamp(project.createdAt, '创建时间'),
    updatedAt: timestamp(project.updatedAt, '更新时间'),
  };
}

export function parseFireflyLease(value: unknown, currentToken?: string): FireflyProjectLease {
  const lease = responseRecord(value, '编辑租约');
  const token = lease.token === undefined
    ? currentToken
    : requiredString(lease.token, '租约令牌');
  if (!token) throw invalidResponse('租约令牌缺失');
  return {
    token,
    deviceId: requiredString(lease.deviceId, '租约设备'),
    expiresAt: timestamp(lease.expiresAt, '租约到期时间'),
  };
}

const assertProjectId = (value: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FireflyProjectApiError('项目ID不能为空', 400, 'ATLAS_PROJECT_ID_INVALID');
  }
  return encodeURIComponent(value);
};

const assertTitle = (value: string): string => {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > 120) {
    throw new FireflyProjectApiError('项目名称应为1至120个字符', 400, 'ATLAS_PROJECT_TITLE_INVALID');
  }
  return title;
};

const assertDeviceId = (value: string): string => {
  const deviceId = typeof value === 'string' ? value.trim() : '';
  if (deviceId.length < 8 || deviceId.length > 200) {
    throw new FireflyProjectApiError('设备标识无效', 400, 'ATLAS_DEVICE_ID_INVALID');
  }
  return deviceId;
};

const assertToken = (value: string): string => {
  if (typeof value !== 'string' || value.length < 32 || value.length > 256) {
    throw new FireflyProjectApiError('编辑租约无效', 400, 'ATLAS_LEASE_TOKEN_INVALID');
  }
  return value;
};

const readPayload = async (response: Response): Promise<unknown> => {
  if (response.status === 204) return undefined;
  const body = await response.text();
  if (!body) return undefined;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
};

const errorFromResponse = (response: Response, payload: unknown): FireflyProjectApiError => {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
  return new FireflyProjectApiError(
    typeof body?.error === 'string' && body.error
      ? body.error
      : `请求失败（${response.status}）`,
    response.status,
    typeof body?.code === 'string' ? body.code : undefined,
    body,
  );
};

const request = async (
  fetcher: FetchLike,
  path: string,
  init: RequestInit = {},
): Promise<unknown> => {
  // Keep every authenticated control-plane request relative and same-origin.
  // TOS signed URLs intentionally live in a different media-only module.
  if (!path.startsWith('/api/atlas/') || path.startsWith('//') || path.includes('://')) {
    throw new FireflyProjectApiError('拒绝非同源Atlas请求', 400, 'ATLAS_ORIGIN_INVALID');
  }
  const response = await fetcher(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const payload = await readPayload(response);
  if (!response.ok) throw errorFromResponse(response, payload);
  return payload;
};

const jsonBody = (value: unknown) => JSON.stringify(value);

export function createFireflyProjectApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): FireflyProjectApi {
  return {
    bootstrap: async (options = {}) => parseFireflyBootstrap(await request(fetcher, '/api/atlas/bootstrap', {
      signal: options.signal,
    })),

    listProjects: async (options = {}) => {
      const limit = options.limit ?? 50;
      const offset = options.offset ?? 0;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100
        || !Number.isInteger(offset) || offset < 0 || offset > 100_000) {
        throw new FireflyProjectApiError('项目分页参数无效', 400, 'ATLAS_PAGINATION_INVALID');
      }
      const payload = await request(fetcher, `/api/atlas/projects?limit=${limit}&offset=${offset}`, {
        signal: options.signal,
      });
      const root = responseRecord(payload, '项目列表');
      if (!Array.isArray(root.items)) throw invalidResponse('项目列表格式无效');
      return root.items.map(parseFireflyProject);
    },

    createProject: async (title, options = {}) => parseFireflyProject(await request(fetcher, '/api/atlas/projects', {
      method: 'POST',
      body: jsonBody({ title: assertTitle(title) }),
      signal: options.signal,
    })),

    getProject: async (projectId, options = {}) => parseFireflyProject(await request(
      fetcher,
      `/api/atlas/projects/${assertProjectId(projectId)}`,
      { signal: options.signal },
    )),

    renameProject: async (projectId, title, expectedRevision, options = {}) => {
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
        throw new FireflyProjectApiError('项目版本无效', 400, 'ATLAS_REVISION_INVALID');
      }
      return parseFireflyProject(await request(fetcher, `/api/atlas/projects/${assertProjectId(projectId)}`, {
        method: 'PUT',
        body: jsonBody({ title: assertTitle(title), expectedRevision }),
        signal: options.signal,
      }));
    },

    deleteProject: async (projectId, options = {}) => {
      await request(fetcher, `/api/atlas/projects/${assertProjectId(projectId)}`, {
        method: 'DELETE',
        signal: options.signal,
        keepalive: options.keepalive,
      });
    },

    acquireLease: async (projectId, deviceId, takeover = false, options = {}) => parseFireflyLease(await request(
      fetcher,
      `/api/atlas/projects/${assertProjectId(projectId)}/lease`,
      {
        method: 'POST',
        body: jsonBody({ deviceId: assertDeviceId(deviceId), takeover }),
        signal: options.signal,
      },
    )),

    renewLease: async (projectId, token, options = {}) => {
      const currentToken = assertToken(token);
      return parseFireflyLease(await request(fetcher, `/api/atlas/projects/${assertProjectId(projectId)}/lease`, {
        method: 'PUT',
        body: jsonBody({ token: currentToken }),
        signal: options.signal,
      }), currentToken);
    },

    releaseLease: async (projectId, token, options = {}) => {
      await request(fetcher, `/api/atlas/projects/${assertProjectId(projectId)}/lease`, {
        method: 'DELETE',
        body: jsonBody({ token: assertToken(token) }),
        signal: options.signal,
        keepalive: options.keepalive,
      });
    },
  };
}

export const fireflyProjectApi = createFireflyProjectApi();
