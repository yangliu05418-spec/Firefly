import { atlasApi } from './api';
import { documentDuration, stripRuntimeUrls, type AtlasAsset, type AtlasDocument } from './model';

export const MAX_EXPORT_DURATION_SECONDS = 10 * 60;
export const MAX_EXPORT_WIDTH = 1920;
export const MAX_EXPORT_HEIGHT = 1080;
export const MAX_EXPORT_FPS = 30;

export type ExportPhase = 'preparing' | 'encoding' | 'uploading' | 'finalizing' | 'completed';

export interface ExportProgress {
  phase: ExportPhase;
  progress: number;
}

interface ExportWorkerAsset {
  id: string;
  kind: AtlasAsset['kind'];
  blob?: Blob;
  url?: string;
}

export interface ExportManifest {
  duration: number;
  assets: AtlasAsset[];
}

export function buildExportManifest(document: AtlasDocument): ExportManifest {
  const ids = new Set(document.clips.map((clip) => clip.assetId));
  const assets = document.assets.filter((asset) => ids.has(asset.id));
  const missing = [...ids].filter((id) => !assets.some((asset) => asset.id === id));
  if (missing.length) throw new Error(`时间线中有 ${missing.length} 个素材不可用，请先重新连接素材`);
  const duration = documentDuration(document);
  if (!document.clips.length || duration <= 0) throw new Error('时间线为空，请先添加素材');
  if (duration > MAX_EXPORT_DURATION_SECONDS) throw new Error('首版导出最长支持10分钟，请缩短时间线后重试');
  return { duration, assets };
}

const validateExportSettings = (width: number, height: number, fps: number) => {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width > MAX_EXPORT_WIDTH || height > MAX_EXPORT_HEIGHT) {
    throw new Error('首版导出最高支持1920×1080');
  }
  if (!Number.isInteger(fps) || fps < 1 || fps > MAX_EXPORT_FPS) throw new Error('首版导出最高支持30fps');
};

export class AtlasExporter {
  private worker: Worker | null = null;
  private uploadId: string | null = null;
  private cancelled = false;
  private readonly projectId: string;
  private readonly userId: string;
  private readonly onProgress: (progress: ExportProgress) => void;

  constructor(projectId: string, userId: string, onProgress: (progress: ExportProgress) => void) {
    this.projectId = projectId;
    this.userId = userId;
    this.onProgress = onProgress;
  }

  async start(document: AtlasDocument, width = 1920, height = 1080, fps = 30): Promise<AtlasAsset> {
    if (this.worker) throw new Error('已有导出任务正在进行');
    validateExportSettings(width, height, fps);
    this.cancelled = false;
    const manifest = buildExportManifest(document);
    this.onProgress({ phase: 'preparing', progress: 1 });
    const assets = await Promise.all(manifest.assets.map(loadAssetSource));
    if (this.cancelled) throw new Error('导出已取消');

    // Keep only an unresolved initialization intent. Once the server response
    // is observed the key is removed, so a deliberate second export creates a
    // new immutable asset. If all HTTP responses are lost or the page crashes,
    // the next attempt reclaims exactly the same Multipart reservation.
    const intentStorageKey = `firefly:atlas:${this.userId}:export-intent:${this.projectId}`;
    let initializationKey: string;
    try {
      initializationKey = localStorage.getItem(intentStorageKey) ?? crypto.randomUUID();
      localStorage.setItem(intentStorageKey, initializationKey);
    } catch {
      initializationKey = crypto.randomUUID();
    }
    const transfer = await atlasApi.createExportTransfer(this.projectId, initializationKey);
    try { localStorage.removeItem(intentStorageKey); } catch { /* storage may be unavailable */ }
    this.uploadId = transfer.uploadId;
    const partSize = transfer.partSize ?? 16 * 1024 * 1024;
    const completedParts: Array<{ partNumber: number; etag: string }> = [];
    let totalSize = 0;
    let expectedPosition = 0;
    this.worker = new Worker(new URL('./workers/export.worker.ts', import.meta.url), { type: 'module', name: 'firefly-atlas-export' });

    try {
      await new Promise<void>((resolve, reject) => {
        const worker = this.worker;
        if (!worker) return reject(new Error('导出引擎启动失败'));
        worker.onerror = () => reject(new Error('导出引擎意外停止，请重试'));
        worker.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
          const message = event.data;
          if (message.type === 'progress') {
            this.onProgress({ phase: String(message.phase) === 'finalizing' ? 'finalizing' : 'encoding', progress: Number(message.progress) || 0 });
            return;
          }
          if (message.type === 'error') {
            reject(new Error(String(message.message ?? '导出失败')));
            return;
          }
          if (message.type === 'done') {
            resolve();
            return;
          }
          if (message.type === 'chunk') {
            const chunkId = Number(message.chunkId);
            const position = Number(message.position);
            const data = message.data;
            if (!(data instanceof ArrayBuffer)) {
              worker.postMessage({ type: 'ack', chunkId, error: '导出分片格式无效' });
              return;
            }
            void this.uploadChunk(data, position, expectedPosition, partSize, completedParts)
              .then(() => {
                expectedPosition += data.byteLength;
                totalSize = Math.max(totalSize, position + data.byteLength);
                this.onProgress({ phase: 'uploading', progress: Math.min(96, 12 + Math.round((position / Math.max(manifest.duration * 1_000_000, position + data.byteLength)) * 84)) });
                worker.postMessage({ type: 'ack', chunkId });
              })
              .catch((error) => {
                const messageText = error instanceof Error ? error.message : String(error);
                worker.postMessage({ type: 'ack', chunkId, error: messageText });
                reject(error);
              });
          }
        };
        worker.postMessage({
          type: 'start',
          document: stripRuntimeUrls(document),
          assets,
          width,
          height,
          fps,
          partSize,
        });
      });

      if (this.cancelled) throw new Error('导出已取消');
      this.onProgress({ phase: 'finalizing', progress: 97 });
      const result = await atlasApi.completeExportTransfer(this.projectId, transfer.uploadId, completedParts.sort((a, b) => a.partNumber - b.partNumber), totalSize);
      this.onProgress({ phase: 'completed', progress: 100 });
      return result;
    } catch (error) {
      await atlasApi.cancelExportTransfer(this.projectId, transfer.uploadId).catch(() => undefined);
      throw error;
    } finally {
      this.worker?.terminate();
      this.worker = null;
      this.uploadId = null;
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.worker?.postMessage({ type: 'cancel' });
    if (this.uploadId) void atlasApi.cancelExportTransfer(this.projectId, this.uploadId).catch(() => undefined);
  }

