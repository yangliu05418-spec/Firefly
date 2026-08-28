import { normalizeEasingType } from '../../../utils/easing';
import {
  getAudioEffect,
  getAudioEffectDefaultParams,
  getAudioEffectParamNames,
  type AudioEffectId,
  type AudioEffectParamValue,
} from '../AudioEffectRegistry';
import { createBufferLike } from '../audioBufferFactory';

export const AUDIO_EQ_EFFECT_ID = 'audio-eq' satisfies AudioEffectId;
export const AUDIO_VOLUME_EFFECT_ID = 'audio-volume' satisfies AudioEffectId;
export const AUDIO_PAN_EFFECT_ID = 'audio-pan' satisfies AudioEffectId;
export const AUDIO_NORMALIZE_EFFECT_ID = 'audio-normalize' satisfies AudioEffectId;
export const AUDIO_PARAMETRIC_EQ_EFFECT_ID = 'audio-parametric-eq' satisfies AudioEffectId;
export const AUDIO_HIGH_PASS_EFFECT_ID = 'audio-high-pass' satisfies AudioEffectId;
export const AUDIO_LOW_PASS_EFFECT_ID = 'audio-low-pass' satisfies AudioEffectId;
export const AUDIO_HUM_NOTCH_EFFECT_ID = 'audio-hum-notch' satisfies AudioEffectId;
export const AUDIO_DE_CLICK_EFFECT_ID = 'audio-de-click' satisfies AudioEffectId;
export const AUDIO_NOISE_REDUCTION_EFFECT_ID = 'audio-noise-reduction' satisfies AudioEffectId;
export const AUDIO_SPECTRAL_GATE_EFFECT_ID = 'audio-spectral-gate' satisfies AudioEffectId;
export const AUDIO_COMPRESSOR_EFFECT_ID = 'audio-compressor' satisfies AudioEffectId;
export const AUDIO_DE_ESSER_EFFECT_ID = 'audio-de-esser' satisfies AudioEffectId;
export const AUDIO_LIMITER_EFFECT_ID = 'audio-limiter' satisfies AudioEffectId;
export const AUDIO_NOISE_GATE_EFFECT_ID = 'audio-noise-gate' satisfies AudioEffectId;
export const AUDIO_EXPANDER_EFFECT_ID = 'audio-expander' satisfies AudioEffectId;
export const AUDIO_DELAY_EFFECT_ID = 'audio-delay' satisfies AudioEffectId;
export const AUDIO_REVERB_EFFECT_ID = 'audio-reverb' satisfies AudioEffectId;
export const AUDIO_SATURATION_EFFECT_ID = 'audio-saturation' satisfies AudioEffectId;
export const AUDIO_POLARITY_INVERT_EFFECT_ID = 'audio-polarity-invert' satisfies AudioEffectId;
export const AUDIO_MONO_SUM_EFFECT_ID = 'audio-mono-sum' satisfies AudioEffectId;
export const AUDIO_CHANNEL_SWAP_EFFECT_ID = 'audio-channel-swap' satisfies AudioEffectId;
export const AUDIO_STEREO_SPLIT_EFFECT_ID = 'audio-stereo-split' satisfies AudioEffectId;
export const AUDIO_VOLUME_PARAM = getAudioEffectParamNames(AUDIO_VOLUME_EFFECT_ID)[0] ?? 'volume';

export const LEGACY_AUDIO_EFFECT_RENDER_ORDER = [
  AUDIO_HIGH_PASS_EFFECT_ID,
  AUDIO_LOW_PASS_EFFECT_ID,
  AUDIO_HUM_NOTCH_EFFECT_ID,
  AUDIO_DE_CLICK_EFFECT_ID,
  AUDIO_NOISE_REDUCTION_EFFECT_ID,
  AUDIO_SPECTRAL_GATE_EFFECT_ID,
  AUDIO_EQ_EFFECT_ID,
  AUDIO_PARAMETRIC_EQ_EFFECT_ID,
  AUDIO_DE_ESSER_EFFECT_ID,
  AUDIO_COMPRESSOR_EFFECT_ID,
  AUDIO_NOISE_GATE_EFFECT_ID,
  AUDIO_EXPANDER_EFFECT_ID,
  AUDIO_DELAY_EFFECT_ID,
  AUDIO_REVERB_EFFECT_ID,
  AUDIO_SATURATION_EFFECT_ID,
  AUDIO_POLARITY_INVERT_EFFECT_ID,
  AUDIO_MONO_SUM_EFFECT_ID,
  AUDIO_CHANNEL_SWAP_EFFECT_ID,
  AUDIO_STEREO_SPLIT_EFFECT_ID,
  AUDIO_NORMALIZE_EFFECT_ID,
  AUDIO_LIMITER_EFFECT_ID,
  AUDIO_PAN_EFFECT_ID,
  AUDIO_VOLUME_EFFECT_ID,
] as const satisfies readonly AudioEffectId[];

