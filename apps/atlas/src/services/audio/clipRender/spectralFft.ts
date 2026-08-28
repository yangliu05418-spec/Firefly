export function nextPowerOfTwo(value: number): number {
  let power = 1;
  while (power < value) {
    power *= 2;
  }
  return power;
}

export function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

export function hannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  if (size <= 1) {
    window.fill(1);
    return window;
  }

  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
  }
  return window;
}


export function fftRadix2(real: Float32Array, imag: Float32Array, inverse = false): void {
  const n = real.length;
  if (n !== imag.length || !isPowerOfTwo(n)) {
    throw new Error('FFT buffers must be equal power-of-two lengths.');
  }

  let j = 0;
  for (let i = 1; i < n - 1; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const realSwap = real[i];
      real[i] = real[j];
      real[j] = realSwap;
      const imagSwap = imag[i];
      imag[i] = imag[j];
      imag[j] = imagSwap;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = (inverse ? 2 : -2) * Math.PI / size;
    const phaseStepReal = Math.cos(angle);
    const phaseStepImag = Math.sin(angle);

    for (let offset = 0; offset < n; offset += size) {
      let phaseReal = 1;
      let phaseImag = 0;
      for (let index = 0; index < half; index += 1) {
        const evenIndex = offset + index;
        const oddIndex = evenIndex + half;
        const oddReal = real[oddIndex] * phaseReal - imag[oddIndex] * phaseImag;
        const oddImag = real[oddIndex] * phaseImag + imag[oddIndex] * phaseReal;
        real[oddIndex] = real[evenIndex] - oddReal;
        imag[oddIndex] = imag[evenIndex] - oddImag;
        real[evenIndex] += oddReal;
        imag[evenIndex] += oddImag;

        const nextPhaseReal = phaseReal * phaseStepReal - phaseImag * phaseStepImag;
        phaseImag = phaseReal * phaseStepImag + phaseImag * phaseStepReal;
        phaseReal = nextPhaseReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < n; index += 1) {
      real[index] /= n;
      imag[index] /= n;
    }
  }
}
