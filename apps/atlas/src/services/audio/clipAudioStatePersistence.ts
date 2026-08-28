import type { ClipAudioState } from '../../types';

export function cloneClipAudioStateWithoutStemSeparation(audioState: ClipAudioState | undefined): ClipAudioState | undefined {
  if (!audioState) return undefined;

  const { stemSeparation: _stemSeparation, ...rest } = audioState;
  return structuredClone(rest) as ClipAudioState;
}

export function clonePersistedClipAudioState(audioState: ClipAudioState | undefined): ClipAudioState | undefined {
  return cloneClipAudioStateWithoutStemSeparation(audioState);
}