const DEFAULT_PARAM_EPSILON = 0.001;

export interface EffectRenderKeyframe {
  property: string;
  time: number;
  value: number;
  easing?: string;
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export interface RenderableAudioEffectInstance {
  id: string;
  descriptorId: string;
  enabled?: boolean;
  params?: Record<string, AudioEffectParamValue>;
  bypassed?: boolean;
  disabled?: boolean;
}

export function hasRenderableAudioEffect(effect: RenderableAudioEffectInstance): boolean {
  return effect.enabled !== false &&
    effect.disabled !== true &&
    effect.bypassed !== true &&
    getAudioEffect(effect.descriptorId) !== undefined;
}

export function dbToLinearGain(db: number): number {
  if (!Number.isFinite(db)) return 1;
  return Math.pow(10, db / 20);
}

export function linearToDb(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return -Infinity;
  return 20 * Math.log10(value);
}

export function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function automateParam(
  param: AudioParam,
  keyframes: EffectRenderKeyframe[],
  defaultValue: number,
  duration: number
): void {
  if (keyframes.length === 0) {
    param.setValueAtTime(defaultValue, 0);
    return;
  }

  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // Set initial value at time 0
  if (sorted[0].time > 0) {
    // Interpolate value at time 0
    const valueAt0 = interpolateValue(sorted, 0, defaultValue);
    param.setValueAtTime(valueAt0, 0);
  }

  // Process each keyframe
  for (let i = 0; i < sorted.length; i++) {
    const kf = sorted[i];
    const time = Math.max(0, kf.time);

    // Ensure gain values are positive (required for exponential ramp)
    const value = kf.property.includes('volume')
      ? Math.max(0.0001, kf.value)
      : kf.value;

    if (i === 0) {
      // First keyframe - set initial value
      param.setValueAtTime(value, time);
    } else {
      // Subsequent keyframes - ramp to value
      const prevKf = sorted[i - 1];

      switch (normalizeEasingType(kf.easing, 'linear')) {
        case 'linear':
          param.linearRampToValueAtTime(value, time);
          break;

        case 'ease-in':
        case 'ease-out':
        case 'ease-in-out':
          // Approximate with exponential for smooth curves
          // Only use exponential if value > 0
          if (value > 0 && param.value > 0) {
            param.exponentialRampToValueAtTime(Math.max(0.0001, value), time);
          } else {
            param.linearRampToValueAtTime(value, time);
          }
          break;

        case 'bezier':
          // For bezier, sample the curve at multiple points
          automateBezier(param, prevKf, kf);
          break;

        default:
          // Step/hold
          param.setValueAtTime(value, time);
      }
    }
  }

  // Hold last value until end
  const lastKf = sorted[sorted.length - 1];
  if (lastKf.time < duration) {
    param.setValueAtTime(lastKf.value, lastKf.time);
  }
}

export function automateBezier(
  param: AudioParam,
  prevKf: EffectRenderKeyframe,
  kf: EffectRenderKeyframe
): void {
  // Sample bezier curve at multiple points
  const numSamples = 10;
  const duration = kf.time - prevKf.time;

  for (let i = 1; i <= numSamples; i++) {
    const t = i / numSamples;
    const time = prevKf.time + t * duration;

    // Interpolate using the keyframe interpolation utility
    // This handles bezier handles properly
    const value = bezierInterpolate(prevKf, kf, t);

    param.linearRampToValueAtTime(value, time);
  }
}

export function bezierInterpolate(prevKf: EffectRenderKeyframe, kf: EffectRenderKeyframe, t: number): number {
  // If no handles, use linear
  if (!prevKf.handleOut && !kf.handleIn) {
    return prevKf.value + (kf.value - prevKf.value) * t;
  }

  // Cubic bezier with handles
  const p0 = prevKf.value;
  const p3 = kf.value;

  // Handle positions (time, value) relative to keyframe
  const h1 = prevKf.handleOut || { x: 0.33, y: 0 };
  const h2 = kf.handleIn || { x: -0.33, y: 0 };

  // Convert to absolute values
  const valueDiff = p3 - p0;
  const p1 = p0 + h1.y * valueDiff;
  const p2 = p3 + h2.y * valueDiff;

  // Cubic bezier formula
  const mt = 1 - t;
  return mt * mt * mt * p0 +
         3 * mt * mt * t * p1 +
         3 * mt * t * t * p2 +
         t * t * t * p3;
}

export function interpolateValue(keyframes: EffectRenderKeyframe[], time: number, defaultValue: number): number {
  if (keyframes.length === 0) return defaultValue;
  return interpolateSortedValue([...keyframes].sort((a, b) => a.time - b.time), time, defaultValue);
}

export function interpolateSortedValue(sorted: readonly EffectRenderKeyframe[], time: number, defaultValue: number): number {
  if (sorted.length === 0) return defaultValue;
  // Before first keyframe
  if (time <= sorted[0].time) {
    return sorted[0].value;
  }

  // After last keyframe
  if (time >= sorted[sorted.length - 1].time) {
    return sorted[sorted.length - 1].value;
  }

  // Find surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      const t = (time - sorted[i].time) / (sorted[i + 1].time - sorted[i].time);
      return sorted[i].value + (sorted[i + 1].value - sorted[i].value) * t;
    }
  }

  return defaultValue;
}

