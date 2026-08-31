import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore';
import { materializeFireflyRemoteMedia } from '../../src/services/project/firefly/FireflyRemoteMediaCache';

const localMediaMocks = vi.hoisted(() => ({
  materialize: vi.fn(),
}));

vi.mock('../../src/firefly/local-media', () => ({
  materializeAtlasLocalMedia: localMediaMocks.materialize,
}));

interface FakeFileRecord {
  bytes: Uint8Array;
  name: string;
}

function createFakeDirectory() {
  const directories = new Map<string, ReturnType<typeof createFakeDirectory>>();
  const files = new Map<string, FakeFileRecord>();
  const directory = {
    async getDirectoryHandle(name: string) {
      let child = directories.get(name);
      if (!child) {
        child = createFakeDirectory();
        directories.set(name, child);
      }
      return child.directory;
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      let record = files.get(name);
      if (!record && !options?.create) throw new DOMException('Missing', 'NotFoundError');
      if (!record) {
        record = { bytes: new Uint8Array(), name };
        files.set(name, record);
      }
      const current = record;
      return {
        async getFile() {
          return new File([current.bytes], current.name, { type: 'video/mp4' });
        },
        async createWritable() {
          const chunks: Uint8Array[] = [];
          return {
            async write(chunk: Uint8Array) { chunks.push(chunk); },
            async close() {
              const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
              const combined = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
              current.bytes = combined;
            },
            async abort() { chunks.length = 0; },
          };
        },
      };
    },
  };
  return { directory: directory as unknown as FileSystemDirectoryHandle, directories, files };
}

function remoteMedia(id: string): MediaFile {
  return {
    id: `media-${id}`,
    name: '成片.mp4',
    type: 'video',
    parentId: null,
    createdAt: Date.now(),
    url: `/api/atlas/project-assets/${id}/media`,
    remoteSourcePath: `/api/atlas/project-assets/${id}/media`,
    fireflyProjectAssetId: id,
    fileSize: 6,
  };
}

