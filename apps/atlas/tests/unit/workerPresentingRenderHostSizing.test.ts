import { describe, expect, it } from 'vitest';

import {
  bitmapSnapshotMaxSizeForPresentation,
  WORKER_PRESENTING_HIGH_FPS_PLAYBACK_SNAPSHOT_MAX_EDGE,
  WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_EDGE,
  WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE,
  type WorkerRenderTargetSizingRecord,
} from '../../src/services/render/workerPresentingRenderHostSizing';

function record(width: number, height: number): WorkerRenderTargetSizingRecord {
  return {
    target: {
      id: 'preview',
      compositionId: 'active',
      size: { x: width, y: height },
      devicePixelRatio: 1,
      showTransparencyGrid: false,
      presentation: 'offscreen-canvas',
    },
  };
}

describe('worker presenting render host sizing', () => {
  it('keeps idle snapshots at full target size', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), false, false)).toEqual({
      width: 1920,
      height: 1080,
    });
  });

  it('bounds playback snapshots to the playback max edge', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), false, true)).toEqual({
      width: WORKER_PRESENTING_PLAYBACK_SNAPSHOT_MAX_EDGE,
      height: 720,
    });
  });

  it('uses a tighter playback bound for high-fps compositions', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), false, true, 60)).toEqual({
      width: WORKER_PRESENTING_HIGH_FPS_PLAYBACK_SNAPSHOT_MAX_EDGE,
      height: 540,
    });
  });

  it('keeps small playback snapshots at target size', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(960, 540), false, true)).toEqual({
      width: 960,
      height: 540,
    });
  });

  it('uses the tighter scrub bound while scrubbing during playback', () => {
    expect(bitmapSnapshotMaxSizeForPresentation(record(1920, 1080), true, true)).toEqual({
      width: WORKER_PRESENTING_SCRUB_SNAPSHOT_MAX_EDGE,
      height: 540,
    });
  });
});
