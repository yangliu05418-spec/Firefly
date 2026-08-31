// Image clip addition - extracted from addClip
// Handles image file loading and thumbnail generation

import type { TimelineClip } from '../../../types/timeline';
import { DEFAULT_TRANSFORM } from '../constants';
import { useMediaStore } from '../../mediaStore';
import { startTimelineImageHydration } from '../../../services/timeline/imageRuntimeHydrator';
import { generateImageThumbnail } from '../helpers/thumbnailHelpers';
import { generateClipId } from '../helpers/idGenerator';
import { blobUrlManager } from '../helpers/blobUrlManager';

export interface AddImageClipParams {
  trackId: string;
  file: File;
  startTime: number;
  estimatedDuration: number;
  mediaFileId?: string;
}

/**
 * Create placeholder image clip immediately.
 * Returns clip ready to be added to state while media loads in background.
 */
export function createImageClipPlaceholder(params: AddImageClipParams): TimelineClip {
  const { trackId, file, startTime, estimatedDuration, mediaFileId } = params;
  const clipId = generateClipId('clip-img');

  return {
    id: clipId,
    trackId,
    name: file.name,
    file,
    startTime,
    duration: estimatedDuration,
    inPoint: 0,
    outPoint: estimatedDuration,
    source: { type: 'image', naturalDuration: estimatedDuration, mediaFileId },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: true,
  };
}

export interface LoadImageMediaParams {
  clip: TimelineClip;
  updateClip: (id: string, updates: Partial<TimelineClip>) => void;
}

/**
 * Load image media in background - handles loading and thumbnail generation.
 */
export async function loadImageMedia(params: LoadImageMediaParams): Promise<void> {
  const { clip, updateClip } = params;
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  const mediaStore = useMediaStore.getState();
  const importedMedia = mediaFileId ? mediaStore.files.find((item) => item.id === mediaFileId) : undefined;
  const remoteUrl = clip.file?.size === 0 ? (importedMedia?.url ?? importedMedia?.remoteSourcePath) : undefined;

  // Firefly project assets already expose a stable authenticated route. Do
  // not wait for the OPFS copy before creating an editable timeline clip.
  // LazyImageElements will render this source immediately and the background
  // materializer will replace it with a local file on the next safe render.
  if (remoteUrl) {
    updateClip(clip.id, {
      source: { type: 'image', naturalDuration: clip.duration, mediaFileId },
      transform: { ...DEFAULT_TRANSFORM },
      thumbnails: importedMedia?.thumbnailUrl ? [importedMedia.thumbnailUrl] : [],
      isLoading: false,
    });
    return;
  }

  const imageUrl = blobUrlManager.create(clip.id, clip.file, 'image');
  const img = await new Promise<HTMLImageElement>((resolve) => {
    startTimelineImageHydration({
      url: imageUrl,
      onReady: resolve,
      onError: (_event, image) => resolve(image),
    });
  });

  // Generate thumbnail
  const thumbnail = generateImageThumbnail(img);
  const thumbnails = thumbnail ? [thumbnail] : [];

  updateClip(clip.id, {
    source: { type: 'image', imageUrl, naturalDuration: clip.duration, mediaFileId },
    transform: { ...DEFAULT_TRANSFORM },
    thumbnails,
    isLoading: false,
  });

  // Sync to media store
  if (!mediaStore.getFileByName(clip.file.name)) {
    mediaStore.importFile(clip.file);
  }
}
