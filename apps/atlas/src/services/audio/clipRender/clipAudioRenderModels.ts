export type ClipAudioRenderParamValue = string | number | boolean | null;

export interface ClipAudioRenderKeyframe {
  id: string;
  clipId: string;
  time: number;
  property: string;
  value: number;
  easing: string;
  rotationInterpolation?: string;
  handleIn?: unknown;
  handleOut?: unknown;
  pathValue?: unknown;
}

export interface ClipAudioRenderSpectralImageLayerKeyframe {
  id: string;
  time: number;
  opacity?: number;
  gainDb?: number;
  frequencyMin?: number;
  frequencyMax?: number;
}

export interface ClipAudioRenderSpectralImageLayer {
  id: string;
  imageMediaFileId: string;
  timeStart: number;
  duration: number;
  frequencyMin: number;
  frequencyMax: number;
  opacity: number;
  enabled?: boolean;
  blendMode: 'attenuate' | 'boost' | 'gate' | 'sidechain-mask' | 'replace';
  gainDb: number;
  featherTime: number;
  featherFrequency: number;
  keyframes?: ClipAudioRenderSpectralImageLayerKeyframe[];
}

export interface ClipAudioRenderEditOperation {
  id: string;
  type:
    | 'trim'
    | 'cut'
    | 'gain'
    | 'silence'
    | 'copy'
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
    | 'spectral-mask'
    | 'spectral-resynthesis';
  enabled: boolean;
  params: Record<string, ClipAudioRenderParamValue>;
  timeRange?: { start: number; end: number };
  channelMask?: number[];
  createdAt: number;
}

export interface ClipAudioRenderClip {
  duration: number;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  speed?: number;
  preservesPitch?: boolean;
  audioState?: {
    muted?: boolean;
    stemSeparation?: unknown;
    spectralLayers?: ClipAudioRenderSpectralImageLayer[];
    editStack?: ClipAudioRenderEditOperation[];
    effectStack?: unknown[];
  };
  effects?: unknown[];
}

export interface ClipAudioRenderSpectralImageLayerMask {
  width: number;
  height: number;
  luminance: Float32Array;
  alpha?: Float32Array;
}
