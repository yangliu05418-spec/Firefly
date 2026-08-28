// Audio proxy element loading helpers: source resolution from the media
// store / project folder and element readiness. Object URL lease acquisition
// stays in proxyFrameCache.ts and is injected as a callback.

import { projectFileService } from '../projectFileService';
import { useMediaStore } from '../../stores/mediaStore';

// Resolve the audio proxy src for a media file: an existing session proxy URL,
// or an object URL acquired (via callback) for the project proxy audio file.
export async function resolveAudioProxySrc(
  mediaFileId: string,
  acquireObjectUrl: (audioFile: Blob) => string,
): Promise<string | null> {
  // Get storage key (prefer fileHash for deduplication)
  const mediaStore = useMediaStore.getState();
  const mediaFile = mediaStore.files.find(f => f.id === mediaFileId);
  const storageKey = mediaFile?.audioProxyStorageKey || mediaFile?.fileHash || mediaFileId;

  // Load audio file from project folder
  const audioSrc = mediaFile?.audioProxyUrl;
  if (audioSrc) return audioSrc;

  const audioFile = await projectFileService.getProxyAudio(storageKey);
  if (!audioFile) {
    return null;
  }
  return acquireObjectUrl(audioFile);
}

// Wait for an audio element to be ready for playback.
export async function waitForAudioProxyReady(audio: HTMLAudioElement): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const onCanPlay = () => {
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.removeEventListener('error', onError);
      resolve();
    };
    const onError = () => {
      audio.removeEventListener('canplaythrough', onCanPlay);
      audio.removeEventListener('error', onError);
      reject(new Error('Failed to load audio proxy'));
    };
    audio.addEventListener('canplaythrough', onCanPlay);
    audio.addEventListener('error', onError);
    // Start loading
    audio.load();
  });
}
