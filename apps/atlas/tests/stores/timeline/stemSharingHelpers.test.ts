import { describe, expect, it } from 'vitest';
import type { ClipAudioStemState, TimelineClip, TimelineTrack } from '../../../src/types';
import { STEM_SOURCE_LAYER_ID } from '../../../src/services/audio/stemSeparation';
import { shareExistingStemStateWithClip } from '../../../src/stores/timeline/helpers/stemSharingHelpers';
import { createMockClip } from '../../helpers/mockData';

const TRACKS: TimelineTrack[] = [
  { id: 'audio-1', name: 'Audio 1', type: 'audio', height: 40, muted: false, visible: true, solo: false },
  { id: 'audio-2', name: 'Audio 2', type: 'audio', height: 40, muted: false, visible: true, solo: false },
];

const SOURCE_REFS = { waveformPyramidId: 'source-waveform' };
const PROCESSED_REFS = { processedWaveformPyramidId: 'processed-waveform' };

function createStemState(overrides: Partial<ClipAudioStemState> = {}): ClipAudioStemState {
  return {
    activeSetId: 'stem-set-1',
    modelId: 'demucs-htdemucs-web',
    modelVersion: 'test-model-v1',
    createdAt: 1_777_000_000_000,
    sourceFingerprint: 'sha256:source',
    range: { start: 0, end: 10 },
    sampleRate: 48_000,
    channelCount: 2,
    mixMode: 'stems',
    stems: [
      {
        id: 'stem-vocals',
        kind: 'vocals',
        label: 'Vocals',
        analysisArtifactId: 'analysis-vocals',
        manifestArtifactId: 'manifest-vocals',
        payloadRef: { artifactId: 'payload-vocals' },
        enabled: true,
        gainDb: 0,
        phaseAligned: true,
        modelId: 'demucs-htdemucs-web',
        sourceFingerprint: 'sha256:source',
      },
      {
        id: 'stem-drums',
        kind: 'drums',
        label: 'Drums',
        analysisArtifactId: 'analysis-drums',
        manifestArtifactId: 'manifest-drums',
        payloadRef: { artifactId: 'payload-drums' },
        enabled: false,
        gainDb: -3,
        phaseAligned: true,
        modelId: 'demucs-htdemucs-web',
        sourceFingerprint: 'sha256:source',
      },
    ],
    ...overrides,
  };
}

function createAudioClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return createMockClip({
    id: 'audio-clip',
    trackId: 'audio-1',
    file: new File([], 'dialog.wav', { type: 'audio/wav', lastModified: 123 }),
    source: { type: 'audio', naturalDuration: 10, mediaFileId: 'media-dialog' },
    duration: 10,
    inPoint: 0,
    outPoint: 10,
    ...overrides,
  });
}

describe('stem sharing helpers', () => {
  it('shares existing stems with a newly added same-source audio clip only', () => {
    const stemState = createStemState({ activeSetId: 'stem-set-existing' });
    const sourceClip = createAudioClip({
      id: 'audio-source',
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
        stemSeparation: stemState,
      },
    });
    const newClip = createAudioClip({
      id: 'audio-new',
      trackId: 'audio-2',
      audioState: {
        sourceAnalysisRefs: SOURCE_REFS,
        processedAnalysisRefs: PROCESSED_REFS,
      },
    });

    const result = shareExistingStemStateWithClip([sourceClip, newClip], TRACKS, 'audio-new');

    expect(result.changedCount).toBe(1);
    expect(result.sourceClipId).toBe('audio-source');
    expect(result.clips.find(clip => clip.id === 'audio-source')).toBe(sourceClip);

    const sharedStemState = result.clips.find(clip => clip.id === 'audio-new')?.audioState?.stemSeparation;
    expect(sharedStemState).toMatchObject({
      activeSetId: 'stem-set-existing',
      mixMode: 'original',
      soloStemId: STEM_SOURCE_LAYER_ID,
      sourceGainDb: 0,
    });
    expect(sharedStemState?.stems).toEqual(stemState.stems);
    expect(result.clips.find(clip => clip.id === 'audio-new')?.audioState?.processedAnalysisRefs).toBeUndefined();
  });

  it('matches duplicate files by stable file metadata when media ids are unavailable', () => {
    const sourceFile = new File([], 'dialog.wav', { type: 'audio/wav', lastModified: 456 });
    const duplicateFile = new File([], 'dialog.wav', { type: 'audio/wav', lastModified: 456 });
    const sourceClip = createAudioClip({
      id: 'audio-source',
      file: sourceFile,
      source: { type: 'audio', naturalDuration: 10 },
      audioState: {
        stemSeparation: createStemState(),
      },
    });
    const newClip = createAudioClip({
      id: 'audio-new',
      file: duplicateFile,
      source: { type: 'audio', naturalDuration: 10 },
    });

    const result = shareExistingStemStateWithClip([sourceClip, newClip], TRACKS, 'audio-new');

    expect(result.changedCount).toBe(1);
    expect(result.clips.find(clip => clip.id === 'audio-new')?.audioState?.stemSeparation?.activeSetId).toBe('stem-set-1');
  });

  it('keeps legacy source file matching behind the audio source identity helper', () => {
    const sourceFile = new File([], 'legacy-dialog.wav', { type: 'audio/wav', lastModified: 789 });
    const duplicateFile = new File([], 'legacy-dialog.wav', { type: 'audio/wav', lastModified: 789 });
    const sourceClip = createAudioClip({
      id: 'audio-source',
      file: undefined as unknown as File,
      source: { type: 'audio', naturalDuration: 10, file: sourceFile },
      audioState: {
        stemSeparation: createStemState(),
      },
    });
    const newClip = createAudioClip({
      id: 'audio-new',
      file: undefined as unknown as File,
      source: { type: 'audio', naturalDuration: 10, file: duplicateFile },
    });

    const result = shareExistingStemStateWithClip([sourceClip, newClip], TRACKS, 'audio-new');

    expect(result.changedCount).toBe(1);
    expect(result.clips.find(clip => clip.id === 'audio-new')?.audioState?.stemSeparation?.activeSetId).toBe('stem-set-1');
  });
});
