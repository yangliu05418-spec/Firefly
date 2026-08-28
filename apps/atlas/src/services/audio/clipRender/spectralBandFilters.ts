import { rangeFeatherFactor } from './audioRenderMath';

export function createBandpassCoefficients(
  sampleRate: number,
  frequencyMinHz: number,
  frequencyMaxHz: number,
): {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
} | null {
  const nyquist = sampleRate / 2;
  const minHz = Math.max(20, Math.min(nyquist - 1, frequencyMinHz));
  const maxHz = Math.max(minHz + 1, Math.min(nyquist - 1, frequencyMaxHz));
  if (maxHz <= minHz || nyquist <= 20) return null;

  const centerHz = Math.max(20, Math.min(nyquist - 1, Math.sqrt(minHz * maxHz)));
  const bandwidthHz = Math.max(1, maxHz - minHz);
  const q = Math.max(0.2, Math.min(32, centerHz / bandwidthHz));
  const omega = 2 * Math.PI * (centerHz / sampleRate);
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const a0 = 1 + alpha;

  return {
    b0: alpha / a0,
    b1: 0,
    b2: -alpha / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function createNotchCoefficients(
  sampleRate: number,
  frequencyHz: number,
  q: number,
): {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
} | null {
  const nyquist = sampleRate / 2;
  const frequency = Math.max(20, Math.min(nyquist - 1, frequencyHz));
  if (frequency <= 0 || frequency >= nyquist || nyquist <= 20) return null;

  const clampedQ = Math.max(0.5, Math.min(100, q));
  const omega = 2 * Math.PI * (frequency / sampleRate);
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * clampedQ);
  const a0 = 1 + alpha;

  return {
    b0: 1 / a0,
    b1: (-2 * cos) / a0,
    b2: 1 / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

export function applyNotchFilterRange(
  buffer: AudioBuffer,
  range: { start: number; end: number },
  channels: readonly number[],
  frequencyHz: number,
  q: number,
  featherSamples: number,
): void {
  const coefficients = createNotchCoefficients(buffer.sampleRate, frequencyHz, q);
  if (!coefficients) return;

  for (const channel of channels) {
    const data = buffer.getChannelData(channel);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let sample = range.start; sample < range.end; sample += 1) {
      const x0 = data[sample] ?? 0;
      const filtered = coefficients.b0 * x0 +
        coefficients.b1 * x1 +
        coefficients.b2 * x2 -
        coefficients.a1 * y1 -
        coefficients.a2 * y2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = filtered;

      const feather = rangeFeatherFactor(sample, range, featherSamples);
      data[sample] = x0 + (filtered - x0) * feather;
    }
  }
}
