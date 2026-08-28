import { describe, expect, it } from 'vitest';
import { expandTimelineMarqueeClipSelection } from '../../../src/components/timeline/hooks/useMarqueeSelection';

describe('marquee clip selection', () => {
  it('includes linked audio clips when marquee selects linked video clips', () => {
    const clips = [
      { id: 'video-1', linkedClipId: 'audio-1' },
      { id: 'audio-1', linkedClipId: 'video-1' },
      { id: 'video-2', linkedClipId: 'audio-2' },
      { id: 'audio-2', linkedClipId: 'video-2' },
    ];

    expect(expandTimelineMarqueeClipSelection(['video-1', 'video-2'], clips)).toEqual([
      'video-1',
      'video-2',
      'audio-1',
      'audio-2',
    ]);
  });
});
