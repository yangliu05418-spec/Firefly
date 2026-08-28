function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window[0] = 1;
    return window;
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (size - 1)));
  }

  return window;
}

function fftRadix2(real: Float32Array, imag: Float32Array): void {
  const size = real.length;
  let reversed = 0;

  for (let index = 1; index < size; index += 1) {
    let bit = size >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;

    if (index < reversed) {
      const tmpReal = real[index];
      real[index] = real[reversed];
      real[reversed] = tmpReal;
      const tmpImag = imag[index];
      imag[index] = imag[reversed];
      imag[reversed] = tmpImag;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);

    for (let offset = 0; offset < size; offset += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;

      for (let pair = 0; pair < length / 2; pair += 1) {
        const evenIndex = offset + pair;
        const oddIndex = evenIndex + length / 2;
        const oddReal = real[oddIndex] * twiddleReal - imag[oddIndex] * twiddleImag;
        const oddImag = real[oddIndex] * twiddleImag + imag[oddIndex] * twiddleReal;

        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextTwiddleReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextTwiddleReal;
      }
    }
  }
}

function readMixedSample(channelData: Float32Array[], sampleIndex: number): number {
  if (sampleIndex < 0) return 0;
  let sum = 0;
  let count = 0;

  for (const data of channelData) {
    if (sampleIndex >= data.length) continue;
    const sample = data[sampleIndex] ?? 0;
    sum += Number.isFinite(sample) ? sample : 0;
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

export function writeFrameMagnitudes(input: {
  channelData: Float32Array[];
  frameIndex: number;
  hopSize: number;
  fftSize: number;
  frequencyBinCount: number;
  window: Float32Array;
  minDb: number;
  maxDb: number;
  real: Float32Array;
  imag: Float32Array;
  target: Float32Array;
  targetFrameOffset: number;
}): void {
  input.real.fill(0);
  input.imag.fill(0);
  const sampleStart = input.frameIndex * input.hopSize;

  for (let sampleOffset = 0; sampleOffset < input.fftSize; sampleOffset += 1) {
    input.real[sampleOffset] = readMixedSample(input.channelData, sampleStart + sampleOffset)
      * (input.window[sampleOffset] ?? 1);
  }

  fftRadix2(input.real, input.imag);

  const dbRange = input.maxDb - input.minDb;
  const amplitudeScale = input.fftSize / 2;
  const targetOffset = input.targetFrameOffset * input.frequencyBinCount;

  for (let binIndex = 0; binIndex < input.frequencyBinCount; binIndex += 1) {
    const magnitude = Math.hypot(input.real[binIndex], input.imag[binIndex]) / amplitudeScale;
    const db = 20 * Math.log10(Math.max(1e-12, magnitude));
    input.target[targetOffset + binIndex] = clamp01((db - input.minDb) / dbRange);
  }
}
