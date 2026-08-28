import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { Logger } from '../../logger';
import type {
  AudioRecordingCommitDependencies,
  AudioRecordingCommitResult,
  AudioRecordingStopResult,
} from '../AudioRecordingService';

const log = Logger.create('AudioRecordingService');

function isAudioMediaFile(value: unknown): value is MediaFile {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as MediaFile).type === 'audio' &&
    typeof (value as MediaFile).id === 'string',
  );
}

export async function commitAudioRecordingResultToTimeline(
  result: AudioRecordingStopResult,
  deps: AudioRecordingCommitDependencies = {},
): Promise<AudioRecordingCommitResult> {
  const mediaStore = deps.importFile ? null : useMediaStore.getState();
  const timelineStore = deps.addClip && deps.generateWaveformForClip && deps.generateLoudnessForClip
    ? null
    : useTimelineStore.getState();
  const importFile = deps.importFile ?? mediaStore!.importFile.bind(mediaStore);
  const addClip = deps.addClip ?? timelineStore!.addClip.bind(timelineStore);
  const generateWaveformForClip = deps.generateWaveformForClip ?? timelineStore!.generateWaveformForClip.bind(timelineStore);
  const generateLoudnessForClip = deps.generateLoudnessForClip ?? timelineStore!.generateLoudnessForClip.bind(timelineStore);
  const clips: AudioRecordingCommitResult['clips'] = [];

  for (const asset of result.assets) {
    const imported = await importFile(asset.file, null, {
      forceCopyToProject: true,
      projectFileName: asset.file.name,
    });
    if (!isAudioMediaFile(imported)) {
      throw new Error(`Recorded file "${asset.file.name}" did not import as an audio media file.`);
    }

    const sourceFile = imported.file ?? asset.file;
    for (const trackId of asset.trackIds) {
      const clipId = await addClip(
        trackId,
        sourceFile,
        asset.startTime,
        asset.duration,
        imported.id,
        'audio',
        { name: asset.file.name },
      );
      if (!clipId) continue;

      clips.push({
        clipId,
        trackId,
        mediaFileId: imported.id,
        fileName: asset.file.name,
      });
      void generateWaveformForClip(clipId).catch(error => {
        log.warn('Recorded waveform generation failed', { clipId, error });
      });
      void generateLoudnessForClip(clipId).catch(error => {
        log.warn('Recorded loudness generation failed', { clipId, error });
      });
    }
  }

  return { sessionId: result.sessionId, clips };
}
