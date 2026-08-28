import type { MediaKind } from './model';

export function mediaKindForFile(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  return null;
}

export async function readMediaMetadata(objectUrl: string, kind: MediaKind): Promise<{
  duration: number;
  width?: number;
  height?: number;
}> {
  if (kind === 'image') {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    return { duration: 5, width: image.naturalWidth, height: image.naturalHeight };
  }
  return new Promise((resolve, reject) => {
    const element = document.createElement(kind === 'video' ? 'video' : 'audio');
    const cleanup = () => {
      element.removeAttribute('src');
      element.load();
    };
    element.preload = 'metadata';
    element.onloadedmetadata = () => {
      const result = {
        duration: Number.isFinite(element.duration) ? Math.max(0.1, element.duration) : 10,
        width: element instanceof HTMLVideoElement ? element.videoWidth : undefined,
        height: element instanceof HTMLVideoElement ? element.videoHeight : undefined,
      };
      cleanup();
      resolve(result);
    };
    element.onerror = () => {
      cleanup();
      reject(new Error('Unable to read media metadata.'));
    };
    element.src = objectUrl;
  });
}

export const formatTimecode = (seconds: number): string => {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remaining = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remaining.toFixed(2).padStart(5, '0')}`;
};
