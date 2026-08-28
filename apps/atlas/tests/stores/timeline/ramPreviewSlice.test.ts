import { createStore } from 'zustand';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineStore } from '../../../src/stores/timeline/types';
import { createRamPreviewSlice } from '../../../src/stores/timeline/ramPreviewSlice';
import { renderHostPort } from '../../../src/services/render/renderHostPort';

vi.mock('../../../src/services/render/renderHostPort', () => ({
  renderHostPort: {
    clearCompositeCache: vi.fn(),
    getRamPreviewRenderEngine: vi.fn(() => ({})),
    setGeneratingRamPreview: vi.fn(),
  },
}));

vi.mock('../../../src/services/timeline/ramPreviewRuntimeReporting', () => ({
  canRetainRamPreviewRunJob: vi.fn(() => ({ admitted: true })),
  createRamPreviewRunId: vi.fn(() => 'ram-preview-run-test'),
  releaseRamPreviewRunResources: vi.fn(),
  reportRamPreviewRunJob: vi.fn(),
}));

vi.mock('../../../src/services/ramPreviewEngine', () => ({
  RamPreviewEngine: class {
    async generate(
      options: { start: number },
      deps: {
        isCancelled: () => boolean;
        onFrameCached: (time: number) => void;
        onProgress: (percent: number) => void;
      },
    ) {
      if (deps.isCancelled()) {
        return { completed: false, frameCount: 0 };
      }
      deps.onProgress(42);
      deps.onFrameCached(options.start);
      return { completed: true, frameCount: 1 };
    }
  },
}));

function createRamPreviewTestStore(overrides: Partial<TimelineStore> = {}) {
  return createStore<TimelineStore>()((set, get) => ({
    tracks: [],
    clips: [],
    duration: 10,
    playheadPosition: 0,
    inPoint: null,
    outPoint: null,
    cachedFrameTimes: new Set<number>(),
    ramPreviewEnabled: true,
    ramPreviewProgress: null,
    ramPreviewRange: null,
    isRamPreviewing: false,
    clipVideoBakeProgress: null,
    isClipVideoBakeRendering: false,
    getSourceTimeForClip: () => 0,
    getInterpolatedSpeed: () => 1,
    ...createRamPreviewSlice(set, get),
    ...overrides,
  } as TimelineStore));
}

describe('createRamPreviewSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps clip video bake render progress separate from RAM preview state', async () => {
    const store = createRamPreviewTestStore();

    await expect(store.getState().startClipVideoBakeRenderRange(1, 2, {
      centerTime: 1.5,
      label: 'Bake clip video region',
    })).resolves.toBe(true);

    expect(store.getState()).toMatchObject({
      isRamPreviewing: false,
      ramPreviewProgress: null,
      ramPreviewRange: null,
      isClipVideoBakeRendering: false,
      clipVideoBakeProgress: null,
    });
    expect([...store.getState().cachedFrameTimes]).toEqual([1]);
    expect(renderHostPort.setGeneratingRamPreview).toHaveBeenNthCalledWith(1, true);
    expect(renderHostPort.setGeneratingRamPreview).toHaveBeenLastCalledWith(false);
  });

  it('publishes RAM preview range only for normal RAM preview generation', async () => {
    const store = createRamPreviewTestStore();

    await expect(store.getState().startRamPreviewForRange(3, 4, {
      centerTime: 3.5,
      label: 'RAM preview range',
    })).resolves.toBe(true);

    expect(store.getState()).toMatchObject({
      isRamPreviewing: false,
      ramPreviewProgress: null,
      ramPreviewRange: { start: 3, end: 4 },
      isClipVideoBakeRendering: false,
      clipVideoBakeProgress: null,
    });
  });
});
