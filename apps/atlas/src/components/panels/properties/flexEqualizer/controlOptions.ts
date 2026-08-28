import type {
  AudioEqAnalyzerMode,
  AudioEqBandType,
  AudioEqPresetKind,
} from '../../../../engine/audio/eq/AudioEqTypes';

export const BAND_TYPE_OPTIONS: Array<{ value: AudioEqBandType; label: string }> = [
  { value: 'bell', label: 'Bell' },
  { value: 'low-shelf', label: 'Low Shelf' },
  { value: 'high-shelf', label: 'High Shelf' },
  { value: 'low-cut', label: 'Low Cut' },
  { value: 'high-cut', label: 'High Cut' },
  { value: 'notch', label: 'Notch' },
  { value: 'band-pass', label: 'Band Pass' },
  { value: 'tilt-shelf', label: 'Tilt' },
  { value: 'all-pass', label: 'All Pass' },
];

export const PRESET_OPTIONS: Array<{ value: AudioEqPresetKind; label: string }> = [
  { value: '3-band', label: '3' },
  { value: '10-band-graphic', label: '10' },
  { value: 'parametric', label: 'Param' },
  { value: 'mastering', label: 'Master' },
  { value: 'custom', label: 'Custom' },
];

export const ANALYZER_VIEW_OPTIONS: Array<{ value: AudioEqAnalyzerMode; label: string }> = [
  { value: 'pre', label: 'Source' },
  { value: 'post', label: 'EQ' },
  { value: 'pre-post', label: 'Both' },
];
