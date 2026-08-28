import type { BlendMode, Layer } from '../../types';
import type { RuntimePrimaryColorParams } from '../../types/colorCorrection';
import type { Effect } from '../../types/effects';
import type { WorkerRenderSoftwarePixelEffects } from './workerRenderHostRuntimeCommands';

const CANVAS_COMPOSITE_BY_BLEND_MODE: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color-dodge': 'color-dodge',
  'color-burn': 'color-burn',
  'hard-light': 'hard-light',
  'soft-light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  add: 'lighter',
  'linear-dodge': 'lighter',
  'alpha-add': 'lighter',
};

export interface WorkerSoftwareEffectPlan {
  readonly filter: string;
  readonly pixelEffects: WorkerRenderSoftwarePixelEffects;
}

interface MutableWorkerSoftwarePixelEffects {
  brightness: number;
  acuarelaAdjustments?: {
    feedbackKey: string;
    opacity: number;
    gain: number;
    speed: number;
    detail: number;
    strength: number;
    density: number;
    gainX: number;
    gainY: number;
    reset: boolean;
  }[];
  rom1Adjustments?: {
    feedbackKey: string;
    opacity: number;
    gain: number;
    speed: number;
    detail: number;
    strength: number;
    density: number;
    gainX: number;
    gainY: number;
    reset: boolean;
  }[];
  mirrorHorizontal?: boolean;
  mirrorVertical?: boolean;
  pixelateSize?: number;
  rgbSplit?: { amount: number; angle: number };
  exposureAdjustments?: { exposure: number; offset: number; gamma: number }[];
  temperatureAdjustments?: { temperature: number; tint: number }[];
  vibranceAdjustments?: { amount: number }[];
  levelsAdjustments?: {
    inputBlack: number;
    inputWhite: number;
    gamma: number;
    outputBlack: number;
    outputWhite: number;
  }[];
  thresholdAdjustments?: { level: number }[];
  posterizeAdjustments?: { levels: number }[];
  vignetteAdjustments?: { amount: number; size: number; softness: number; roundness: number }[];
  chromaKeyAdjustments?: {
    keyColor: 'green' | 'blue';
    tolerance: number;
    softness: number;
    spillSuppression: number;
  }[];
  edgeDetectAdjustments?: { strength: number; invert: boolean }[];
  sharpenAdjustments?: { amount: number; radius: number }[];
  glowAdjustments?: {
    amount: number;
    threshold: number;
    radius: number;
    softness: number;
    rings: number;
    samplesPerRing: number;
  }[];
  scanlineAdjustments?: { density: number; opacity: number; speed: number }[];
  grainAdjustments?: { amount: number; size: number; speed: number }[];
  waveAdjustments?: {
    amplitudeX: number;
    amplitudeY: number;
    frequencyX: number;
    frequencyY: number;
  }[];
  kaleidoscopeAdjustments?: { segments: number; rotation: number }[];
  twirlAdjustments?: {
    amount: number;
    radius: number;
    centerX: number;
    centerY: number;
  }[];
  bulgeAdjustments?: {
    amount: number;
    radius: number;
    centerX: number;
    centerY: number;
  }[];
  motionBlurAdjustments?: { amount: number; angle: number; samples: number }[];
  radialBlurAdjustments?: {
    amount: number;
    centerX: number;
    centerY: number;
    samples: number;
  }[];
  zoomBlurAdjustments?: {
    amount: number;
    centerX: number;
    centerY: number;
    samples: number;
  }[];
  sourceResamplingEffectCount?: number;
  feedbackEffectCount?: number;
  colorGradePrimaryNodes?: RuntimePrimaryColorParams[];
}

export function canvasCompositeOperationForBlendMode(
  blendMode: BlendMode,
): GlobalCompositeOperation | null {
  return CANVAS_COMPOSITE_BY_BLEND_MODE[blendMode] ?? null;
}

function finiteEffectNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function createEmptyPixelEffects(
  colorGradePrimaryNodes?: readonly RuntimePrimaryColorParams[],
): MutableWorkerSoftwarePixelEffects {
  return {
    brightness: 0,
    mirrorHorizontal: false,
    mirrorVertical: false,
    pixelateSize: 0,
    ...(colorGradePrimaryNodes && colorGradePrimaryNodes.length > 0
      ? { colorGradePrimaryNodes: colorGradePrimaryNodes.map((node) => ({ ...node })) }
      : {}),
  };
}

function canAddSourceResamplingEffect(pixelEffects: MutableWorkerSoftwarePixelEffects): boolean {
  pixelEffects.sourceResamplingEffectCount = (pixelEffects.sourceResamplingEffectCount ?? 0) + 1;
  return pixelEffects.sourceResamplingEffectCount === 1;
}

function canAddFeedbackEffect(pixelEffects: MutableWorkerSoftwarePixelEffects): boolean {
  pixelEffects.feedbackEffectCount = (pixelEffects.feedbackEffectCount ?? 0) + 1;
  return pixelEffects.feedbackEffectCount === 1;
}

function effectFilterPart(
  effect: Effect,
  pixelEffects: MutableWorkerSoftwarePixelEffects,
  layerId: string,
): string | null {
  if (effect.enabled === false || effect.type.startsWith('audio-')) return '';
  const effectType = effect.type as string;
  switch (effectType) {
    case 'acuarela':
      if (!canAddFeedbackEffect(pixelEffects)) return null;
      (pixelEffects.acuarelaAdjustments ??= []).push({
        feedbackKey: `${layerId}:${effect.id}`,
        opacity: finiteEffectNumber(effect.params.opacity, 1),
        gain: finiteEffectNumber(effect.params.gain, 0.01),
        speed: finiteEffectNumber(effect.params.speed, 4),
        detail: finiteEffectNumber(effect.params.detail, 4),
        strength: finiteEffectNumber(effect.params.strength, 0.32),
        density: finiteEffectNumber(effect.params.density, 4),
        gainX: finiteEffectNumber(effect.params.gainX, 0.3),
        gainY: finiteEffectNumber(effect.params.gainY, 0.3),
        reset: effect.params.reset === true,
      });
      return '';
    case 'rom1':
      if (!canAddFeedbackEffect(pixelEffects)) return null;
      (pixelEffects.rom1Adjustments ??= []).push({
        feedbackKey: `${layerId}:${effect.id}`,
        opacity: finiteEffectNumber(effect.params.opacity, 1),
        gain: finiteEffectNumber(effect.params.gain, 0.01),
        speed: finiteEffectNumber(effect.params.speed, 4),
        detail: finiteEffectNumber(effect.params.detail, 4),
        strength: finiteEffectNumber(effect.params.strength, 0.32),
        density: finiteEffectNumber(effect.params.density, 4),
        gainX: finiteEffectNumber(effect.params.gainX, 0.3),
        gainY: finiteEffectNumber(effect.params.gainY, 0.3),
        reset: effect.params.reset === true,
      });
      return '';
    case 'brightness':
      pixelEffects.brightness += finiteEffectNumber(effect.params.amount, 0);
      return '';
    case 'exposure':
      (pixelEffects.exposureAdjustments ??= []).push({
        exposure: finiteEffectNumber(effect.params.exposure, 0),
        offset: finiteEffectNumber(effect.params.offset, 0),
        gamma: Math.max(0.001, finiteEffectNumber(effect.params.gamma, 1)),
      });
      return '';
    case 'temperature':
      (pixelEffects.temperatureAdjustments ??= []).push({
        temperature: finiteEffectNumber(effect.params.temperature, 0),
        tint: finiteEffectNumber(effect.params.tint, 0),
      });
      return '';
    case 'vibrance':
      (pixelEffects.vibranceAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0),
      });
      return '';
    case 'levels':
      (pixelEffects.levelsAdjustments ??= []).push({
        inputBlack: finiteEffectNumber(effect.params.inputBlack, 0),
        inputWhite: finiteEffectNumber(effect.params.inputWhite, 1),
        gamma: Math.max(0.001, finiteEffectNumber(effect.params.gamma, 1)),
        outputBlack: finiteEffectNumber(effect.params.outputBlack, 0),
        outputWhite: finiteEffectNumber(effect.params.outputWhite, 1),
      });
      return '';
    case 'threshold':
      (pixelEffects.thresholdAdjustments ??= []).push({
        level: finiteEffectNumber(effect.params.level, 0.5),
      });
      return '';
    case 'posterize':
      (pixelEffects.posterizeAdjustments ??= []).push({
        levels: Math.max(2, finiteEffectNumber(effect.params.levels, 6)),
      });
      return '';
    case 'vignette':
      (pixelEffects.vignetteAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.5),
        size: finiteEffectNumber(effect.params.size, 0.5),
        softness: finiteEffectNumber(effect.params.softness, 0.5),
        roundness: finiteEffectNumber(effect.params.roundness, 1),
      });
      return '';
    case 'chroma-key': {
      const keyColor = effect.params.keyColor === 'blue' ? 'blue' : 'green';
      (pixelEffects.chromaKeyAdjustments ??= []).push({
        keyColor,
        tolerance: finiteEffectNumber(effect.params.tolerance, 0.2),
        softness: finiteEffectNumber(effect.params.softness, 0.1),
        spillSuppression: finiteEffectNumber(effect.params.spillSuppression, 0.5),
      });
      return '';
    }
    case 'edge-detect':
      (pixelEffects.edgeDetectAdjustments ??= []).push({
        strength: finiteEffectNumber(effect.params.strength, 1),
        invert: effect.params.invert === true,
      });
      return '';
    case 'sharpen':
      (pixelEffects.sharpenAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 1),
        radius: Math.max(0, finiteEffectNumber(effect.params.radius, 1)),
      });
      return '';
    case 'glow':
      (pixelEffects.glowAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 1),
        threshold: finiteEffectNumber(effect.params.threshold, 0.6),
        radius: Math.max(0, finiteEffectNumber(effect.params.radius, 20)),
        softness: Math.max(0.001, finiteEffectNumber(effect.params.softness, 0.5)),
        rings: Math.max(1, Math.min(32, Math.round(finiteEffectNumber(effect.params.rings, 4)))),
        samplesPerRing: Math.max(4, Math.min(64, Math.round(finiteEffectNumber(effect.params.samplesPerRing, 16)))),
      });
      return '';
    case 'scanlines':
      (pixelEffects.scanlineAdjustments ??= []).push({
        density: finiteEffectNumber(effect.params.density, 5),
        opacity: finiteEffectNumber(effect.params.opacity, 0.3),
        speed: finiteEffectNumber(effect.params.speed, 0),
      });
      return '';
    case 'grain':
      (pixelEffects.grainAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.1),
        size: Math.max(0.001, finiteEffectNumber(effect.params.size, 1)),
        speed: finiteEffectNumber(effect.params.speed, 1),
      });
      return '';
    case 'wave':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.waveAdjustments ??= []).push({
        amplitudeX: finiteEffectNumber(effect.params.amplitudeX, 0.02),
        amplitudeY: finiteEffectNumber(effect.params.amplitudeY, 0.02),
        frequencyX: finiteEffectNumber(effect.params.frequencyX, 5),
        frequencyY: finiteEffectNumber(effect.params.frequencyY, 5),
      });
      return '';
    case 'kaleidoscope':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.kaleidoscopeAdjustments ??= []).push({
        segments: Math.max(2, finiteEffectNumber(effect.params.segments, 6)),
        rotation: finiteEffectNumber(effect.params.rotation, 0),
      });
      return '';
    case 'twirl':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.twirlAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 1),
        radius: Math.max(0.0001, finiteEffectNumber(effect.params.radius, 0.5)),
        centerX: finiteEffectNumber(effect.params.centerX, 0.5),
        centerY: finiteEffectNumber(effect.params.centerY, 0.5),
      });
      return '';
    case 'bulge':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.bulgeAdjustments ??= []).push({
        amount: finiteEffectNumber(effect.params.amount, 0.5),
        radius: Math.max(0.0001, finiteEffectNumber(effect.params.radius, 0.5)),
        centerX: finiteEffectNumber(effect.params.centerX, 0.5),
        centerY: finiteEffectNumber(effect.params.centerY, 0.5),
      });
      return '';
    case 'motion-blur':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.motionBlurAdjustments ??= []).push({
        amount: Math.max(0, finiteEffectNumber(effect.params.amount, 0.05)),
        angle: finiteEffectNumber(effect.params.angle, 0),
        samples: Math.max(4, Math.min(128, Math.round(finiteEffectNumber(effect.params.samples, 24)))),
      });
      return '';
    case 'radial-blur':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.radialBlurAdjustments ??= []).push({
        amount: Math.max(0, finiteEffectNumber(effect.params.amount, 0.5)),
        centerX: finiteEffectNumber(effect.params.centerX, 0.5),
        centerY: finiteEffectNumber(effect.params.centerY, 0.5),
        samples: Math.max(4, Math.min(256, Math.round(finiteEffectNumber(effect.params.samples, 32)))),
      });
      return '';
    case 'zoom-blur':
      if (!canAddSourceResamplingEffect(pixelEffects)) return null;
      (pixelEffects.zoomBlurAdjustments ??= []).push({
        amount: Math.max(0, finiteEffectNumber(effect.params.amount, 0.3)),
        centerX: finiteEffectNumber(effect.params.centerX, 0.5),
        centerY: finiteEffectNumber(effect.params.centerY, 0.5),
        samples: Math.max(4, Math.min(256, Math.round(finiteEffectNumber(effect.params.samples, 16)))),
      });
      return '';
    case 'blur':
    case 'gaussian-blur':
    case 'box-blur': {
      const fallbackRadius = effectType === 'box-blur' ? 5 : 10;
      const radius = Math.max(0, finiteEffectNumber(
        effect.params.radius,
        finiteEffectNumber(effect.params.amount, fallbackRadius),
      ));
      return radius > 0 ? `blur(${radius}px)` : '';
    }
    case 'mirror':
      pixelEffects.mirrorHorizontal = pixelEffects.mirrorHorizontal || effect.params.horizontal !== false;
      pixelEffects.mirrorVertical = pixelEffects.mirrorVertical || effect.params.vertical === true;
      return '';
    case 'pixelate':
      pixelEffects.pixelateSize = Math.max(1, finiteEffectNumber(effect.params.size, 8));
      return '';
    case 'rgb-split':
      pixelEffects.rgbSplit = {
        amount: Math.max(0, finiteEffectNumber(effect.params.amount, 0.01)),
        angle: finiteEffectNumber(effect.params.angle, 0),
      };
      return '';
    case 'contrast':
      return `contrast(${Math.max(0, finiteEffectNumber(effect.params.amount, 1))})`;
    case 'saturation':
      return `saturate(${Math.max(0, finiteEffectNumber(effect.params.amount, 1))})`;
    case 'hue-shift':
      return `hue-rotate(${finiteEffectNumber(effect.params.shift, 0) * 360}deg)`;
    case 'invert':
      return 'invert(1)';
    default:
      return null;
  }
}

export function workerSoftwareEffectPlanForLayer(layer: Layer): WorkerSoftwareEffectPlan | null {
  const parts: string[] = [];
  const pixelEffects = createEmptyPixelEffects(layer.colorCorrection?.primaryNodes);
  let activeVisualEffectCount = 0;
  for (const effect of layer.effects) {
    if (effect.enabled !== false && !effect.type.startsWith('audio-')) {
      activeVisualEffectCount += 1;
    }
    const part = effectFilterPart(effect, pixelEffects, layer.id);
    if (part === null) return null;
    if (part) parts.push(part);
  }
  const feedbackEffectCount = (pixelEffects.acuarelaAdjustments?.length ?? 0)
    + (pixelEffects.rom1Adjustments?.length ?? 0);
  if (feedbackEffectCount > 0 && activeVisualEffectCount !== feedbackEffectCount) {
    return null;
  }
  delete pixelEffects.feedbackEffectCount;
  delete pixelEffects.sourceResamplingEffectCount;
  return {
    filter: parts.length > 0 ? parts.join(' ') : 'none',
    pixelEffects,
  };
}
