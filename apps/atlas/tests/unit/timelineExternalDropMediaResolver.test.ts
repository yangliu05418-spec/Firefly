import { describe, expect, it } from 'vitest';

import {
  createPlaceholderFileForTimelineMedia,
  getTimelineDropMediaTypeOverride,
  resolveMediaFileForTimelineDrop,
  setTimelineDroppedFilePath,
} from '../../src/services/timeline/timelineExternalDropMediaResolver';
import type { MediaFile } from '../../src/stores/mediaStore';

function mediaFile(overrides: Partial<MediaFile>): MediaFile {
  return {
    id: 'media-1',
    name: 'media.bin',
    type: 'video',
    parentId: null,
    createdAt: 1,
    ...overrides,
  } as MediaFile;
}

describe('timeline external drop media resolver', () => {
  it('marks files with native paths for timeline placement', () => {
    const file = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    setTimelineDroppedFilePath(file, 'C:/media/clip.mp4');

    expect((file as File & { path?: string }).path).toBe('C:/media/clip.mp4');
  });

  it('reports clip-typed media overrides only for source-specific clip types', () => {
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'model' }))).toBe('model');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'gaussian-splat' }))).toBe('gaussian-splat');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'lottie' }))).toBe('lottie');
    expect(getTimelineDropMediaTypeOverride(mediaFile({ type: 'audio' }))).toBeUndefined();
  });

  it('creates lazy 3D placeholder files with file paths', () => {
    const placeholder = createPlaceholderFileForTimelineMedia(mediaFile({
      name: 'hero.glb',
      type: 'model',
      absolutePath: 'D:/assets/hero.glb',
    }));

    expect(placeholder.name).toBe('hero.glb');
    expect(placeholder.type).toBe('model/gltf-binary');
    expect((placeholder as File & { path?: string }).path).toBe('D:/assets/hero.glb');
  });

  it('resolves existing files and lazy 3D placeholders for timeline drops', async () => {
    const existingFile = new File(['audio'], 'dialog.wav', { type: 'audio/wav' });

    await expect(resolveMediaFileForTimelineDrop(mediaFile({
      type: 'audio',
      file: existingFile,
    }))).resolves.toBe(existingFile);

    await expect(resolveMediaFileForTimelineDrop(mediaFile({
      id: 'model-1',
      name: 'mesh.obj',
      type: 'model',
      absolutePath: 'D:/assets/mesh.obj',
    }))).resolves.toEqual(expect.objectContaining({
      name: 'mesh.obj',
      type: 'model/obj',
    }));
  });
});