  private async uploadChunk(
    data: ArrayBuffer,
    position: number,
    expectedPosition: number,
    partSize: number,
    completedParts: Array<{ partNumber: number; etag: string }>,
  ) {
    if (this.cancelled) throw new Error('导出已取消');
    if (position !== expectedPosition || position % partSize !== 0) {
      throw new Error('导出数据流顺序异常，请重新导出');
    }
    if (!this.uploadId) throw new Error('导出上传会话已失效，请重新导出');
    const partNumber = Math.floor(position / partSize) + 1;
    const signed = await atlasApi.signExportParts(this.projectId, this.uploadId, [partNumber]);
    const existing = signed.completedParts.find((part) => part.partNumber === partNumber);
    if (existing) {
      if (!completedParts.some((part) => part.partNumber === partNumber)) completedParts.push(existing);
      return;
    }
    const url = signed.parts.find((part) => part.partNumber === partNumber)?.url;
    if (!url) throw new Error(`第${partNumber}个导出分片缺少上传地址`);
    let response: Response | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.cancelled) throw new Error('导出已取消');
      try {
        response = await fetch(url, { method: 'PUT', body: data, credentials: 'omit' });
        if (response.ok) break;
      } catch (error) {
        if (this.cancelled) throw new Error('导出已取消');
        lastError = error;
      }
      if (attempt < 3) await this.retryDelay(2 ** attempt * 1_000);
    }
    if (!response && lastError) throw lastError;
    if (!response?.ok) throw new Error(`第${partNumber}个导出分片上传失败`);
    const etag = response.headers.get('ETag')?.replaceAll('"', '');
    if (!etag) throw new Error('对象存储未返回ETag，请联系管理员检查TOS CORS配置');
    completedParts.push({ partNumber, etag });
  }

  private retryDelay(delayMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const poll = () => {
        if (this.cancelled) return reject(new Error('导出已取消'));
        const remaining = delayMs - (Date.now() - startedAt);
        if (remaining <= 0) return resolve();
        window.setTimeout(poll, Math.min(100, remaining));
      };
      poll();
    });
  }
}

async function loadAssetSource(asset: AtlasAsset): Promise<ExportWorkerAsset> {
  // Local object URLs must be materialized before crossing the Worker
  // boundary. Archived media stays URL-backed so Mediabunny can use Range
  // reads instead of downloading every source file into browser memory.
  if (asset.objectUrl) {
    const response = await fetch(asset.objectUrl);
    if (!response.ok) throw new Error(`无法读取素材：${asset.name}`);
    return { id: asset.id, kind: asset.kind, blob: await response.blob() };
  }
  if (asset.mediaUrl) {
    const url = new URL(asset.mediaUrl, window.location.origin).href;
    // Images are decoded through createImageBitmap in the worker and therefore
    // need a Blob. Video/audio stay URL-backed so Mediabunny can issue Range
    // requests instead of buffering an entire archived source in memory.
    if (asset.kind === 'image') {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`无法读取素材：${asset.name}`);
      return { id: asset.id, kind: asset.kind, blob: await response.blob() };
    }
    return { id: asset.id, kind: asset.kind, url };
  }
  throw new Error(`素材不可用：${asset.name}`);
}
