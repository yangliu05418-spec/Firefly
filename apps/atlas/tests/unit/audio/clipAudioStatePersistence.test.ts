import { describe, expect, it } from 'vitest';
import { clonePersistedClipAudioState } from '../../../src/services/audio/clipAudioStatePersistence';
import type { ClipAudioState } from '../../../src/types';

describe('clip audio state persistence', () => {
  it('keeps generated stem state detached from persisted clip audio state', () => {
    const audioState: ClipAudioState = {
      sourceAudioRevisionId: 'source-revision',
      stemSeparation: {
        activeSetId: 'stem-set',
        modelId: 'demucs-htdemucs-web',
        modelVersion: 'test',
        createdAt: 1,
        sourceFingerprint: 'sha256:source',
        range: { start: 0, end: 10 },
        sampleRate: 48_000,
        channelCount: 2,
        mixMode: 'hybrid',
        soloStemId: 'stem-drums',
        sourceGainDb: -3,
        stems: [
          {
            id: 'stem-drums',
            kind: 'drums',
            label: 'Drums',
            analysisArtifactId: 'analysis-drums',
            manifestArtifactId: 'manifest-drums',
            payloadRef: { artifactId: 'payload-drums' },
            mediaFileId: 'media-drums',
            waveform: [0.12345, 0.8, 1.2, -0.1],
            enabled: false,
            gainDb: 4,
            phaseAligned: true,
            modelId: 'demucs-htdemucs-web',
            sourceFingerprint: 'sha256:source',
          },
        ],
      },
    };

    const persisted = clonePersistedClipAudioState(audioState);

    expect(persisted).toEqual({ sourceAudioRevisionId: 'source-revision' });
  });
});
