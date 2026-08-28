import type { TimelineClip } from '../../../types';
import type {
  AudioAnalysisArtifactKind,
  ClipAudioAnalysisJobKind,
  ClipAudioAnalysisJobPhase,
} from '../../../types/audio';
import {
  createClipAudioAnalysisJobState,
  updateClipAudioAnalysisJobState,
} from '../../../services/audio/clipAudioAnalysisJobs';
import { isClipAudioAnalysisJobCancelledError } from '../../../services/audio/ClipAudioAnalysisJobService';
import { updateClipById } from '../helpers/clipStateHelpers';

export function createAudioAnalysisJobUpdate(input: {
  kind: ClipAudioAnalysisJobKind;
  label: string;
  artifactKinds: AudioAnalysisArtifactKind[];
  processed: boolean;
}): Pick<TimelineClip, 'audioAnalysisJob' | 'waveformGenerating' | 'waveformProgress'> {
  return {
    waveformGenerating: true,
    waveformProgress: 0,
    audioAnalysisJob: createClipAudioAnalysisJobState(input),
  };
}

export function updateAudioAnalysisJobProgress(
  clips: TimelineClip[],
  clipId: string,
  progress: number,
  phase: ClipAudioAnalysisJobPhase,
  message?: string,
): TimelineClip[] {
  const clip = clips.find(c => c.id === clipId);
  if (!clip?.audioAnalysisJob) {
    return updateClipById(clips, clipId, { waveformProgress: progress });
  }

  return updateClipById(clips, clipId, {
    waveformProgress: progress,
    audioAnalysisJob: updateClipAudioAnalysisJobState(clip.audioAnalysisJob, {
      progress,
      phase,
      message,
    }),
  });
}

export function clearAudioAnalysisJobUpdate(): Pick<
  TimelineClip,
  'audioAnalysisJob' | 'waveformGenerating'
> {
  return {
    audioAnalysisJob: undefined,
    waveformGenerating: false,
  };
}

export function isAudioAnalysisCancellation(error: unknown): boolean {
  if (isClipAudioAnalysisJobCancelledError(error)) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }
  const maybe = error as { name?: unknown; code?: unknown };
  return maybe.name === 'AbortError'
    || maybe.code === 'cancelled'
    || (typeof maybe.name === 'string' && maybe.name.includes('Cancelled'));
}

export async function resolveClipSourceFile(clip: TimelineClip): Promise<File | undefined> {
  if (clip.file instanceof File) {
    return clip.file;
  }

  const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
  if (!mediaFileId) return undefined;

  try {
    const { useMediaStore } = await import('../../mediaStore');
    const mediaFile = useMediaStore.getState().files.find(file => file.id === mediaFileId);
    return mediaFile?.file;
  } catch {
    return undefined;
  }
}
