import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { createMockClip, resetIdCounter } from '../helpers/mockData';
import { createTestTimelineStore } from '../helpers/storeFactory';

const propertyConfig = { numRuns: 100, seed: 20260519 };

const toSeconds = (ticks: number) => ticks / 10;

const clipTiming = fc.record({
  startTicks: fc.integer({ min: 0, max: 600 }),
  durationTicks: fc.integer({ min: 2, max: 600 }),
  inTicks: fc.integer({ min: 0, max: 1_000 }),
});

const validTrim = fc
  .record({
    inTicks: fc.integer({ min: 0, max: 1_000 }),
    durationTicks: fc.integer({ min: 1, max: 600 }),
  })
  .map(({ inTicks, durationTicks }) => ({
    inPoint: toSeconds(inTicks),
    outPoint: toSeconds(inTicks + durationTicks),
  }));

const moveCase = fc.record({
  startTicks: fc.integer({ min: 0, max: 600 }),
  durationTicks: fc.integer({ min: 1, max: 600 }),
  requestedStartTicks: fc.integer({ min: -600, max: 600 }),
});

function expectBidirectionalLinks(clips: Array<{ id: string; linkedClipId?: string }>) {
  for (const clip of clips) {
    expect(clip.linkedClipId).toBeDefined();
    const linked = clips.find((candidate) => candidate.id === clip.linkedClipId);
    expect(linked).toBeDefined();
    expect(linked!.linkedClipId).toBe(clip.id);
  }
}

