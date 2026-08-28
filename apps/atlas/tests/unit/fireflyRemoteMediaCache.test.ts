import { describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore';
import { materializeFireflyRemoteMedia } from '../../src/services/project/firefly/FireflyRemoteMediaCache';

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
});
