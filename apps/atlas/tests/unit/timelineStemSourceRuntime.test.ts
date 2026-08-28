import { describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';

vi.mock('../../src/services/audioRoutingManager', () => ({
  audioRoutingManager: {
    disposeRoute: vi.fn(),
  },
}));

vi.mock('../../src/services/layerBuilder/PlayheadState', () => ({
  playheadState: {
    masterAudioElement: null,
  },
  clearMasterAudio: vi.fn(),
}));

import { audioRoutingManager } from '../../src/services/audioRoutingManager';
import { clearMasterAudio, playheadState } from '../../src/services/layerBuilder/PlayheadState';
import {
  disposeTimelineStemSourceAudioElement,
  getTimelineStemSourceAudioElement,
} from '../../src/services/timeline/timelineStemSourceRuntime';

describe('timeline stem source runtime', () => {
  it('resolves legacy audio source elements for stem source replacement', () => {
    const audio = document.createElement('audio');
    const clip = {
      source: {
        type: 'audio',
        audioElement: audio,
      },
    } as TimelineClip;

    expect(getTimelineStemSourceAudioElement(clip)).toBe(audio);
    expect(getTimelineStemSourceAudioElement({ source: null })).toBeUndefined();
  });

  it('disposes replaced audio source elements and clears master audio ownership', () => {
    const audio = document.createElement('audio');
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
    playheadState.masterAudioElement = audio;

    disposeTimelineStemSourceAudioElement(audio);

    expect(pause).toHaveBeenCalled();
    expect(audioRoutingManager.disposeRoute).toHaveBeenCalledWith(audio);
    expect(clearMasterAudio).toHaveBeenCalled();
  });
});
