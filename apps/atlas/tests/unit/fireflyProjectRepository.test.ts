import { describe, expect, it, vi } from 'vitest';
import { FileStorageService } from '../../src/services/project/core/FileStorageService';
import { FireflyProjectCoreService } from '../../src/services/project/core/FireflyProjectCoreService';
import { createInitialProjectFile } from '../../src/services/project/core/createInitialProjectFile';
import {
  createCheckpointEnvelope,
  FireflyCheckpointTransport,
  parseCheckpointEnvelope,
  type FireflyCheckpointSaveInput,
  type FireflyCheckpointTransportPort,
} from '../../src/services/project/firefly/FireflyCheckpointTransport';
import {
  FireflyLocalCloudConflictError,
  FireflyProjectRepository,
} from '../../src/services/project/firefly/FireflyProjectRepository';
import type { ProjectFile } from '../../src/services/project/types';

class MemoryFileHandle {
  readonly kind = 'file' as const;
  content = '';

  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    return {
      name: this.name,
      text: async () => this.content,
    } as File;
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    let next = '';
    return {
      write: async (value: FileSystemWriteChunkType) => {
        if (typeof value === 'string') next = value;
        else if (value instanceof Blob) next = await value.text();
        else throw new Error('Unsupported memory write');
      },
      close: async () => { this.content = next; },
    } as FileSystemWritableFileStream;
  }
}

class MemoryDirectoryHandle {
  readonly kind = 'directory' as const;
  readonly directories = new Map<string, MemoryDirectoryHandle>();
  readonly files = new Map<string, MemoryFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options?: FileSystemGetDirectoryOptions): Promise<FileSystemDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) return existing as unknown as FileSystemDirectoryHandle;
    if (!options?.create) throw new DOMException('Missing directory', 'NotFoundError');
    const directory = new MemoryDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory as unknown as FileSystemDirectoryHandle;
  }

  async getFileHandle(name: string, options?: FileSystemGetFileOptions): Promise<FileSystemFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing as unknown as FileSystemFileHandle;
    if (!options?.create) throw new DOMException('Missing file', 'NotFoundError');
    const file = new MemoryFileHandle(name);
    this.files.set(name, file);
    return file as unknown as FileSystemFileHandle;
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
    this.directories.delete(name);
  }

  async *values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle> {
    for (const directory of this.directories.values()) yield directory as unknown as FileSystemDirectoryHandle;
    for (const file of this.files.values()) yield file as unknown as FileSystemFileHandle;
  }
}

class FakeCheckpointTransport implements FireflyCheckpointTransportPort {
  readonly saveInputs: FireflyCheckpointSaveInput[] = [];
  readonly renameInputs: Array<{ projectId: string; title: string; expectedRevision: number }> = [];
  loadResult = createInitialProjectFile('云端项目', () => new Date('2026-08-28T00:00:00.000Z'));
  saveImpl: (input: FireflyCheckpointSaveInput) => Promise<number> = async (input) => input.expectedRevision + 1;
  renameImpl: (expectedRevision: number) => Promise<number> = async (expectedRevision) => expectedRevision + 1;

  async load(): Promise<ProjectFile> {
    return structuredClone(this.loadResult);
  }

  async save(input: FireflyCheckpointSaveInput): Promise<number> {
    this.saveInputs.push(structuredClone(input));
    return this.saveImpl(input);
  }

  async rename(projectId: string, title: string, expectedRevision: number): Promise<number> {
    this.renameInputs.push({ projectId, title, expectedRevision });
    return this.renameImpl(expectedRevision);
  }
}

const openOptions = {
  userId: 'user-a',
  projectId: 'project-a',
  title: 'Firefly 项目',
  cloudRevision: 0,
  leaseToken: 'lease-token',
} as const;

function createRepository(root: MemoryDirectoryHandle, transport: FakeCheckpointTransport) {
  return new FireflyProjectRepository({
    getRootDirectory: async () => root as unknown as FileSystemDirectoryHandle,
    checkpointTransport: transport,
    now: () => new Date('2026-08-28T00:00:00.000Z'),
  });
}

