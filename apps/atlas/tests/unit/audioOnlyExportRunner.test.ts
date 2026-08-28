import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runAudioOnlyExport } from '../../src/components/export/runners/audioOnlyExportRunner';

const mocks = vi.hoisted(() => {
  const instances: unknown[] = [];
  const encodeAudioBufferToMp3Blob = vi.fn(async () => new Blob(['mp3'], { type: 'audio/mpeg' }));
  const encodeAudioBufferToWavBlob = vi.fn(() => new Blob(['wav'], { type: 'audio/wav' }));

  class MockAudioExportPipeline {
    cancel = vi.fn();
    exportAudio = vi.fn(async () => null);
    exportRawAudio = vi.fn(async () => ({ length: 128 }) as AudioBuffer);

    constructor() {
      instances.push(this);
    }
  }

  return {
    MockAudioExportPipeline,
    encodeAudioBufferToMp3Blob,
    encodeAudioBufferToWavBlob,
    instances,
  };
});

vi.mock('../../src/engine/audio', () => ({
  AudioExportPipeline: mocks.MockAudioExportPipeline,
  encodeAudioBufferToMp3Blob: mocks.encodeAudioBufferToMp3Blob,
  encodeAudioBufferToWavBlob: mocks.encodeAudioBufferToWavBlob,
}));

vi.mock('../../src/services/timeline/exportRuntimeReporting', () => ({
  canRetainExportRunJob: vi.fn(() => ({ admitted: true })),
  createExportRunId: vi.fn(() => 'export-run-a'),
  releaseExportRunResources: vi.fn(),
  reportExportRunJob: vi.fn(),
}));

function createRunnerInput(overrides: Partial<Parameters<typeof runAudioOnlyExport>[0]> = {}): Parameters<typeof runAudioOnlyExport>[0] {
  return {
    width: 1920,
    height: 1080,
    fps: 30,
    startTime: 0,
    endTime: 10,
    filename: 'mixdown',
    encoder: 'webcodecs',
    videoCodec: 'h264',
    containerFormat: 'mp4',
    bitrate: 8_000_000,
    audioOnlyFormat: 'mp3',
    audioSampleRate: 48000,
    audioBitrate: 256_000,
    normalizeAudio: false,
    audioPipelineRef: { current: null },
    onProgress: vi.fn(),
    onTimelineStart: vi.fn(),
    onTimelineProgress: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.instances.length = 0;
  mocks.encodeAudioBufferToMp3Blob.mockReset();
  mocks.encodeAudioBufferToMp3Blob.mockResolvedValue(new Blob(['mp3'], { type: 'audio/mpeg' }));
  mocks.encodeAudioBufferToWavBlob.mockClear();
});

describe('runAudioOnlyExport', () => {
  it('suppresses MP3 download when the export is cancelled while encoding', async () => {
    const cancelledRef = { current: false };
    mocks.encodeAudioBufferToMp3Blob.mockImplementation(async () => {
      cancelledRef.current = true;
      return new Blob(['late-mp3'], { type: 'audio/mpeg' });
    });

    const result = await runAudioOnlyExport(createRunnerInput({ cancelledRef }));

    expect(result).toEqual({ kind: 'cancelled' });
    expect(mocks.encodeAudioBufferToMp3Blob).toHaveBeenCalledTimes(1);
  });
});
