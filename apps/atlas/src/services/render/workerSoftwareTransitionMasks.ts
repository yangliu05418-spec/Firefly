import type { WorkerRenderSoftwareTransition } from './workerRenderHostRuntimeCommands';

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function hash2(x: number, y: number): number {
  let px = fract(x * 0.1031);
  let py = fract(y * 0.1031);
  let pz = fract(x * 0.1031);
  const dot = px * (py + 33.33) + py * (pz + 33.33) + pz * (px + 33.33);
  px += dot;
  py += dot;
  pz += dot;
  return fract((px + py) * pz);
}

function applyWipeTransitionMask(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  transition: Extract<WorkerRenderSoftwareTransition, { readonly kind: 'wipe' }>,
): void {
  const progress = clamp01(finiteNumber(transition.progress, 0));
  if (progress >= 1) return;
  if (progress <= 0) {
    context.clearRect(0, 0, width, height);
    return;
  }
  let x = 0;
  let y = 0;
  let maskWidth = width;
  let maskHeight = height;
  if (transition.direction === 'left') {
    x = width * (1 - progress);
    maskWidth = width * progress;
  } else if (transition.direction === 'right') {
    maskWidth = width * progress;
  } else if (transition.direction === 'up') {
    y = height * (1 - progress);
    maskHeight = height * progress;
  } else {
    maskHeight = height * progress;
  }
  context.save();
  context.globalCompositeOperation = 'destination-in';
  context.fillStyle = '#000';
  context.fillRect(x, y, maskWidth, maskHeight);
  context.restore();
}

function shapeContainsPixel(
  transition: Extract<WorkerRenderSoftwareTransition, { readonly kind: 'shape-mask' }>,
  centeredX: number,
  centeredY: number,
  progress: number,
): boolean {
  if (transition.shape === 'circle') return Math.hypot(centeredX, centeredY) <= progress * 0.70710678;
  if (transition.shape === 'diamond') return Math.abs(centeredX) + Math.abs(centeredY) <= progress;
  if (transition.shape === 'rect') return Math.max(Math.abs(centeredX), Math.abs(centeredY)) <= progress * 0.5;
  if (transition.shape === 'oval') return Math.hypot(centeredX * 0.68, centeredY) <= progress * 0.605;
  const eased = progress ** 1.35;
  if (transition.shape === 'triangle') {
    return Math.max(Math.abs(centeredX) * 1.1 - centeredY * 0.6, centeredY * 1.2) <= eased * 0.9;
  }
  if (transition.shape === 'cross') return Math.min(Math.abs(centeredX), Math.abs(centeredY)) <= eased * 0.5;
  const angle = Math.atan2(centeredY, centeredX);
  const radius = Math.hypot(centeredX, centeredY);
  const starRadius = 0.68 + 0.32 * Math.cos(angle * 5);
  return radius / Math.max(starRadius, 0.24) <= eased * 2;
}

