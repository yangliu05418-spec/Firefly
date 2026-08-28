import type { LoudnessAnalysisContext } from './loudnessAnalysisTypes';
import { safeSample } from './loudnessMath';

interface BiquadCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function normalizeBiquad(coefficients: {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}): BiquadCoefficients {
  return {
    b0: coefficients.b0 / coefficients.a0,
    b1: coefficients.b1 / coefficients.a0,
    b2: coefficients.b2 / coefficients.a0,
    a1: coefficients.a1 / coefficients.a0,
    a2: coefficients.a2 / coefficients.a0,
  };
}

function createHighShelfCoefficients(
  sampleRate: number,
  frequency: number,
  q: number,
  gainDb: number,
): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const sqrtA = Math.sqrt(a);

  return normalizeBiquad({
    b0: a * ((a + 1) + (a - 1) * cos + 2 * sqrtA * alpha),
    b1: -2 * a * ((a - 1) + (a + 1) * cos),
    b2: a * ((a + 1) + (a - 1) * cos - 2 * sqrtA * alpha),
    a0: (a + 1) - (a - 1) * cos + 2 * sqrtA * alpha,
    a1: 2 * ((a - 1) - (a + 1) * cos),
    a2: (a + 1) - (a - 1) * cos - 2 * sqrtA * alpha,
  });
}

function createHighPassCoefficients(sampleRate: number, frequency: number, q: number): BiquadCoefficients {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);

  return normalizeBiquad({
    b0: (1 + cos) / 2,
    b1: -(1 + cos),
    b2: (1 + cos) / 2,
    a0: 1 + alpha,
    a1: -2 * cos,
    a2: 1 - alpha,
  });
}

function applyBiquad(input: Float32Array, coefficients: BiquadCoefficients): Float32Array {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let index = 0; index < input.length; index += 1) {
    const x0 = safeSample(input[index] ?? 0);
    const y0 = coefficients.b0 * x0
      + coefficients.b1 * x1
      + coefficients.b2 * x2
      - coefficients.a1 * y1
      - coefficients.a2 * y2;
    output[index] = Number.isFinite(y0) ? y0 : 0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = output[index];
  }

  return output;
}

function applyKWeighting(data: Float32Array, sampleRate: number): Float32Array {
  const shelfFrequency = Math.min(1_681.974450955533, Math.max(1, sampleRate * 0.45));
  const highPassFrequency = Math.min(38.13547087602444, Math.max(1, sampleRate * 0.2));
  const shelf = createHighShelfCoefficients(sampleRate, shelfFrequency, 0.7071752369554196, 3.99984385397);
  const highPass = createHighPassCoefficients(sampleRate, highPassFrequency, 0.5003270373238773);
  return applyBiquad(applyBiquad(data, shelf), highPass);
}

function loudnessChannelWeight(channelIndex: number, channelCount: number): number {
  if (channelCount >= 6 && channelIndex === 3) {
    return 0;
  }

  if (channelCount >= 6 && (channelIndex === 4 || channelIndex === 5)) {
    return 1.41;
  }

  return 1;
}

export function createWeightedKPower(
  buffer: AudioBuffer,
  context: LoudnessAnalysisContext,
  throwIfCancelled: (signal: AbortSignal | undefined, jobId: string) => void,
): Float64Array {
  const power = new Float64Array(buffer.length);

  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex += 1) {
    context.onProgress?.({
      jobId: context.jobId,
      mediaFileId: context.mediaFileId,
      sourceFingerprint: context.sourceFingerprint,
      cacheKey: context.cacheKey,
      phase: 'analyzing',
      percent: 10 + (channelIndex / buffer.numberOfChannels) * 35,
      timestamp: new Date().toISOString(),
      message: 'Applying K-weighting',
    });
    throwIfCancelled(context.signal, context.jobId);

    const weighted = applyKWeighting(buffer.getChannelData(channelIndex), buffer.sampleRate);
    const channelWeight = loudnessChannelWeight(channelIndex, buffer.numberOfChannels);
    for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
      const sample = weighted[sampleIndex] ?? 0;
      power[sampleIndex] += channelWeight * sample * sample;
    }
  }

  return power;
}