export function hasEffectKeyframes(keyframes: EffectRenderKeyframe[], effectId: string): boolean {
  return keyframes.some(k => k.property.startsWith(`effect.${effectId}.`));
}

export function getEffectParamDefault(
  effectId: AudioEffectId,
  paramName: string
): AudioEffectParamValue | undefined {
  return getAudioEffectDefaultParams(effectId)[paramName];
}

export function getNumericEffectParamDefault(
  effectId: AudioEffectId,
  paramName: string,
  fallback: number
): number {
  const defaultValue = getEffectParamDefault(effectId, paramName);
  return typeof defaultValue === 'number' ? defaultValue : fallback;
}

export function getNumericEffectParam(
  effect: RenderableAudioEffectInstance,
  paramName: string,
  fallback: number
): number {
  const value = effect.params?.[paramName];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function getBooleanEffectParam(
  effect: RenderableAudioEffectInstance,
  paramName: string,
  fallback: boolean,
): boolean {
  const value = effect.params?.[paramName];
  return typeof value === 'boolean' ? value : fallback;
}

export function getStringEffectParam(
  effect: RenderableAudioEffectInstance,
  paramName: string,
  fallback: string,
): string {
  const value = effect.params?.[paramName];
  return typeof value === 'string' ? value : fallback;
}

export function createNumericSampleParamReader(
  effect: RenderableAudioEffectInstance,
  paramName: string,
  fallback: number,
  keyframes: EffectRenderKeyframe[],
  transformValue: (value: number) => number = value => value,
): (time: number) => number {
  const defaultValue = transformValue(getNumericEffectParam(effect, paramName, fallback));
  const property = `effect.${effect.id}.${paramName}` as string;
  const paramKeyframes = keyframes
    .filter(k => k.property === property && Number.isFinite(k.value))
    .map(k => ({ ...k, value: transformValue(k.value) }))
    .toSorted((a, b) => a.time - b.time);

  if (paramKeyframes.length === 0) {
    return () => defaultValue;
  }

  return (time: number) => interpolateSortedValue(paramKeyframes, time, defaultValue);
}

export function hasEffectParamKeyframes(
  keyframes: EffectRenderKeyframe[],
  effectId: string,
  paramName: string,
): boolean {
  return keyframes.some(k => k.property === `effect.${effectId}.${paramName}`);
}

export function automateEffectParam(
  param: AudioParam,
  effect: RenderableAudioEffectInstance,
  paramName: string,
  defaultValue: number,
  keyframes: EffectRenderKeyframe[],
  duration: number,
  transformValue: (value: number) => number = value => value,
): void {
  const property = `effect.${effect.id}.${paramName}` as string;
  const paramKeyframes = keyframes
    .filter(k => k.property === property)
    .map(k => ({ ...k, value: transformValue(k.value) }));

  if (paramKeyframes.length > 0) {
    automateParam(param, paramKeyframes, defaultValue, duration);
  } else {
    param.value = defaultValue;
  }
}

export function automateParamByProperties(
  param: AudioParam,
  properties: readonly string[],
  defaultValue: number,
  keyframes: EffectRenderKeyframe[],
  duration: number,
  transformValue: (value: number) => number = value => value,
): void {
  const propertySet = new Set(properties);
  const paramKeyframes = keyframes
    .filter(k => propertySet.has(k.property))
    .map(k => ({ ...k, value: transformValue(k.value) }));

  if (paramKeyframes.length > 0) {
    automateParam(param, paramKeyframes, defaultValue, duration);
  } else {
    param.value = defaultValue;
  }
}

export function hasNonDefaultRegistryParams(
  effectId: AudioEffectId,
  params: Record<string, AudioEffectParamValue> | undefined,
  epsilon = DEFAULT_PARAM_EPSILON,
): boolean {
  const descriptor = getAudioEffect(effectId);
  if (!descriptor) return false;

  const defaults = getAudioEffectDefaultParams(effectId);
  return descriptor.paramNames.some(paramName => {
    const defaultValue = defaults[paramName];
    const value = params?.[paramName];
    if (value === undefined) return false;
    if (typeof defaultValue === 'number') {
      return typeof value !== 'number' || Math.abs(value - defaultValue) > epsilon;
    }
    return value !== defaultValue;
  });
}

export function createMutableAudioBufferLike(buffer: AudioBuffer): AudioBuffer {
  return createBufferLike(buffer);
}