describe('Firefly ProjectFile persistence boundary', () => {
  it('round-trips the original ProjectFile envelope and rejects a different project', () => {
    const projectFile = createInitialProjectFile('原 Atlas 项目', () => new Date('2026-08-28T00:00:00.000Z'));
    const envelope = createCheckpointEnvelope('project-a', projectFile, new Date('2026-08-28T01:00:00.000Z'));
    expect(parseCheckpointEnvelope(envelope, 'project-a')).toEqual(projectFile);
    expect(() => parseCheckpointEnvelope(envelope, 'project-b')).toThrow('归属不匹配');
  });

  it('keeps local projects isolated by authenticated user and project namespaces', async () => {
    const root = new MemoryDirectoryHandle('root');
    const transport = new FakeCheckpointTransport();
    const first = createRepository(root, transport);
    const second = createRepository(root, transport);
    const a = await first.prepare(openOptions);
    const b = await second.prepare({ ...openOptions, userId: 'user-b' });

    expect(a.handle).not.toBe(b.handle);
    const users = root.directories.get('firefly-atlas')
      ?.directories.get('v1')
      ?.directories.get('users');
    expect([...users?.directories.keys() ?? []]).toEqual(expect.arrayContaining(['user-a', 'user-b']));
  });

  it('saves locally before starting a latest-wins serialized cloud checkpoint', async () => {
    const root = new MemoryDirectoryHandle('root');
    const transport = new FakeCheckpointTransport();
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let active = 0;
    let maximumActive = 0;
    transport.saveImpl = async (input) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (transport.saveInputs.length === 1) await firstPending;
      active -= 1;
      return input.expectedRevision + 1;
    };
    const repository = createRepository(root, transport);
    const core = new FireflyProjectCoreService(new FileStorageService(), repository);
    expect(await core.openProject(openOptions)).toBe(true);

    core.updateProjectData({ name: '第一次本地保存' });
    expect(await core.saveProject()).toBe(true);
    const localFile = await core.getProjectHandle()!.getFileHandle('project.json');
    expect(JSON.parse(await (await localFile.getFile()).text()).name).toBe('第一次本地保存');

    core.updateProjectData({ name: '第二次本地保存' });
    expect(await core.saveProject()).toBe(true);
    core.updateProjectData({ name: '最终本地保存' });
    expect(await core.saveProject()).toBe(true);
    releaseFirst();
    expect((await core.flushCloudSave()).status).toBe('saved');

    expect(maximumActive).toBe(1);
    expect(transport.saveInputs.map((input) => input.projectFile.name)).toEqual([
      '第一次本地保存',
      '最终本地保存',
    ]);
  });

  it('checkpoints the server title when opening a locally stale project name', async () => {
    const root = new MemoryDirectoryHandle('root');
    const transport = new FakeCheckpointTransport();
    const repository = createRepository(root, transport);
    const first = new FireflyProjectCoreService(new FileStorageService(), repository);
    expect(await first.openProject({ ...openOptions, title: '旧标题' })).toBe(true);
    first.closeProject();

    const reopened = new FireflyProjectCoreService(new FileStorageService(), createRepository(root, transport));
    expect(await reopened.openProject({ ...openOptions, title: '服务端新标题' })).toBe(true);
    expect((await reopened.flushCloudSave()).status).toBe('saved');
    expect(transport.saveInputs.at(-1)?.projectFile.name).toBe('服务端新标题');
  });

  it('retains one failed latest snapshot and succeeds after an explicit retry', async () => {
    const root = new MemoryDirectoryHandle('root');
    const transport = new FakeCheckpointTransport();
    let attempts = 0;
    transport.saveImpl = async (input) => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error('offline'), { code: 'ATLAS_NETWORK_ERROR' });
      return input.expectedRevision + 1;
    };
    const repository = createRepository(root, transport);
    await repository.prepare(openOptions);
    repository.enqueueCloudSave(createInitialProjectFile('离线草稿'));
    expect((await repository.flushCloudSave()).status).toBe('error');
    expect((await repository.retryCloudSave()).status).toBe('saved');
    expect(attempts).toBe(2);
  });

  it('bounds a stalled cloud checkpoint reservation instead of hanging navigation forever', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const transport = new FireflyCheckpointTransport({
      fetch: fetchMock as typeof fetch,
      encode: async () => ({ blob: new Blob(['checkpoint'], { type: 'application/gzip' }), digest: 'a'.repeat(64) }),
    });
    const pending = transport.save({
      projectId: 'project-a',
      leaseToken: 'l'.repeat(64),
      expectedRevision: 0,
      projectFile: createInitialProjectFile('超时保护'),
    });
    const rejection = expect(pending).rejects.toMatchObject({
      code: 'ATLAS_NETWORK_TIMEOUT',
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(15_001);
    await rejection;
    vi.useRealTimers();
  });

  it('advances the server revision on rename before the following checkpoint', async () => {
    const root = new MemoryDirectoryHandle('root');
    const transport = new FakeCheckpointTransport();
    transport.loadResult = createInitialProjectFile('Firefly 项目');
    const repository = createRepository(root, transport);
    const core = new FireflyProjectCoreService(new FileStorageService(), repository);
    expect(await core.openProject({ ...openOptions, cloudRevision: 4 })).toBe(true);
    expect(await core.renameProject('新项目名')).toBe(true);
    expect((await core.flushCloudSave()).revision).toBe(6);
    expect(transport.renameInputs[0]).toMatchObject({ expectedRevision: 4, title: '新项目名' });
    expect(transport.saveInputs.at(-1)?.expectedRevision).toBe(5);
  });

  it('fails closed on a newer cloud revision until recovery preference is explicit', async () => {
    const root = new MemoryDirectoryHandle('root');
    const transport = new FakeCheckpointTransport();
    const initial = createRepository(root, transport);
    await initial.prepare({ ...openOptions, cloudRevision: 1 });

    const reopened = createRepository(root, transport);
    await expect(reopened.prepare({ ...openOptions, cloudRevision: 2 }))
      .rejects.toBeInstanceOf(FireflyLocalCloudConflictError);
    const restored = await reopened.prepare({
      ...openOptions,
      cloudRevision: 2,
      recoveryPreference: 'prefer-cloud',
    });
    expect(restored.source).toBe('cloud');
    expect(restored.projectFile.name).toBe('云端项目');
  });

  it('migrates the retired lightweight checkpoint into the original ProjectFile shape', () => {
    const migrated = parseCheckpointEnvelope({
      version: 1,
      projectId: 'project-a',
      title: '旧版项目',
      revision: 3,
      updatedAt: '2026-08-28T00:00:00.000Z',
      playhead: 2,
      assets: [{ id: 'asset-1', name: '片段.mp4', kind: 'video', duration: 8, status: 'ready' }],
      tracks: [{ id: 'track-1', name: '画面 1', kind: 'video', muted: false, locked: false }],
      clips: [{
        id: 'clip-1', assetId: 'asset-1', trackId: 'track-1', name: '片段', startTime: 1,
        duration: 5, inPoint: 0, outPoint: 5, volume: 1, muted: false,
        transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
      }],
    }, 'project-a');

    expect(migrated.name).toBe('旧版项目');
    expect(migrated.media[0]).toMatchObject({ id: 'asset-1', type: 'video' });
    expect(migrated.compositions[0]?.clips[0]).toMatchObject({ id: 'clip-1', mediaId: 'asset-1' });
  });
});