function patternContainsPixel(
  transition: Extract<WorkerRenderSoftwareTransition, { readonly kind: 'pattern-mask' }>,
  uvX: number,
  uvY: number,
  progress: number,
): boolean {
  if (transition.pattern === 'checker') {
    const cellX = Math.floor(uvX * 18);
    const cellY = Math.floor(uvY * 10);
    const checker = fract((cellX + cellY) * 0.5) * 2;
    const rank = checker * 0.58 + hash2(cellX + 2.71, cellY + 5.83) * 0.42;
    return rank < progress;
  }
  if (transition.pattern === 'venetian-horizontal') {
    const stripeUv = uvY * 10;
    const stripe = Math.floor(stripeUv);
    const local = fract(stripeUv);
    const stagger = hash2(stripe, 4.17) * 0.18;
    return local <= clamp01(progress * 1.18 - stagger);
  }
  if (transition.pattern === 'venetian-vertical') {
    const stripeUv = uvX * 12;
    const stripe = Math.floor(stripeUv);
    const local = fract(stripeUv);
    const stagger = hash2(stripe, 9.43) * 0.18;
    return local <= clamp01(progress * 1.18 - stagger);
  }
  if (transition.pattern === 'random-blocks') {
    const cellX = Math.floor(uvX * 10);
    const cellY = Math.floor(uvY * 6);
    return hash2(cellX + 31.7, cellY + 13.9) <= progress;
  }
  if (transition.pattern === 'zig-zag') {
    const localRow = fract(uvY * 8);
    const notch = Math.abs(localRow - 0.5) * 0.28;
    return uvX <= progress * 1.28 - 0.14 - notch;
  }
  if (transition.pattern === 'polka-dot') {
    const cellX = Math.floor(uvX * 12);
    const cellY = Math.floor(uvY * 7);
    const localX = fract(uvX * 12) - 0.5;
    const localY = fract(uvY * 7) - 0.5;
    const stagger = hash2(cellX + 8.13, cellY + 2.47) * 0.16;
    const radius = clamp01(progress * 1.18 - stagger) * 0.72;
    return Math.hypot(localX, localY) <= radius;
  }
  if (transition.pattern === 'doom-bars') {
    const column = Math.floor(uvX * 12);
    const stagger = hash2(column, 6.91) * 0.18;
    const columnProgress = clamp01(progress * 1.18 - stagger);
    const alternate = fract(column * 0.5) * 2;
    return alternate < 1 ? uvY <= columnProgress : uvY >= 1 - columnProgress;
  }
  const cellX = Math.floor(uvX * 9);
  const cellY = Math.floor(uvY * 5);
  const localX = fract(uvX * 9) - 0.5;
  const localY = fract(uvY * 5) - 0.5;
  const rank = hash2(cellX + 4.89, cellY + 12.37);
  const growth = clamp01(progress * 1.28 - rank * 0.34);
  const offsetAX = (hash2(cellX + 17.1, cellY + 2.3) - 0.5) * 0.28;
  const offsetAY = (hash2(cellX + 5.7, cellY + 23.4) - 0.5) * 0.28;
  const offsetBX = (hash2(cellX + 11.2, cellY + 31.6) - 0.5) * 0.32;
  const offsetBY = (hash2(cellX + 29.9, cellY + 7.4) - 0.5) * 0.32;
  const mainRadius = growth * (0.34 + hash2(cellX + 3.4, cellY + 44.2) * 0.18);
  const satelliteA = growth * (0.14 + hash2(cellX + 41.8, cellY + 1.9) * 0.1);
  const satelliteB = growth * (0.12 + hash2(cellX + 8.6, cellY + 15.1) * 0.08);
  const main = Math.hypot(localX - offsetAX, localY - offsetAY) <= mainRadius;
  const spotA = Math.hypot(localX + 0.24 - offsetBX * 0.55, localY - 0.16 - offsetBY * 0.55) <= satelliteA;
  const spotB = Math.hypot(localX - 0.18 + offsetAX * 0.45, localY + 0.22 + offsetAY * 0.45) <= satelliteB;
  return main || spotA || spotB;
}

function transitionContainsPixel(
  transition: WorkerRenderSoftwareTransition,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  const progress = clamp01(finiteNumber(transition.progress, 0));
  const uvX = (x + 0.5) / width;
  const uvY = (y + 0.5) / height;
  const centeredX = uvX - 0.5;
  const centeredY = uvY - 0.5;
  if (transition.kind === 'center-mask') {
    return transition.axis === 'x'
      ? Math.abs(centeredX) <= progress * 0.5
      : Math.abs(centeredY) <= progress * 0.5;
  }
  if (transition.kind === 'clock-mask') return fract(Math.atan2(centeredX, -centeredY) / (Math.PI * 2)) <= progress;
  if (transition.kind === 'shape-mask') return shapeContainsPixel(transition, centeredX, centeredY, progress);
  if (transition.kind === 'procedural-mask') {
    const seedX = transition.seed * 0.013;
    const seedY = transition.seed * 0.021;
    const gridX = transition.procedural === 'noise' ? 96 : 24;
    const gridY = transition.procedural === 'noise' ? 96 : 14;
    const cellX = Math.floor(uvX * gridX);
    const cellY = Math.floor(uvY * gridY);
    const offsetX = transition.procedural === 'noise' ? 0 : 19.19;
    const offsetY = transition.procedural === 'noise' ? 0 : 7.31;
    return hash2(cellX + seedX + offsetX, cellY + seedY + offsetY) <= progress;
  }
  if (transition.kind === 'pattern-mask') return patternContainsPixel(transition, uvX, uvY, progress);
  return true;
}

function applyPixelTransitionMask(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  transition: WorkerRenderSoftwareTransition,
): void {
  const progress = clamp01(finiteNumber(transition.progress, 0));
  if (progress >= 1) return;
  if (progress <= 0) {
    context.clearRect(0, 0, width, height);
    return;
  }
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (transitionContainsPixel(transition, x, y, width, height)) continue;
      data[(y * width + x) * 4 + 3] = 0;
    }
  }
  context.putImageData(imageData, 0, 0);
}

export function applyWorkerSoftwareTransitionMask(
  context: OffscreenCanvasRenderingContext2D,
  width: number,
  height: number,
  transition: WorkerRenderSoftwareTransition | undefined,
): void {
  if (!transition) return;
  if (transition.kind === 'wipe') {
    applyWipeTransitionMask(context, width, height, transition);
    return;
  }
  applyPixelTransitionMask(context, width, height, transition);
}

