import type {
  ClipAudioEditOperation,
  SpectralImageLayer,
  VideoBakeRegion,
} from '../../../types';
import type {
  AudioSilenceDetectionOptions,
  AudioSilenceRange,
} from '../../../services/audio/audioSilenceDetection';
import type {
  AudioTransientDetectionOptions,
  AudioTransientRange,
} from '../../../services/audio/audioTransientDetection';

export interface TimelineAudioRegionSelection {
  clipId: string;
  trackId: string;
  startTime: number;
  endTime: number;
  sourceInPoint: number;
  sourceOutPoint: number;
  snappedToZeroCrossing?: boolean;
}

export interface TimelineSpectralRegionSelection extends TimelineAudioRegionSelection {
  frequencyMinHz: number;
  frequencyMaxHz: number;
  selectionMode?: 'rectangle' | 'brush';
  brushTimeRadiusSeconds?: number;
  brushFrequencyRadiusHz?: number;
}

export interface TimelineAudioRegionClipboard {
  sourceClipId: string;
  sourceTrackId: string;
  sourceMediaFileId?: string;
  sourceAudioRevisionId?: string;
  startTime: number;
  endTime: number;
  sourceInPoint: number;
  sourceOutPoint: number;
  duration: number;
  copiedAt: number;
}

export interface TimelineVideoBakeRegionSelection {
  scope: VideoBakeRegion['scope'];
  startTime: number;
  endTime: number;
  clipId?: string;
  trackId?: string;
  sourceInPoint?: number;
  sourceOutPoint?: number;
}

export type TimelineAudioRegionEditType = Extract<
  ClipAudioEditOperation['type'],
  | 'silence'
  | 'gain'
  | 'cut'
  | 'paste'
  | 'insert-silence'
  | 'delete-silence'
  | 'reverse'
  | 'invert-polarity'
  | 'swap-channels'
  | 'mono-sum'
  | 'split-stereo'
  | 'repair'
  | 'effect'
  | 'room-tone-fill'
>;

export type TimelineSpectralRegionEditType = Extract<
  ClipAudioEditOperation['type'],
  'spectral-mask' | 'spectral-resynthesis'
>;

export interface ApplyAudioRegionEditOptions {
  channelMask?: number[];
  keepSelection?: boolean;
  params?: ClipAudioEditOperation['params'];
}

export interface ApplyAudioRegionGainEditOptions {
  gainDb: number;
  fadeInSeconds?: number;
  fadeOutSeconds?: number;
  keepSelection?: boolean;
}

export interface SetClipAudioEditOperationRangeOptions {
  captureHistory?: boolean;
  historyLabel?: string;
}

export interface ApplyAudioRepairSuggestionInput {
  id: string;
  kind: string;
  label: string;
  severity?: string;
  confidence?: number;
  reason?: string;
  operation: {
    editType: Extract<ClipAudioEditOperation['type'], 'repair' | 'mono-sum'>;
    params?: ClipAudioEditOperation['params'];
  };
  evidence?: ClipAudioEditOperation['params'];
}

export interface ApplyDetectedSilenceRemovalOptions {
  detection?: AudioSilenceDetectionOptions;
  ranges?: AudioSilenceRange[];
  rippleTimeline?: boolean;
}

export interface ApplyRoomToneFillOptions {
  targetRange?: { start: number; end: number };
  sourceRanges?: AudioSilenceRange[];
  detection?: AudioSilenceDetectionOptions;
  gainDb?: number;
  crossfadeSeconds?: number;
}

export interface ApplyDetectedTransientSofteningOptions {
  detection?: AudioTransientDetectionOptions;
  ranges?: AudioTransientRange[];
  gainDb?: number;
  attackSeconds?: number;
  releaseSeconds?: number;
}

export interface ApplySpectralRegionEditOptions {
  channelMask?: number[];
  keepSelection?: boolean;
  params?: ClipAudioEditOperation['params'];
}

export type AddClipSpectralImageLayerInput = Omit<SpectralImageLayer, 'id'> & {
  id?: string;
};
