import type { WorkerRenderSoftwareFrame, WorkerRenderSoftwarePixelEffects } from './workerRenderHostRuntimeCommands';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clampIndex(value: number, maxExclusive: number): number {
  return Math.max(0, Math.min(maxExclusive - 1, value));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sampleRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
): readonly [number, number, number, number] {
  const sampleX = clampIndex(Math.round(uvX * (width - 1)), width);
  const sampleY = clampIndex(Math.round(uvY * (height - 1)), height);
  const index = (sampleY * width + sampleX) * 4;
  return [
    data[index] / 255,
    data[index + 1] / 255,
    data[index + 2] / 255,
    data[index + 3] / 255,
  ];
}

function mirrorEdgeUv(value: number): number {
  const wrapped = value - Math.floor(value * 0.5) * 2;
  return wrapped > 1 ? 2 - wrapped : wrapped;
}

function applyWaveAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['waveAdjustments']
  >[number],
): readonly [number, number, number, number] {
  let sampleUvY = uvY + Math.sin(uvX * finiteNumber(adjustment.frequencyX, 5) * Math.PI * 2)
    * finiteNumber(adjustment.amplitudeX, 0.02);
  const sampleUvX = uvX + Math.sin(sampleUvY * finiteNumber(adjustment.frequencyY, 5) * Math.PI * 2)
    * finiteNumber(adjustment.amplitudeY, 0.02);
  sampleUvY = clamp01(sampleUvY);
  return sampleRgba(sourceData, width, height, clamp01(sampleUvX), sampleUvY);
}

function applyKaleidoscopeAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['kaleidoscopeAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const deltaX = uvX - 0.5;
  const deltaY = uvY - 0.5;
  const angle = Math.atan2(deltaY, deltaX) + finiteNumber(adjustment.rotation, 0);
  const radius = Math.hypot(deltaX, deltaY);
  const segmentAngle = (Math.PI * 2) / Math.max(2, finiteNumber(adjustment.segments, 6));
  let foldedAngle = (angle / segmentAngle - Math.floor(angle / segmentAngle)) * segmentAngle;
  if (foldedAngle > segmentAngle * 0.5) {
    foldedAngle = segmentAngle - foldedAngle;
  }
  return sampleRgba(
    sourceData,
    width,
    height,
    clamp01(Math.cos(foldedAngle) * radius + 0.5),
    clamp01(Math.sin(foldedAngle) * radius + 0.5),
  );
}

function applyTwirlAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['twirlAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  const radius = Math.max(finiteNumber(adjustment.radius, 0.5), 0.0001);
  if (distance >= radius) return sampleRgba(sourceData, width, height, uvX, uvY);

  const factor = 1 - Math.min(distance / radius, 1);
  const angle = finiteNumber(adjustment.amount, 1) * factor * factor;
  const sine = Math.sin(angle);
  const cosine = Math.cos(angle);
  const sampleUvX = centerX + deltaX * cosine - deltaY * sine;
  const sampleUvY = centerY + deltaX * sine + deltaY * cosine;
  return sampleRgba(sourceData, width, height, clamp01(sampleUvX), clamp01(sampleUvY));
}

function applyMotionBlurAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['motionBlurAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const amount = Math.max(0, finiteNumber(adjustment.amount, 0.05));
  if (amount < 0.001) return sampleRgba(sourceData, width, height, uvX, uvY);

  const samples = Math.max(4, Math.min(128, Math.round(finiteNumber(adjustment.samples, 24))));
  const angle = finiteNumber(adjustment.angle, 0);
  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  let weightTotal = 0;

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const t = (sampleIndex / (samples - 1) - 0.5) * 2;
    const weight = Math.exp(-t * t * 2);
    const sample = sampleRgba(
      sourceData,
      width,
      height,
      mirrorEdgeUv(uvX + directionX * t * amount),
      mirrorEdgeUv(uvY + directionY * t * amount),
    );
    r += sample[0] * weight;
    g += sample[1] * weight;
    b += sample[2] * weight;
    alpha += sample[3] * weight;
    weightTotal += weight;
  }

  return [
    r / weightTotal,
    g / weightTotal,
    b / weightTotal,
    alpha / weightTotal,
  ];
}

function applyRadialBlurAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['radialBlurAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const amount = Math.max(0, finiteNumber(adjustment.amount, 0.5));
  if (amount < 0.01) return sampleRgba(sourceData, width, height, uvX, uvY);

  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  const samples = Math.max(4, Math.min(256, Math.round(finiteNumber(adjustment.samples, 32))));
  const scaledAmount = amount * 0.2;
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;
  let weightTotal = 0;

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const t = sampleIndex / (samples - 1);
    const scale = 1 - scaledAmount * t * distance;
    const weight = 1 - t * 0.5;
    const sample = sampleRgba(
      sourceData,
      width,
      height,
      clamp01(centerX + deltaX * scale),
      clamp01(centerY + deltaY * scale),
    );
    r += sample[0] * weight;
    g += sample[1] * weight;
    b += sample[2] * weight;
    alpha += sample[3] * weight;
    weightTotal += weight;
  }

  return [
    r / weightTotal,
    g / weightTotal,
    b / weightTotal,
    alpha / weightTotal,
  ];
}

function applyZoomBlurAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['zoomBlurAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const samples = Math.max(4, Math.min(256, Math.round(finiteNumber(adjustment.samples, 16))));
  const amount = Math.max(0, finiteNumber(adjustment.amount, 0.3)) * 0.5;
  let r = 0;
  let g = 0;
  let b = 0;
  let alpha = 0;

  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const t = sampleIndex / (samples - 1);
    const scale = 1 + amount * t;
    const sample = sampleRgba(
      sourceData,
      width,
      height,
      clamp01(centerX + deltaX * scale),
      clamp01(centerY + deltaY * scale),
    );
    r += sample[0];
    g += sample[1];
    b += sample[2];
    alpha += sample[3];
  }

  return [
    r / samples,
    g / samples,
    b / samples,
    alpha / samples,
  ];
}

function applyBulgeAdjustment(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  uvX: number,
  uvY: number,
  adjustment: NonNullable<
    WorkerRenderSoftwareFrame['layers'][number]['pixelEffects']['bulgeAdjustments']
  >[number],
): readonly [number, number, number, number] {
  const centerX = finiteNumber(adjustment.centerX, 0.5);
  const centerY = finiteNumber(adjustment.centerY, 0.5);
  const deltaX = uvX - centerX;
  const deltaY = uvY - centerY;
  const distance = Math.hypot(deltaX, deltaY);
  const radius = Math.max(finiteNumber(adjustment.radius, 0.5), 0.0001);
  if (distance >= radius || distance <= 0) return sampleRgba(sourceData, width, height, uvX, uvY);

  const safeDistance = Math.max(distance, 0.0001);
  const normalizedDistance = safeDistance / radius;
  const factor = normalizedDistance ** finiteNumber(adjustment.amount, 0.5);
  const newDistance = factor * radius;
  const sampleUvX = centerX + (deltaX / safeDistance) * newDistance;
  const sampleUvY = centerY + (deltaY / safeDistance) * newDistance;
  return sampleRgba(sourceData, width, height, clamp01(sampleUvX), clamp01(sampleUvY));
}

export function hasWorkerSoftwareSourceResamplingEffects(
  pixelEffects: WorkerRenderSoftwarePixelEffects | undefined,
): boolean {
  return (pixelEffects?.waveAdjustments?.length ?? 0) > 0
    || (pixelEffects?.kaleidoscopeAdjustments?.length ?? 0) > 0
    || (pixelEffects?.twirlAdjustments?.length ?? 0) > 0
    || (pixelEffects?.bulgeAdjustments?.length ?? 0) > 0
    || (pixelEffects?.motionBlurAdjustments?.length ?? 0) > 0
    || (pixelEffects?.radialBlurAdjustments?.length ?? 0) > 0
    || (pixelEffects?.zoomBlurAdjustments?.length ?? 0) > 0;
}

export function applyWorkerSoftwareSourceResamplingEffects(
  sourceData: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  pixelEffects: WorkerRenderSoftwarePixelEffects,
): readonly [number, number, number, number] | null {
  const uvX = (x + 0.5) / width;
  const uvY = (y + 0.5) / height;
  let output: readonly [number, number, number, number] | null = null;
  for (const adjustment of pixelEffects.waveAdjustments ?? []) {
    output = applyWaveAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.kaleidoscopeAdjustments ?? []) {
    output = applyKaleidoscopeAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.twirlAdjustments ?? []) {
    output = applyTwirlAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.bulgeAdjustments ?? []) {
    output = applyBulgeAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.motionBlurAdjustments ?? []) {
    output = applyMotionBlurAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.radialBlurAdjustments ?? []) {
    output = applyRadialBlurAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  for (const adjustment of pixelEffects.zoomBlurAdjustments ?? []) {
    output = applyZoomBlurAdjustment(sourceData, width, height, uvX, uvY, adjustment);
  }
  return output;
}
