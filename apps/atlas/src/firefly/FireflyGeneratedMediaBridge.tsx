import { useEffect } from 'react';
import { useMediaStore } from '../stores/mediaStore';
import { useFireflyEmbedding } from './FireflyEmbeddingContext';
import { activateAtlasLocalMedia, closeAtlasLocalMedia, type LocalMediaDescriptor } from './local-media';

type ProjectAsset = {
  id: string;
  fileName: string;
  kind: 'image' | 'video' | 'audio';
  size: number;
  status: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  width?: number;
  height?: number;
  hasAudio?: boolean;
  localMedia?: LocalMediaDescriptor;
};
const PAGE_SIZE = 100;
const MAX_RECONCILE_ASSETS = 1000;

async function readProjectAssets(projectId: string, signal: AbortSignal): Promise<ProjectAsset[]> {
  const items: ProjectAsset[] = [];
  for (let offset = 0; offset < MAX_RECONCILE_ASSETS; offset += PAGE_SIZE) {
    const response = await fetch(`/api/atlas/projects/${encodeURIComponent(projectId)}/assets?limit=${PAGE_SIZE}&offset=${offset}`, {
      credentials: 'same-origin', cache: 'no-store',
      signal,
    });
    if (!response.ok) throw new Error(`Atlas media reconciliation failed (${response.status})`);
    const page = await response.json() as { items: ProjectAsset[] };
    items.push(...page.items);
    if (page.items.length < PAGE_SIZE) break;
  }
  return items;
}

export const FIREFLY_ATLAS_MEDIA_REFRESH_EVENT = 'firefly:atlas:media-refresh';

export function FireflyGeneratedMediaBridge() {
  const embedding = useFireflyEmbedding();

  useEffect(() => {
    if (!embedding?.projectId || !embedding.user.id) return;
    activateAtlasLocalMedia(embedding.user.id);
    let stopped = false;
    let inFlight: Promise<void> | undefined;
    let controller: AbortController | undefined;
    const reconcile = () => {
      if (inFlight) return inFlight;
      controller = new AbortController();
      inFlight = readProjectAssets(embedding.projectId, controller.signal)
        .then((items) => {
          if (stopped) return;
          for (const asset of items) {
            if (!['copying', 'ready'].includes(asset.status) || !asset.mediaUrl) continue;
            useMediaStore.getState().registerFireflyRemoteAsset({
              id: asset.id, name: asset.fileName, kind: asset.kind, mediaUrl: asset.mediaUrl, size: asset.size,
              thumbnailUrl: asset.thumbnailUrl, duration: asset.duration, width: asset.width, height: asset.height,
              hasAudio: asset.hasAudio,
              localMedia: asset.localMedia,
            });
          }
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          console.warn('[FireflyGeneratedMediaBridge] 素材同步失败', error);
        })
        .finally(() => { inFlight = undefined; controller = undefined; });
      return inFlight;
    };
    const refresh = () => { void reconcile(); };
    void reconcile();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reconcile(); }, 2000);
    window.addEventListener('online', refresh);
    window.addEventListener(FIREFLY_ATLAS_MEDIA_REFRESH_EVENT, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      stopped = true; controller?.abort(); window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener(FIREFLY_ATLAS_MEDIA_REFRESH_EVENT, refresh);
      document.removeEventListener('visibilitychange', refresh);
      closeAtlasLocalMedia();
    };
  }, [embedding?.projectId]);

  return null;
}
