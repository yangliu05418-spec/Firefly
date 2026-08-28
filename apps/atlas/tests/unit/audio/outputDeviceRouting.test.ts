import { describe, expect, it, vi } from 'vitest';
import {
  applyAudioContextOutputDevice,
  applyMediaElementOutputDevice,
} from '../../../src/services/audio/routing/outputDeviceRouting';

describe('output device routing helpers', () => {
  it('applies an AudioContext sink id when the browser supports it', async () => {
    const setSinkId = vi.fn(async () => undefined);
    const onError = vi.fn();

    const applied = await applyAudioContextOutputDevice(
      { setSinkId } as unknown as AudioContext,
      'speaker-1',
      onError,
    );

    expect(applied).toBe(true);
    expect(setSinkId).toHaveBeenCalledWith('speaker-1');
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports unsupported media-element routing without throwing', async () => {
    const applied = await applyMediaElementOutputDevice(
      {} as HTMLMediaElement,
      'speaker-1',
      vi.fn(),
    );

    expect(applied).toBe(false);
  });

  it('reports sink errors through the supplied handler', async () => {
    const error = new Error('denied');
    const onError = vi.fn();
    const applied = await applyMediaElementOutputDevice(
      { setSinkId: vi.fn(async () => { throw error; }) } as unknown as HTMLMediaElement,
      'speaker-1',
      onError,
    );

    expect(applied).toBe(false);
    expect(onError).toHaveBeenCalledWith('Failed to apply media output device:', error);
  });
});
