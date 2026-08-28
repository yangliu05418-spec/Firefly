import { describe, expect, it, vi } from 'vitest';
import { createPrimaryMediaObjectUrl } from '../../src/services/project/mediaObjectUrlManager';
import {
  createClipboardMediaReloadPatch,
  createLoadStateDeferredMediaRestorePatch,
  createLoadStateImageRestorePatch,
  createLoadStateNativeVideoPathRestorePatch,
  createLoadStateSpatialRestorePatch,
  resolveLoadStateMediaRuntimeReference,
  startLoadStateVectorRuntimeRestore,
} from '../../src/services/timeline/timelineMediaSourceRuntimeRestore';
import type { SerializableClip, TimelineClip } from '../../src/types';

vi.mock('../../src/services/project/mediaObjectUrlManager', () => ({
  createPrimaryMediaObjectUrl: vi.fn(() => 'blob:http://localhost/generated-model-url'),
}));

function createFile(name: string, type: string): File {
  return new File(['media'], name, { type });
}

function createClip(id: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    trackId: 'track-video',
    name: id,
    file: createFile(`${id}.dat`, 'application/octet-stream'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: null,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isLoading: true,
    ...overrides,
  };
}

function createSerializedClip(overrides: Partial<SerializableClip> = {}): SerializableClip {
  return {
    id: 'clip',
    trackId: 'track-video',
    name: 'clip',
    mediaFileId: 'media-clip',
    sourceType: 'video',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    ...overrides,
  };
}

