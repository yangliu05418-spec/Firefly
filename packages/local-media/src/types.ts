export type LocalMediaVariant = 'thumbnail' | 'preview' | 'original';
export type LocalMediaType = 'image' | 'video' | 'audio';
export type LocalMediaCachePolicy = 'warm' | 'on-demand' | 'pin';

export interface LocalMediaDescriptor {
  cacheKey: string;
  revision: string;
  variant: LocalMediaVariant;
  mediaType: LocalMediaType;
  contentType: string;
  size?: number;
  url: string;
  cachePolicy: LocalMediaCachePolicy;
}

export interface LocalMediaManifest extends LocalMediaDescriptor {
  userId: string;
  state: 'partial' | 'ready' | 'failed';
  downloadedBytes: number;
  lastAccessedAt: number;
  pinned: boolean;
  errorCode?: string;
}

export type LocalMediaEventType =
  | 'local_media_hit'
  | 'local_media_miss'
  | 'local_media_fetch_started'
  | 'local_media_fetch_resumed'
  | 'local_media_ready'
  | 'local_media_evicted'
  | 'local_media_quota_pressure'
  | 'local_media_fallback';

export interface LocalMediaEvent {
  type: LocalMediaEventType;
  cacheKey: string;
  variant: LocalMediaVariant;
  mediaType: LocalMediaType;
  bytes?: number;
  elapsedMs?: number;
  errorCode?: string;
}

export interface LocalMediaStats {
  supported: boolean;
  persisted: boolean;
  usage: number;
  quota: number;
  cachedBytes: number;
  cachedItems: number;
}
