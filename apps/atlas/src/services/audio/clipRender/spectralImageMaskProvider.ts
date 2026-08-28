import { useMediaStore } from '../../../stores/mediaStore';
import type { ClipAudioRenderSpectralImageLayer, ClipAudioRenderSpectralImageLayerMask } from './clipAudioRenderModels';

const SPECTRAL_IMAGE_MASK_MAX_WIDTH = 512;
const SPECTRAL_IMAGE_MASK_MAX_HEIGHT = 256;
const spectralImageMaskCache = new Map<string, Promise<ClipAudioRenderSpectralImageLayerMask | null>>();

async function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  if (typeof Image === 'undefined') return null;
  const image = new Image();
  image.decoding = 'async';
  image.crossOrigin = 'anonymous';
  return new Promise((resolve) => {
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

export async function defaultSpectralImageLayerMaskProvider(
  layer: ClipAudioRenderSpectralImageLayer,
): Promise<ClipAudioRenderSpectralImageLayerMask | null> {
  if (typeof document === 'undefined') return null;
  const mediaFile = useMediaStore.getState().files.find(file => file.id === layer.imageMediaFileId);
  if (!mediaFile || mediaFile.type !== 'image') return null;

  const src = mediaFile.url || mediaFile.thumbnailUrl;
  if (!src) return null;

  const cacheKey = `${mediaFile.id}:${src}:${mediaFile.fileHash ?? ''}`;
  let promise = spectralImageMaskCache.get(cacheKey);
  if (!promise) {
    promise = (async () => {
      const image = await loadImageElement(src);
      if (!image) return null;

      const scale = Math.min(
        1,
        SPECTRAL_IMAGE_MASK_MAX_WIDTH / Math.max(1, image.naturalWidth || image.width),
        SPECTRAL_IMAGE_MASK_MAX_HEIGHT / Math.max(1, image.naturalHeight || image.height),
      );
      const width = Math.max(1, Math.round((image.naturalWidth || image.width || 1) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || image.height || 1) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(image, 0, 0, width, height);

      try {
        const data = ctx.getImageData(0, 0, width, height).data;
        const luminance = new Float32Array(width * height);
        const alpha = new Float32Array(width * height);
        for (let index = 0; index < width * height; index += 1) {
          const offset = index * 4;
          const r = data[offset] ?? 0;
          const g = data[offset + 1] ?? 0;
          const b = data[offset + 2] ?? 0;
          luminance[index] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          alpha[index] = (data[offset + 3] ?? 255) / 255;
        }
        return { width, height, luminance, alpha };
      } catch {
        return null;
      }
    })();
    spectralImageMaskCache.set(cacheKey, promise);
  }

  return promise;
}