describe('timeline media source runtime restore', () => {
  it('creates data-only video and audio reload patches', () => {
    const videoFile = createFile('video.mp4', 'video/mp4');
    const audioFile = createFile('audio.wav', 'audio/wav');

    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-video',
      duration: 12,
      mediaFile: { id: 'media-video', duration: 24, file: videoFile },
      mediaFileId: 'media-video',
      source: { type: 'video', mediaFileId: 'media-video', naturalDuration: 10 },
    })).toEqual({
      file: videoFile,
      source: { type: 'video', naturalDuration: 10, mediaFileId: 'media-video' },
      isLoading: false,
      needsReload: false,
    });

    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-audio',
      duration: 8,
      mediaFile: { id: 'media-audio', duration: 6, file: audioFile },
      mediaFileId: 'media-audio',
      source: { type: 'audio', mediaFileId: 'media-audio' },
    })).toEqual({
      file: audioFile,
      source: { type: 'audio', naturalDuration: 6, mediaFileId: 'media-audio' },
      isLoading: false,
      needsReload: false,
    });
  });

  it('uses injected clip-owned image URLs for image reload patches', () => {
    const imageFile = createFile('still.png', 'image/png');
    const createImageUrl = vi.fn(() => 'blob:http://localhost/clip-image-url');

    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-image',
      duration: 5,
      mediaFile: { id: 'media-image', file: imageFile, url: 'blob:http://localhost/media-image-url' },
      mediaFileId: 'media-image',
      source: { type: 'image', mediaFileId: 'media-image', naturalDuration: 4 },
      createImageUrl,
    })).toEqual({
      file: imageFile,
      source: {
        type: 'image',
        imageUrl: 'blob:http://localhost/clip-image-url',
        naturalDuration: 4,
        mediaFileId: 'media-image',
      },
      isLoading: false,
      needsReload: false,
    });
    expect(createImageUrl).toHaveBeenCalledWith({ clipId: 'clip-image', file: imageFile });
  });

  it('uses media-owned or primary object URLs for model reload patches', () => {
    const modelFile = createFile('hero.glb', 'model/gltf-binary');

    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-model-existing',
      duration: 5,
      mediaFile: {
        id: 'media-model-existing',
        file: modelFile,
        url: 'blob:http://localhost/media-model-url',
      },
      mediaFileId: 'media-model-existing',
      source: { type: 'model', mediaFileId: 'media-model-existing', naturalDuration: 3600 },
    })).toEqual({
      file: modelFile,
      is3D: true,
      source: {
        type: 'model',
        modelUrl: 'blob:http://localhost/media-model-url',
        naturalDuration: 3600,
        mediaFileId: 'media-model-existing',
      },
      isLoading: false,
      needsReload: false,
    });

    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-model-generated',
      duration: 5,
      mediaFile: { id: 'media-model-generated', file: modelFile },
      mediaFileId: 'media-model-generated',
      source: { type: 'model', mediaFileId: 'media-model-generated' },
    })).toEqual({
      file: modelFile,
      is3D: true,
      source: {
        type: 'model',
        modelUrl: 'blob:http://localhost/generated-model-url',
        naturalDuration: 3600,
        mediaFileId: 'media-model-generated',
      },
      isLoading: false,
      needsReload: false,
    });
    expect(createPrimaryMediaObjectUrl).toHaveBeenCalledWith(
      'media-model-generated',
      modelFile,
      { revokeExisting: false },
    );
  });

  it('keeps vector animation reload data-only', () => {
    const vectorFile = createFile('anim.lottie', 'application/json');

    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-vector',
      duration: 6,
      mediaFile: { id: 'media-vector', duration: 6, file: vectorFile },
      mediaFileId: 'media-vector',
      source: {
        type: 'lottie',
        mediaFileId: 'media-vector',
        vectorAnimationSettings: {
          loop: true,
          endBehavior: 'loop',
          playbackMode: 'forward',
          fit: 'contain',
        },
      },
    })).toEqual({
      file: vectorFile,
      source: {
        type: 'lottie',
        mediaFileId: 'media-vector',
        naturalDuration: 6,
        vectorAnimationSettings: {
          loop: true,
          endBehavior: 'loop',
          playbackMode: 'forward',
          fit: 'contain',
        },
      },
      isLoading: false,
      needsReload: false,
    });
  });

  it('returns null when no file or supported source exists', () => {
    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-missing-file',
      duration: 5,
      mediaFile: { id: 'media-missing-file' },
      mediaFileId: 'media-missing-file',
      source: { type: 'video', mediaFileId: 'media-missing-file' },
    })).toBeNull();

    expect(createClipboardMediaReloadPatch({
      clipId: 'clip-no-source',
      duration: 5,
      mediaFile: { id: 'media-video', file: createFile('video.mp4', 'video/mp4') },
      mediaFileId: 'media-video',
      source: null,
    })).toBeNull();
  });

  it('resolves load-state media references without creating object URLs for deferred media', async () => {
    const videoFile = createFile('video.mp4', 'video/mp4');
    const createObjectUrl = vi.fn(() => 'blob:unexpected-video-url');

    await expect(resolveLoadStateMediaRuntimeReference({
      adapters: { createObjectUrl },
      mediaFile: {
        id: 'media-video',
        file: videoFile,
        url: 'blob:http://localhost/media-video-primary',
      },
      sourceType: 'video',
    })).resolves.toEqual({
      deferMediaElementRestore: true,
      deferObjectUrlRestore: true,
      fileUrl: 'blob:http://localhost/media-video-primary',
      loadFile: videoFile,
    });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('creates object URLs for non-deferred load-state media references', async () => {
    const file = createFile('data.bin', 'application/octet-stream');
    const createObjectUrl = vi.fn(() => 'blob:http://localhost/generated-data-url');

    await expect(resolveLoadStateMediaRuntimeReference({
      adapters: { createObjectUrl },
      mediaFile: { id: 'media-data', file },
      sourceType: 'binary',
    })).resolves.toEqual({
      deferMediaElementRestore: false,
      deferObjectUrlRestore: false,
      fileUrl: 'blob:http://localhost/generated-data-url',
      loadFile: file,
    });
    expect(createObjectUrl).toHaveBeenCalledWith(file);
  });

  it('resolves native-helper image references into primary media URLs', async () => {
    const referencedFile = createFile('still.png', 'image/png');
    const parseFileReferenceUrl = vi.fn(() => ({ path: 'still.png' }));
    const getReferencedFile = vi.fn(async () => referencedFile);
    const createPrimaryObjectUrl = vi.fn(() => 'blob:http://localhost/restored-image-primary');

    await expect(resolveLoadStateMediaRuntimeReference({
      adapters: {
        createPrimaryObjectUrl,
        getReferencedFile,
        parseFileReferenceUrl,
      },
      mediaFile: {
        id: 'media-image',
        name: 'still.png',
        url: 'native://project/still.png',
      },
      sourceType: 'image',
    })).resolves.toEqual({
      deferMediaElementRestore: false,
      deferObjectUrlRestore: true,
      fileUrl: 'blob:http://localhost/restored-image-primary',
      loadFile: referencedFile,
      restoredMediaFilePatch: {
        file: referencedFile,
        url: 'blob:http://localhost/restored-image-primary',
        hasFileHandle: true,
      },
    });
    expect(parseFileReferenceUrl).toHaveBeenCalledWith('native://project/still.png');
    expect(getReferencedFile).toHaveBeenCalledWith('native://project/still.png', 'still.png');
    expect(createPrimaryObjectUrl).toHaveBeenCalledWith('media-image', referencedFile);
  });

  it('resolves native-helper vector references without replacing their reference URL', async () => {
    const referencedFile = createFile('anim.lottie', 'application/json');
    const createPrimaryObjectUrl = vi.fn(() => 'blob:unexpected-vector-primary');

    await expect(resolveLoadStateMediaRuntimeReference({
      adapters: {
        createPrimaryObjectUrl,
        getReferencedFile: vi.fn(async () => referencedFile),
        parseFileReferenceUrl: vi.fn(() => ({ path: 'anim.lottie' })),
      },
      mediaFile: {
        id: 'media-lottie',
        name: 'anim.lottie',
        url: 'native://project/anim.lottie',
      },
      sourceType: 'lottie',
    })).resolves.toEqual({
      deferMediaElementRestore: false,
      deferObjectUrlRestore: true,
      fileUrl: 'native://project/anim.lottie',
      loadFile: referencedFile,
      restoredMediaFilePatch: {
        file: referencedFile,
        url: 'native://project/anim.lottie',
        hasFileHandle: true,
      },
    });
    expect(createPrimaryObjectUrl).not.toHaveBeenCalled();
  });

  it('creates load-state image restore patches with managed clip image URLs', () => {
    const fallbackFile = createFile('placeholder.png', 'image/png');
    const restoredFile = createFile('restored.png', 'image/png');
    const createManagedImageUrl = vi.fn(() => 'blob:http://localhost/managed-image');

    expect(createLoadStateImageRestorePatch({
      adapters: { createManagedImageUrl },
      absolutePath: 'C:/media/restored.png',
      clipDuration: 5,
      clipId: 'clip-image',
      fallbackFile,
      loadFile: restoredFile,
      mediaDuration: 10,
      mediaFileId: 'media-image',
      naturalDuration: 4,
    })).toEqual({
      file: restoredFile,
      source: {
        type: 'image',
        mediaFileId: 'media-image',
        naturalDuration: 4,
        imageUrl: 'blob:http://localhost/managed-image',
        filePath: 'C:/media/restored.png',
      },
      isLoading: false,
      needsReload: false,
    });
    expect(createManagedImageUrl).toHaveBeenCalledWith('clip-image', restoredFile);
  });

  it('keeps primary media blob URLs for load-state image restore patches', () => {
    const fallbackFile = createFile('placeholder.png', 'image/png');
    const restoredFile = createFile('restored.png', 'image/png');
    const createManagedImageUrl = vi.fn(() => 'blob:unexpected-managed-image');

    expect(createLoadStateImageRestorePatch({
      adapters: {
        createManagedImageUrl,
        getPrimaryMediaObjectUrl: () => 'blob:http://localhost/primary-image',
      },
      clipDuration: 5,
      clipId: 'clip-image',
      fallbackFile,
      fileUrl: 'blob:http://localhost/primary-image',
      loadFile: restoredFile,
      mediaFileId: 'media-image',
    })).toEqual({
      file: restoredFile,
      source: {
        type: 'image',
        mediaFileId: 'media-image',
        naturalDuration: 5,
        imageUrl: 'blob:http://localhost/primary-image',
      },
      isLoading: false,
      needsReload: false,
    });
    expect(createManagedImageUrl).not.toHaveBeenCalled();
  });

  it('creates native-path and deferred media load-state restore patches', () => {
    const fallbackFile = createFile('placeholder.mp4', 'video/mp4');
    const restoredAudio = createFile('restored.wav', 'audio/wav');

    expect(createLoadStateNativeVideoPathRestorePatch({
      absolutePath: 'D:/media/video.mp4',
      clipDuration: 12,
      mediaDuration: 20,
      mediaFileId: 'media-video',
      naturalDuration: 10,
    })).toEqual({
      source: {
        type: 'video',
        naturalDuration: 10,
        mediaFileId: 'media-video',
        filePath: 'D:/media/video.mp4',
      },
      isLoading: false,
      needsReload: false,
    });

    expect(createLoadStateDeferredMediaRestorePatch({
      absolutePath: 'D:/media/audio.wav',
      clipDuration: 8,
      fallbackFile,
      loadFile: restoredAudio,
      mediaDuration: 6,
      mediaFileId: 'media-audio',
      sourceType: 'audio',
    })).toEqual({
      file: restoredAudio,
      source: {
        type: 'audio',
        naturalDuration: 6,
        mediaFileId: 'media-audio',
        filePath: 'D:/media/audio.wav',
      },
      isLoading: false,
      needsReload: false,
    });
  });

  it('starts load-state vector runtime restores through an injected starter', () => {
    const file = createFile('anim.lottie', 'application/json');
    const clip = createClip('clip-vector');
    const serializedClip = createSerializedClip({
      mediaFileId: 'media-vector',
      naturalDuration: 4,
      sourceType: 'lottie',
      vectorAnimationSettings: {
        loop: true,
        endBehavior: 'loop',
        playbackMode: 'forward',
        fit: 'contain',
      },
    });
    const startVectorRuntimeRestore = vi.fn();
    const applyPatch = vi.fn();
    const onReady = vi.fn();

    expect(startLoadStateVectorRuntimeRestore({
      adapters: { startVectorRuntimeRestore },
      applyPatch,
      clip,
      isCurrentTimelineSession: () => true,
      loadFile: file,
      needsReloadWhenMissingFile: false,
      onError: vi.fn(),
      onMissingFile: vi.fn(),
      onReady,
      onStartError: vi.fn(),
      serializedClip,
      sourceType: 'lottie',
    })).toBe(true);

    expect(startVectorRuntimeRestore).toHaveBeenCalledTimes(1);
    const startOptions = startVectorRuntimeRestore.mock.calls[0][0];
    expect(startOptions.clip).toEqual(expect.objectContaining({
      id: 'clip-vector',
      file,
      source: {
        type: 'lottie',
        mediaFileId: 'media-vector',
        naturalDuration: 4,
        vectorAnimationSettings: serializedClip.vectorAnimationSettings,
      },
    }));
    expect(startOptions.createReadyPatch({
      type: 'lottie',
      textCanvas: document.createElement('canvas'),
      mediaFileId: 'media-vector',
      naturalDuration: 4,
    })).toEqual({
      file,
      source: expect.objectContaining({
        type: 'lottie',
        mediaFileId: 'media-vector',
      }),
      isLoading: false,
      needsReload: false,
    });

    startOptions.applyPatch({ isLoading: false });
    startOptions.onReady();
    expect(applyPatch).toHaveBeenCalledWith({ isLoading: false });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('creates missing-file vector restore patches without starting runtime restore', () => {
    const startVectorRuntimeRestore = vi.fn();
    const applyPatch = vi.fn();
    const onMissingFile = vi.fn();

    expect(startLoadStateVectorRuntimeRestore({
      adapters: { startVectorRuntimeRestore },
      applyPatch,
      clip: createClip('clip-vector'),
      isCurrentTimelineSession: () => true,
      needsReloadWhenMissingFile: true,
      onError: vi.fn(),
      onMissingFile,
      onReady: vi.fn(),
      onStartError: vi.fn(),
      serializedClip: createSerializedClip({ sourceType: 'rive' }),
      sourceType: 'rive',
    })).toBe(true);

    expect(startVectorRuntimeRestore).not.toHaveBeenCalled();
    expect(onMissingFile).toHaveBeenCalledTimes(1);
    expect(applyPatch).toHaveBeenCalledWith({
      isLoading: false,
      needsReload: true,
    });
  });

  it('creates load-state spatial restore patches through an injected applier', () => {
    const clip = createClip('clip-model');
    const serializedClip = createSerializedClip({
      mediaFileId: 'media-model',
      sourceType: 'model',
      meshType: 'cube',
      text3DProperties: { text: 'Cube' } as SerializableClip['text3DProperties'],
    });

    const result = createLoadStateSpatialRestorePatch({
      adapters: {
        applyManagedSpatialSource: (workingClip) => {
          workingClip.source = {
            type: 'model',
            mediaFileId: 'media-model',
            modelUrl: 'blob:http://localhost/model',
          };
          workingClip.is3D = true;
          workingClip.meshType = 'cube';
          workingClip.text3DProperties = { text: 'Cube' } as TimelineClip['text3DProperties'];
          return {
            handled: true,
            restored: true,
            source: workingClip.source,
          };
        },
      },
      clip,
      duration: 5,
      mediaFile: {
        id: 'media-model',
        file: createFile('model.glb', 'model/gltf-binary'),
        url: 'blob:http://localhost/model',
      },
      serializedClip,
    });

    expect(result).toEqual({
      handled: true,
      restored: true,
      patch: {
        source: {
          type: 'model',
          mediaFileId: 'media-model',
          modelUrl: 'blob:http://localhost/model',
        },
        is3D: true,
        meshType: 'cube',
        text3DProperties: { text: 'Cube' },
        isLoading: false,
      },
    });
    expect(clip.source).toBeNull();
  });

  it('creates an isLoading patch for unrestored load-state spatial sources', () => {
    expect(createLoadStateSpatialRestorePatch({
      adapters: {
        applyManagedSpatialSource: () => ({
          handled: true,
          restored: false,
          source: null,
        }),
      },
      clip: createClip('clip-model'),
      duration: 5,
      mediaFile: { id: 'media-model' },
      serializedClip: createSerializedClip({ sourceType: 'model' }),
    })).toEqual({
      handled: true,
      restored: false,
      patch: { isLoading: false },
    });
  });
});