describe('Firefly remote media cache', () => {
  beforeEach(() => {
    localMediaMocks.materialize.mockReset();
    localMediaMocks.materialize.mockRejectedValue(new Error('Local media cache unavailable'));
  });

  it('streams the response into project OPFS without using Response.blob', async () => {
    const root = createFakeDirectory();
    const blobSpy = vi.spyOn(Response.prototype, 'blob');
    const progress: number[] = [];
    const fetcher = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    }), { status: 200, headers: { 'content-length': '6', 'content-type': 'video/mp4' } }));

    const result = await materializeFireflyRemoteMedia(remoteMedia('asset-stream'), {
      projectHandle: root.directory,
      fetcher: fetcher as typeof fetch,
      onProgress: (value) => progress.push(value),
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(blobSpy).not.toHaveBeenCalled();
    expect(result.file.size).toBe(6);
    expect(result.relativePath).toBe('Raw/FireflyGenerated/asset-stream/成片.mp4');
    expect(progress.at(-1)).toBe(100);
  });

  it('deduplicates concurrent materialization and reuses the verified OPFS file', async () => {
    const root = createFakeDirectory();
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), {
      status: 200,
      headers: { 'content-length': '6' },
    }));
    const media = remoteMedia('asset-dedupe');

    const [first, second] = await Promise.all([
      materializeFireflyRemoteMedia(media, { projectHandle: root.directory, fetcher: fetcher as typeof fetch }),
      materializeFireflyRemoteMedia(media, { projectHandle: root.directory, fetcher: fetcher as typeof fetch }),
    ]);
    const third = await materializeFireflyRemoteMedia(media, {
      projectHandle: root.directory,
      fetcher: fetcher as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first.file.size).toBe(6);
    expect(second.file.size).toBe(6);
    expect(third.file.size).toBe(6);
  });

  it('keeps concurrent revisions in separate flights and OPFS targets', async () => {
    const root = createFakeDirectory();
    const descriptor = (revision: string) => ({
      cacheKey: 'asset-revision-cache',
      revision,
      variant: 'preview' as const,
      mediaType: 'video' as const,
      contentType: 'video/mp4',
      size: 6,
      url: `/api/atlas/project-assets/asset-revision/media?revision=${revision}`,
      cachePolicy: 'pin' as const,
    });
    const revisionOne = {
      ...remoteMedia('asset-revision'),
      localMediaDescriptor: descriptor('v1'),
    };
    const revisionTwo = {
      ...remoteMedia('asset-revision'),
      localMediaDescriptor: descriptor('v2'),
    };
    const fetchRevisionOne = vi.fn(async () => new Response(
      new Uint8Array([1, 1, 1, 1, 1, 1]),
      { status: 200, headers: { 'content-length': '6' } },
    ));
    const fetchRevisionTwo = vi.fn(async () => new Response(
      new Uint8Array([2, 2, 2, 2, 2, 2]),
      { status: 200, headers: { 'content-length': '6' } },
    ));

    const [first, second] = await Promise.all([
      materializeFireflyRemoteMedia(revisionOne, {
        projectHandle: root.directory,
        fetcher: fetchRevisionOne as typeof fetch,
      }),
      materializeFireflyRemoteMedia(revisionTwo, {
        projectHandle: root.directory,
        fetcher: fetchRevisionTwo as typeof fetch,
      }),
    ]);

    expect(fetchRevisionOne).toHaveBeenCalledTimes(1);
    expect(fetchRevisionTwo).toHaveBeenCalledTimes(1);
    expect(first.relativePath).not.toBe(second.relativePath);
    expect(first.file.size).toBe(6);
    expect(second.file.size).toBe(6);
  });

  it('keeps the same immutable revision isolated between project handles', async () => {
    const firstProject = createFakeDirectory();
    const secondProject = createFakeDirectory();
    const descriptor = {
      cacheKey: 'shared-revision-cache',
      revision: 'v1',
      variant: 'preview' as const,
      mediaType: 'video' as const,
      contentType: 'video/mp4',
      size: 6,
      url: '/api/atlas/project-assets/shared-revision/media',
      cachePolicy: 'pin' as const,
    };
    const media = {
      ...remoteMedia('shared-revision'),
      localMediaDescriptor: descriptor,
    };
    const firstFetcher = vi.fn(async () => new Response(
      new Uint8Array([1, 1, 1, 1, 1, 1]),
      { status: 200, headers: { 'content-length': '6' } },
    ));
    const secondFetcher = vi.fn(async () => new Response(
      new Uint8Array([2, 2, 2, 2, 2, 2]),
      { status: 200, headers: { 'content-length': '6' } },
    ));

    const [first, second] = await Promise.all([
      materializeFireflyRemoteMedia(media, {
        projectHandle: firstProject.directory,
        fetcher: firstFetcher as typeof fetch,
      }),
      materializeFireflyRemoteMedia(media, {
        projectHandle: secondProject.directory,
        fetcher: secondFetcher as typeof fetch,
      }),
    ]);

    expect(firstFetcher).toHaveBeenCalledTimes(1);
    expect(secondFetcher).toHaveBeenCalledTimes(1);
    expect(first.handle).not.toBe(second.handle);
    expect(first.file.size).toBe(6);
    expect(second.file.size).toBe(6);
  });

  it('retains shared-kernel materialization when no project handle is available', async () => {
    const media = {
      ...remoteMedia('shared-kernel'),
      localMediaDescriptor: {
        cacheKey: 'shared-kernel-cache',
        revision: 'v1',
        variant: 'preview' as const,
        mediaType: 'video' as const,
        contentType: 'video/mp4',
        size: 6,
        url: '/api/atlas/project-assets/shared-kernel/media',
        cachePolicy: 'pin' as const,
      },
    };
    const sharedFile = new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'shared.mp4', {
      type: 'video/mp4',
    });
    const sharedHandle = {
      getFile: vi.fn(async () => sharedFile),
    } as unknown as FileSystemFileHandle;
    localMediaMocks.materialize.mockResolvedValue({
      file: sharedFile,
      handle: sharedHandle,
    });

    const result = await materializeFireflyRemoteMedia(media);

    expect(localMediaMocks.materialize).toHaveBeenCalledOnce();
    expect(result).toEqual({
      file: sharedFile,
      handle: sharedHandle,
      relativePath: 'firefly-local-media/shared-kernel-cache',
    });
  });

  it('aborts a stalled response and permits the same revision to retry', async () => {
    const root = createFakeDirectory();
    let firstSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>()
      .mockImplementationOnce((_input, init) => {
        firstSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      })
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3, 4, 5, 6]), {
        status: 200,
        headers: { 'content-length': '6' },
      }));
    const media = remoteMedia('asset-stalled-retry');

    await expect(materializeFireflyRemoteMedia(media, {
      projectHandle: root.directory,
      fetcher,
      requestInactivityTimeoutMs: 5,
    })).rejects.toThrow('FIREFLY_MEDIA_DOWNLOAD_STALLED');
    expect(firstSignal?.aborted).toBe(true);

    await expect(materializeFireflyRemoteMedia(media, {
      projectHandle: root.directory,
      fetcher,
      requestInactivityTimeoutMs: 5,
    })).resolves.toEqual(expect.objectContaining({ file: expect.objectContaining({ size: 6 }) }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out when a response body stops producing bytes', async () => {
    const root = createFakeDirectory();
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start() {
        // Keep the stream open without producing a first byte.
      },
    }), { status: 200, headers: { 'content-length': '6' } }));

    await expect(materializeFireflyRemoteMedia(remoteMedia('asset-stalled-body'), {
      projectHandle: root.directory,
      fetcher: fetcher as typeof fetch,
      requestInactivityTimeoutMs: 5,
    })).rejects.toThrow('FIREFLY_MEDIA_DOWNLOAD_STALLED');
  });
});