describe('clipSlice property invariants', () => {
  it('splitClip preserves local clip duration and source continuity for valid interior splits', () => {
    fc.assert(
      fc.property(
        clipTiming,
        fc.integer({ min: 1, max: 599 }),
        ({ startTicks, durationTicks, inTicks }, splitOffsetTicks) => {
          fc.pre(splitOffsetTicks < durationTicks);
          resetIdCounter();

          const startTime = toSeconds(startTicks);
          const duration = toSeconds(durationTicks);
          const inPoint = toSeconds(inTicks);
          const outPoint = inPoint + duration;
          const splitTime = startTime + toSeconds(splitOffsetTicks);
          const clip = createMockClip({
            id: 'clip-1',
            trackId: 'video-1',
            startTime,
            duration,
            inPoint,
            outPoint,
          });
          const store = createTestTimelineStore({ clips: [clip] });

          store.getState().splitClip('clip-1', splitTime);

          const clips = [...store.getState().clips].sort((a, b) => a.startTime - b.startTime);
          expect(clips).toHaveLength(2);

          const [first, second] = clips;
          expect(first.startTime).toBeCloseTo(startTime, 10);
          expect(second.startTime).toBeCloseTo(splitTime, 10);
          expect(first.duration + second.duration).toBeCloseTo(duration, 10);
          expect(first.startTime + first.duration).toBeCloseTo(second.startTime, 10);

          expect(first.inPoint).toBeCloseTo(inPoint, 10);
          expect(first.outPoint).toBeCloseTo(second.inPoint, 10);
          expect(second.outPoint).toBeCloseTo(outPoint, 10);
          expect((first.outPoint - first.inPoint) + (second.outPoint - second.inPoint)).toBeCloseTo(outPoint - inPoint, 10);
        },
      ),
      propertyConfig,
    );
  });

  it('splitClip at an edge or outside the clip does not add or remove clips', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      fc.assert(
        fc.property(
          clipTiming,
          fc.constantFrom<'start' | 'end' | 'before' | 'after'>('start', 'end', 'before', 'after'),
          ({ startTicks, durationTicks, inTicks }, splitKind) => {
            resetIdCounter();

            const startTime = toSeconds(startTicks);
            const duration = toSeconds(durationTicks);
            const inPoint = toSeconds(inTicks);
            const clip = createMockClip({
              id: 'clip-1',
              trackId: 'video-1',
              startTime,
              duration,
              inPoint,
              outPoint: inPoint + duration,
            });
            const splitTime = {
              start: startTime,
              end: startTime + duration,
              before: Math.max(0, startTime - 0.1),
              after: startTime + duration + 0.1,
            }[splitKind];
            const store = createTestTimelineStore({ clips: [clip] });

            store.getState().splitClip('clip-1', splitTime);

            expect(store.getState().clips).toHaveLength(1);
            expect(store.getState().clips[0].id).toBe('clip-1');
          },
        ),
        propertyConfig,
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('trimClip sets duration to outPoint minus inPoint for valid trims', () => {
    fc.assert(
      fc.property(validTrim, ({ inPoint, outPoint }) => {
        resetIdCounter();

        const clip = createMockClip({
          id: 'clip-1',
          trackId: 'video-1',
          startTime: 3,
          duration: 10,
          inPoint: 0,
          outPoint: 10,
        });
        const store = createTestTimelineStore({ clips: [clip] });

        store.getState().trimClip('clip-1', inPoint, outPoint);

        const trimmed = store.getState().clips.find((candidate) => candidate.id === 'clip-1')!;
        expect(trimmed.inPoint).toBe(inPoint);
        expect(trimmed.outPoint).toBe(outPoint);
        expect(trimmed.duration).toBeCloseTo(outPoint - inPoint, 10);
        expect(trimmed.duration).toBeGreaterThanOrEqual(0);
      }),
      propertyConfig,
    );
  });

  it('moveClip clamps startTime to zero or later while preserving unrelated clip fields', () => {
    fc.assert(
      fc.property(moveCase, ({ startTicks, durationTicks, requestedStartTicks }) => {
        resetIdCounter();

        const clip = createMockClip({
          id: 'clip-1',
          trackId: 'video-1',
          name: 'Stable fields',
          startTime: toSeconds(startTicks),
          duration: toSeconds(durationTicks),
          inPoint: 1,
          outPoint: 1 + toSeconds(durationTicks),
          linkedGroupId: 'group-keep',
          parentClipId: 'parent-keep',
          source: { type: 'video', naturalDuration: 100 },
        });
        const before = { ...clip, transform: clip.transform, effects: clip.effects };
        const store = createTestTimelineStore({ clips: [clip], snappingEnabled: false });

        store.getState().moveClip('clip-1', toSeconds(requestedStartTicks));

        const moved = store.getState().clips.find((candidate) => candidate.id === 'clip-1')!;
        expect(moved.startTime).toBeGreaterThanOrEqual(0);
        expect(moved.id).toBe(before.id);
        expect(moved.trackId).toBe(before.trackId);
        expect(moved.name).toBe(before.name);
        expect(moved.duration).toBe(before.duration);
        expect(moved.inPoint).toBe(before.inPoint);
        expect(moved.outPoint).toBe(before.outPoint);
        expect(moved.linkedGroupId).toBe(before.linkedGroupId);
        expect(moved.parentClipId).toBe(before.parentClipId);
        expect(moved.source).toEqual(before.source);
        expect(moved.transform).toEqual(before.transform);
        expect(moved.effects).toEqual(before.effects);
      }),
      propertyConfig,
    );
  });

  it('moveClip keeps linked clips time-synced when moving the primary clip', () => {
    fc.assert(
      fc.property(moveCase, ({ startTicks, durationTicks, requestedStartTicks }) => {
        resetIdCounter();

        const startTime = toSeconds(startTicks);
        const duration = toSeconds(durationTicks);
        const videoClip = createMockClip({
          id: 'clip-v',
          trackId: 'video-1',
          startTime,
          duration,
          inPoint: 0,
          outPoint: duration,
          source: { type: 'video', naturalDuration: duration },
          linkedClipId: 'clip-a',
        });
        const audioClip = createMockClip({
          id: 'clip-a',
          trackId: 'audio-1',
          startTime,
          duration,
          inPoint: 0,
          outPoint: duration,
          source: { type: 'audio', naturalDuration: duration },
          linkedClipId: 'clip-v',
        });
        const store = createTestTimelineStore({ clips: [videoClip, audioClip], snappingEnabled: false });

        store.getState().moveClip('clip-v', toSeconds(requestedStartTicks));

        const movedVideo = store.getState().clips.find((clip) => clip.id === 'clip-v')!;
        const movedAudio = store.getState().clips.find((clip) => clip.id === 'clip-a')!;
        expect(movedVideo.startTime).toBeGreaterThanOrEqual(0);
        expect(movedAudio.startTime).toBeGreaterThanOrEqual(0);
        expect(movedAudio.startTime).toBeCloseTo(movedVideo.startTime, 10);
        expectBidirectionalLinks([movedVideo, movedAudio]);
      }),
      propertyConfig,
    );
  });

  it('splitClip keeps linked split pairs bidirectionally linked and duration-aligned', () => {
    fc.assert(
      fc.property(
        clipTiming,
        fc.integer({ min: 1, max: 599 }),
        ({ startTicks, durationTicks, inTicks }, splitOffsetTicks) => {
          fc.pre(splitOffsetTicks < durationTicks);
          resetIdCounter();

          const startTime = toSeconds(startTicks);
          const duration = toSeconds(durationTicks);
          const inPoint = toSeconds(inTicks);
          const splitTime = startTime + toSeconds(splitOffsetTicks);
          const videoClip = createMockClip({
            id: 'clip-v',
            trackId: 'video-1',
            startTime,
            duration,
            inPoint,
            outPoint: inPoint + duration,
            source: { type: 'video', naturalDuration: duration },
            linkedClipId: 'clip-a',
          });
          const audioClip = createMockClip({
            id: 'clip-a',
            trackId: 'audio-1',
            startTime,
            duration,
            inPoint,
            outPoint: inPoint + duration,
            source: { type: 'audio', naturalDuration: duration },
            linkedClipId: 'clip-v',
          });
          const store = createTestTimelineStore({ clips: [videoClip, audioClip] });

          store.getState().splitClip('clip-v', splitTime);

          const clips = store.getState().clips;
          const videoParts = clips.filter((clip) => clip.trackId === 'video-1').sort((a, b) => a.startTime - b.startTime);
          const audioParts = clips.filter((clip) => clip.trackId === 'audio-1').sort((a, b) => a.startTime - b.startTime);

          expect(clips).toHaveLength(4);
          expect(videoParts).toHaveLength(2);
          expect(audioParts).toHaveLength(2);
          expectBidirectionalLinks(clips);

          for (let index = 0; index < 2; index += 1) {
            expect(videoParts[index].startTime).toBeCloseTo(audioParts[index].startTime, 10);
            expect(videoParts[index].duration).toBeCloseTo(audioParts[index].duration, 10);
            expect(videoParts[index].linkedClipId).toBe(audioParts[index].id);
            expect(audioParts[index].linkedClipId).toBe(videoParts[index].id);
          }
        },
      ),
      propertyConfig,
    );
  });
});
