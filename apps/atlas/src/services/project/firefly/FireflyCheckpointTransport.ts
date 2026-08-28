import type { ProjectFile } from '../types/project.types';
import { migrateLegacyAtlasDocument } from './LegacyAtlasDocumentMigration';

const CHECKPOINT_KIND = 'firefly-atlas-project-file';
const CHECKPOINT_VERSION = 1;
const COMPLETE_TIMEOUT_MS = 210_000;

export interface FireflyProjectCheckpointEnvelope {
  kind: typeof CHECKPOINT_KIND;
  version: typeof CHECKPOINT_VERSION;
  projectId: string;
  savedAt: string;
  projectFile: ProjectFile;
}

export interface FireflyCheckpointSaveInput {
  projectId: string;
  leaseToken: string;
  expectedRevision: number;
  projectFile: ProjectFile;
}

export interface FireflyCheckpointTransportPort {
  load(projectId: string): Promise<ProjectFile>;
  save(input: FireflyCheckpointSaveInput): Promise<number>;
  rename(projectId: string, title: string, expectedRevision: number): Promise<number>;
}

export class FireflyCheckpointError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'FireflyCheckpointError';
    this.status = status;
    this.code = code;
  }
}

interface SignedPart {
  partNumber: number;
  url: string;
}

interface CompletedPart {
  partNumber: number;
  etag: string;
}

interface EncodedCheckpoint {
  blob: Blob;
  digest: string;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  return Uint8Array.from(bytes).buffer;
}

interface FireflyCheckpointTransportDependencies {
  fetch?: typeof fetch;
  now?: () => Date;
  encode?: (envelope: FireflyProjectCheckpointEnvelope) => Promise<EncodedCheckpoint>;
  decode?: (bytes: Uint8Array) => Promise<unknown>;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FireflyCheckpointError(`${label}格式无效`, 502, 'ATLAS_CHECKPOINT_INVALID');
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new FireflyCheckpointError(`${label}缺失`, 502, 'ATLAS_CHECKPOINT_INVALID');
  }
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new FireflyCheckpointError(`${label}无效`, 502, 'ATLAS_CHECKPOINT_INVALID');
  }
  return value;
}

function cloneProjectFile(projectFile: ProjectFile): ProjectFile {
  return structuredClone(projectFile);
}

export function createCheckpointEnvelope(
  projectId: string,
  projectFile: ProjectFile,
  savedAt: Date = new Date(),
): FireflyProjectCheckpointEnvelope {
  return {
    kind: CHECKPOINT_KIND,
    version: CHECKPOINT_VERSION,
    projectId,
    savedAt: savedAt.toISOString(),
    projectFile: cloneProjectFile(projectFile),
  };
}

export function parseCheckpointEnvelope(value: unknown, expectedProjectId: string): ProjectFile {
  const envelope = asRecord(value, '项目检查点');
  const migrated = migrateLegacyAtlasDocument(value, expectedProjectId);
  if (migrated) return migrated;
  if (envelope.kind !== CHECKPOINT_KIND || envelope.version !== CHECKPOINT_VERSION) {
    throw new FireflyCheckpointError('项目检查点版本不受支持', 502, 'ATLAS_CHECKPOINT_INVALID');
  }
  if (requiredString(envelope.projectId, '检查点项目ID') !== expectedProjectId) {
    throw new FireflyCheckpointError('项目检查点归属不匹配', 502, 'ATLAS_CHECKPOINT_INVALID');
  }
  const projectFile = asRecord(envelope.projectFile, 'ProjectFile');
  if (projectFile.version !== 1
    || !Array.isArray(projectFile.media)
    || !Array.isArray(projectFile.compositions)
    || !Array.isArray(projectFile.folders)) {
    throw new FireflyCheckpointError('ProjectFile内容不完整', 502, 'ATLAS_CHECKPOINT_INVALID');
  }
  return cloneProjectFile(projectFile as unknown as ProjectFile);
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function encodeCheckpoint(envelope: FireflyProjectCheckpointEnvelope): Promise<EncodedCheckpoint> {
  if (typeof CompressionStream === 'undefined') {
    throw new FireflyCheckpointError(
      '当前浏览器不支持项目压缩，请使用最新版 Chrome 或 Edge',
      400,
      'ATLAS_COMPRESSION_UNSUPPORTED',
    );
  }
  const source = new TextEncoder().encode(JSON.stringify(envelope));
  const sourceStream = new Blob([exactArrayBuffer(source)]).stream();
  const compressed = await new Response(sourceStream.pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  return {
    blob: new Blob([compressed], { type: 'application/gzip' }),
    digest: await sha256(compressed),
  };
}

async function decodeCheckpoint(bytes: Uint8Array): Promise<unknown> {
  let jsonBytes = bytes;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') {
      throw new FireflyCheckpointError(
        '当前浏览器不支持恢复云端项目，请使用最新版 Chrome 或 Edge',
        400,
        'ATLAS_DECOMPRESSION_UNSUPPORTED',
      );
    }
    const decompressed = await new Response(
      new Blob([exactArrayBuffer(bytes)]).stream().pipeThrough(new DecompressionStream('gzip')),
    ).arrayBuffer();
    jsonBytes = new Uint8Array(decompressed);
  }
  try {
    return JSON.parse(new TextDecoder().decode(jsonBytes)) as unknown;
  } catch {
    throw new FireflyCheckpointError('云端项目数据损坏', 502, 'ATLAS_CHECKPOINT_INVALID');
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = response.status === 204 ? '' : await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) as unknown : undefined;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    throw new FireflyCheckpointError(
      typeof body.error === 'string' ? body.error : `项目检查点请求失败（${response.status}）`,
      response.status,
      typeof body.code === 'string' ? body.code : undefined,
    );
  }
  return payload;
}

