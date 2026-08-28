import type { AudioEditPreviewPhase } from '../../../../services/audio/AudioEditPreviewService';
import type { AudioRepairPreviewPhase } from '../../../../services/audio/AudioRepairPreviewService';
import type { AudioSilenceRange } from '../../../../services/audio/audioSilenceDetection';
import type { AudioTransientRange } from '../../../../services/audio/audioTransientDetection';

export interface RepairPreviewUiState {
  suggestionId: string;
  phase: AudioRepairPreviewPhase;
  message?: string;
}

export interface EditPreviewUiState {
  previewId: string;
  phase: AudioEditPreviewPhase;
  message?: string;
}

export interface SilenceCleanupUiState {
  phase: 'idle' | 'analyzing' | 'ready' | 'applying' | 'error';
  ranges: AudioSilenceRange[];
  message?: string;
}

export interface TransientCleanupUiState {
  phase: 'idle' | 'analyzing' | 'ready' | 'applying' | 'error';
  ranges: AudioTransientRange[];
  message?: string;
}
