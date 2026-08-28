export interface CachedFrame {
  mediaFileId: string;
  frameIndex: number;
  image: HTMLImageElement;
  timestamp: number;
}

export interface LegacyProxyFrameCacheStats {
  frameCount: number;
  heapBytes: number;
  width?: number;
  height?: number;
}

export interface ProxyVideoFrameCacheStats {
  frameCount: number;
  decodedFrameBytes: number;
  width?: number;
  height?: number;
}

export interface ProxyCachedFrame {
  frameIndex: number;
  image: HTMLImageElement;
}

export interface CachedVideoFrame {
  mediaFileId: string;
  frameIndex: number;
  frame: VideoFrame;
  timestamp: number;
}

export interface ProxyCachedVideoFrame {
  frameIndex: number;
  frame: VideoFrame;
}
