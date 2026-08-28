import type { TimelineClip } from '../../types';
import type { CompositionAudioMixdownRequestResult } from './compositionAudioMixdownCache';

export function setCompositionAudioMixdownGenerating(
  clips: readonly TimelineClip[],
  clipId: string,
  mixdownGenerating: boolean,
): TimelineClip[] {
  return clips.map((clip) => (
    clip.id === clipId ? { ...clip, mixdownGenerating } : clip
  ));
}

export function applyCompositionAudioMixdownToClips(
  clips: readonly TimelineClip[],
  clipId: string,
  result: CompositionAudioMixdownRequestResult,
  options: { audioElement?: HTMLAudioElement } = {},
): TimelineClip[] {
  return clips.map((clip) => {
    if (clip.id !== clipId) return clip;
    const audioSource = clip.source?.type === 'audio'
      ? {
          ...clip.source,
          ...(options.audioElement ? { audioElement: options.audioElement } : {}),
          naturalDuration: result.duration,
        }
      : clip.source;

    return {
      ...clip,
      source: audioSource,
      ...(clip.source?.type !== 'audio' && options.audioElement ? { mixdownAudio: options.audioElement } : {}),
      mixdownBuffer: result.hasAudio ? result.buffer : undefined,
      mixdownWaveform: result.hasAudio ? result.waveform : undefined,
      waveform: result.hasAudio && clip.source?.type === 'audio' ? result.waveform : clip.waveform,
      mixdownGenerating: false,
      hasMixdownAudio: result.hasAudio,
    };
  });
}
