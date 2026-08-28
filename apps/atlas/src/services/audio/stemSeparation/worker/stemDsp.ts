// Pure DSP primitives for the stem separation worker:
// Hann windows, radix-2 FFT, reflect padding, STFT/ISTFT, linear resampling.
// No ONNX/session state — imported by the worker entry only.

const fftTwiddles = new Map<number, { real: Float32Array; imag: Float32Array }>();
const ifftTwiddles = new Map<number, { real: Float32Array; imag: Float32Array }>();
const hannWindows = new Map<number, Float32Array>();

export interface Spectrogram {
  real: Float32Array;
  imag: Float32Array;
  numFrames: number;
  numBins: number;
}

function getHannWindow(size: number): Float32Array {
  const cached = hannWindows.get(size);
  if (cached) return cached;

  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / size));
  }
  hannWindows.set(size, window);
  return window;
}

function buildTwiddles(size: number, inverse: boolean): { real: Float32Array; imag: Float32Array } {
  const cache = inverse ? ifftTwiddles : fftTwiddles;
  const cached = cache.get(size);
  if (cached) return cached;

  const real = new Float32Array(size / 2);
  const imag = new Float32Array(size / 2);
  const direction = inverse ? 1 : -1;
  for (let index = 0; index < size / 2; index += 1) {
    const angle = (direction * 2 * Math.PI * index) / size;
    real[index] = Math.cos(angle);
    imag[index] = Math.sin(angle);
  }

  const twiddles = { real, imag };
  cache.set(size, twiddles);
  return twiddles;
}

function bitReverse(value: number, bits: number): number {
  let reversed = 0;
  let remaining = value;
  for (let bit = 0; bit < bits; bit += 1) {
    reversed = (reversed << 1) | (remaining & 1);
    remaining >>= 1;
  }
  return reversed;
}

function runFft(
  realOut: Float32Array,
  imagOut: Float32Array,
  realIn: Float32Array,
  imagIn: Float32Array | null,
  size: number,
  inverse: boolean,
): void {
  const bits = Math.log2(size) | 0;
  const twiddles = buildTwiddles(size, inverse);

  for (let index = 0; index < size; index += 1) {
    const sourceIndex = bitReverse(index, bits);
    realOut[index] = realIn[sourceIndex] ?? 0;
    imagOut[index] = imagIn?.[sourceIndex] ?? 0;
  }

  for (let blockSize = 2; blockSize <= size; blockSize *= 2) {
    const halfSize = blockSize / 2;
    const step = size / blockSize;
    for (let blockStart = 0; blockStart < size; blockStart += blockSize) {
      for (let offset = 0; offset < halfSize; offset += 1) {
        const twiddleIndex = offset * step;
        const twiddleReal = twiddles.real[twiddleIndex] ?? 0;
        const twiddleImag = twiddles.imag[twiddleIndex] ?? 0;
        const evenIndex = blockStart + offset;
        const oddIndex = evenIndex + halfSize;
        const evenReal = realOut[evenIndex] ?? 0;
        const evenImag = imagOut[evenIndex] ?? 0;
        const oddReal = (realOut[oddIndex] ?? 0) * twiddleReal - (imagOut[oddIndex] ?? 0) * twiddleImag;
        const oddImag = (realOut[oddIndex] ?? 0) * twiddleImag + (imagOut[oddIndex] ?? 0) * twiddleReal;
        realOut[evenIndex] = evenReal + oddReal;
        imagOut[evenIndex] = evenImag + oddImag;
        realOut[oddIndex] = evenReal - oddReal;
        imagOut[oddIndex] = evenImag - oddImag;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      realOut[index] /= size;
      imagOut[index] /= size;
    }
  }
}

export function reflectPad(signal: Float32Array, padLeft: number, padRight: number): Float32Array {
  const length = signal.length;
  const output = new Float32Array(padLeft + length + padRight);

  for (let index = 0; index < padLeft; index += 1) {
    output[index] = signal[Math.min(padLeft - index, length - 1)] ?? 0;
  }
  output.set(signal, padLeft);
  for (let index = 0; index < padRight; index += 1) {
    output[padLeft + length + index] = signal[Math.max(0, length - 2 - index)] ?? 0;
  }

  return output;
}

export function stft(signal: Float32Array, fftSize: number, hopSize: number): Spectrogram {
  const numFrames = Math.floor((signal.length - fftSize) / hopSize) + 1;
  const numBins = fftSize / 2 + 1;
  const window = getHannWindow(fftSize);
  const scale = 1 / Math.sqrt(fftSize);
  const real = new Float32Array(numFrames * numBins);
  const imag = new Float32Array(numFrames * numBins);
  const frameReal = new Float32Array(fftSize);
  const frameImag = new Float32Array(fftSize);
  const windowedFrame = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame += 1) {
    const start = frame * hopSize;
    for (let index = 0; index < fftSize; index += 1) {
      windowedFrame[index] = (signal[start + index] ?? 0) * (window[index] ?? 0);
    }
    runFft(frameReal, frameImag, windowedFrame, null, fftSize, false);

    const outputOffset = frame * numBins;
    for (let bin = 0; bin < numBins; bin += 1) {
      real[outputOffset + bin] = (frameReal[bin] ?? 0) * scale;
      imag[outputOffset + bin] = (frameImag[bin] ?? 0) * scale;
    }
  }

  return { real, imag, numFrames, numBins };
}

export function istft(
  specReal: Float32Array,
  specImag: Float32Array,
  numFrames: number,
  numBins: number,
  fftSize: number,
  hopSize: number,
  outputLength: number,
): Float32Array {
  const output = new Float32Array(outputLength);
  const windowSum = new Float32Array(outputLength);
  const window = getHannWindow(fftSize);
  const scale = Math.sqrt(fftSize);
  const fullReal = new Float32Array(fftSize);
  const fullImag = new Float32Array(fftSize);
  const frameReal = new Float32Array(fftSize);
  const frameImag = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame += 1) {
    fullReal.fill(0);
    fullImag.fill(0);
    for (let bin = 0; bin < numBins; bin += 1) {
      const sourceIndex = frame * numBins + bin;
      fullReal[bin] = specReal[sourceIndex] ?? 0;
      fullImag[bin] = specImag[sourceIndex] ?? 0;
    }
    for (let bin = 1; bin < numBins - 1; bin += 1) {
      fullReal[fftSize - bin] = fullReal[bin] ?? 0;
      fullImag[fftSize - bin] = -(fullImag[bin] ?? 0);
    }

    runFft(frameReal, frameImag, fullReal, fullImag, fftSize, true);
    const start = frame * hopSize;
    for (let index = 0; index < fftSize && start + index < outputLength; index += 1) {
      const windowValue = window[index] ?? 0;
      output[start + index] += (frameReal[index] ?? 0) * windowValue * scale;
      windowSum[start + index] += windowValue * windowValue;
    }
  }

  for (let index = 0; index < outputLength; index += 1) {
    const weight = windowSum[index] ?? 0;
    if (weight > 1e-8) {
      output[index] /= weight;
    }
  }

  return output;
}

export function resampleChannel(channel: Float32Array, sourceRate: number, targetRate: number): Float32Array {
  if (sourceRate === targetRate) {
    return new Float32Array(channel);
  }

  const outputLength = Math.max(1, Math.round((channel.length * targetRate) / sourceRate));
  const output = new Float32Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(channel.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    output[index] = (channel[leftIndex] ?? 0) * (1 - mix) + (channel[rightIndex] ?? 0) * mix;
  }
  return output;
}