function parseSignedParts(value: unknown): SignedPart[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const part = asRecord(entry, '检查点分片');
    return {
      partNumber: requiredNumber(part.partNumber, '分片编号'),
      url: requiredString(part.url, '分片上传地址'),
    };
  });
}

function parseCompletedParts(value: unknown): CompletedPart[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const part = asRecord(entry, '已完成分片');
    return {
      partNumber: requiredNumber(part.partNumber, '分片编号'),
      etag: requiredString(part.etag, '分片ETag'),
    };
  });
}

function responseEtag(response: Response): string {
  const etag = response.headers.get('etag')?.replace(/^"|"$/g, '');
  if (!etag) {
    throw new FireflyCheckpointError('TOS未返回分片ETag', 502, 'ATLAS_UPLOAD_ETAG_MISSING');
  }
  return etag;
}

export class FireflyCheckpointTransport implements FireflyCheckpointTransportPort {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly encodeImpl: (envelope: FireflyProjectCheckpointEnvelope) => Promise<EncodedCheckpoint>;
  private readonly decodeImpl: (bytes: Uint8Array) => Promise<unknown>;

  constructor(dependencies: FireflyCheckpointTransportDependencies = {}) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch.bind(globalThis);
    this.now = dependencies.now ?? (() => new Date());
    this.encodeImpl = dependencies.encode ?? encodeCheckpoint;
    this.decodeImpl = dependencies.decode ?? decodeCheckpoint;
  }

  async load(projectId: string): Promise<ProjectFile> {
    const response = await this.fetchImpl(
      `/api/atlas/projects/${encodeURIComponent(projectId)}/checkpoint`,
      { credentials: 'same-origin', cache: 'no-store' },
    );
    if (!response.ok) await parseResponse(response);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return parseCheckpointEnvelope(await this.decodeImpl(bytes), projectId);
  }

  async save(input: FireflyCheckpointSaveInput): Promise<number> {
    const envelope = createCheckpointEnvelope(input.projectId, input.projectFile, this.now());
    const checkpoint = await this.encodeImpl(envelope);
    const startResponse = await this.fetchImpl(
      `/api/atlas/projects/${encodeURIComponent(input.projectId)}/checkpoints`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expectedRevision: input.expectedRevision,
          leaseToken: input.leaseToken,
          digest: checkpoint.digest,
          size: checkpoint.blob.size,
        }),
      },
    );
    const start = asRecord(await parseResponse(startResponse), '检查点上传响应');
    if (start.status === 'ready') return requiredNumber(start.revision, '检查点版本');

    const checkpointId = requiredString(start.checkpointId, '检查点ID');
    const transfer = asRecord(start.transfer, '检查点传输');
    const partSize = requiredNumber(transfer.partSize, '检查点分片大小');
    const completed = new Map<number, CompletedPart>(
      parseCompletedParts(start.completedParts).map((part) => [part.partNumber, part]),
    );

    for (const part of parseSignedParts(start.parts)) {
      const offset = (part.partNumber - 1) * partSize;
      const body = checkpoint.blob.slice(offset, Math.min(checkpoint.blob.size, offset + partSize));
      const response = await this.fetchImpl(part.url, { method: 'PUT', body });
      if (!response.ok) {
        throw new FireflyCheckpointError(
          `项目检查点分片上传失败（${response.status}）`,
          response.status,
          'ATLAS_CHECKPOINT_UPLOAD_FAILED',
        );
      }
      completed.set(part.partNumber, { partNumber: part.partNumber, etag: responseEtag(response) });
    }

    const timeout = new AbortController();
    const timeoutId = globalThis.setTimeout(() => timeout.abort(), COMPLETE_TIMEOUT_MS);
    try {
      const completeResponse = await this.fetchImpl(
        `/api/atlas/projects/${encodeURIComponent(input.projectId)}/checkpoints/${encodeURIComponent(checkpointId)}/complete`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          signal: timeout.signal,
          body: JSON.stringify({
            leaseToken: input.leaseToken,
            parts: [...completed.values()].sort((left, right) => left.partNumber - right.partNumber),
          }),
        },
      );
      const result = asRecord(await parseResponse(completeResponse), '检查点完成响应');
      return requiredNumber(result.revision, '检查点版本');
    } catch (error) {
      if (timeout.signal.aborted) {
        throw new FireflyCheckpointError('项目云端检查点确认超时', 504, 'ATLAS_NETWORK_TIMEOUT');
      }
      throw error;
    } finally {
      globalThis.clearTimeout(timeoutId);
    }
  }

  async rename(projectId: string, title: string, expectedRevision: number): Promise<number> {
    const response = await this.fetchImpl(
      `/api/atlas/projects/${encodeURIComponent(projectId)}`,
      {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, expectedRevision }),
      },
    );
    const result = asRecord(await parseResponse(response), '项目重命名响应');
    return requiredNumber(result.revision, '项目版本');
  }
}
