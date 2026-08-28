// Demucs model input/output mapping for the stem separation worker:
// stereo normalization, waveform + magnitude-spec input prep, and
// frequency-domain output reconstruction back to time-domain stems.
// Pure tensor-data mapping — ONNX session lifecycle stays in the worker entry.

import type * as ort from 'onnxruntime-web';
import type { StemModelCatalogEntry, StemSeparationInput } from '../types';
import { istft, reflectPad, resampleChannel, stft } from './stemDsp';

export const FFT_SIZE = 4096;
export const HOP_SIZE = 1024;
export const TRAINING_SAMPLES = 343_980;
export const MODEL_SPEC_BINS = 2048;
export const MODEL_SPEC_FRAMES = 336;

export interface PreparedDemucsInput {
  waveform: Float32Array;
  magSpec: Float32Array;
}

export interface StereoChannels {
  left: Float32Array;
  right: Float32Array;
}

export function prepareModelInput(leftChannel: Float32Array, rightChannel: Float32Array): PreparedDemucsInput {
  const paddedLeft = new Float32Array(TRAINING_SAMPLES);
  const paddedRight = new Float32Array(TRAINING_SAMPLES);
  paddedLeft.set(leftChannel.subarray(0, Math.min(leftChannel.length, TRAINING_SAMPLES)));
  paddedRight.set(rightChannel.subarray(0, Math.min(rightChannel.length, TRAINING_SAMPLES)));

  const expectedFrames = Math.ceil(TRAINING_SAMPLES / HOP_SIZE);
  const padLeft = Math.floor(HOP_SIZE / 2) * 3;
  const padRight = padLeft + expectedFrames * HOP_SIZE - TRAINING_SAMPLES;
  const centeredPad = FFT_SIZE / 2;
  const stftLeft = stft(
    reflectPad(reflectPad(paddedLeft, padLeft, padRight), centeredPad, centeredPad),
    FFT_SIZE,
    HOP_SIZE,
  );
  const stftRight = stft(
    reflectPad(reflectPad(paddedRight, padLeft, padRight), centeredPad, centeredPad),
    FFT_SIZE,
    HOP_SIZE,
  );

  const magSpec = new Float32Array(4 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES);
  const frameOffset = 2;
  for (let frame = 0; frame < MODEL_SPEC_FRAMES; frame += 1) {
    const sourceFrame = frame + frameOffset;
    for (let bin = 0; bin < MODEL_SPEC_BINS; bin += 1) {
      const sourceIndex = sourceFrame * stftLeft.numBins + bin;
      const outputIndex = bin * MODEL_SPEC_FRAMES + frame;
      magSpec[outputIndex] = stftLeft.real[sourceIndex] ?? 0;
      magSpec[MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + outputIndex] = stftLeft.imag[sourceIndex] ?? 0;
      magSpec[2 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + outputIndex] = stftRight.real[sourceIndex] ?? 0;
      magSpec[3 * MODEL_SPEC_BINS * MODEL_SPEC_FRAMES + outputIndex] = stftRight.imag[sourceIndex] ?? 0;
    }
  }

  const waveform = new Float32Array(2 * TRAINING_SAMPLES);
  waveform.set(paddedLeft, 0);
  waveform.set(paddedRight, TRAINING_SAMPLES);
  return { waveform, magSpec };
}

export function normalizeToModelStereo(input: StemSeparationInput, model: StemModelCatalogEntry): StereoChannels {
  if (input.channelCount <= 0 || input.channels.length <= 0) {
    throw new Error('Stem separation input has no audio channels.');
  }
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new Error('Stem separation input has an invalid sample rate.');
  }

  const leftSource = input.channels[0];
  const rightSource = input.channels[1] ?? input.channels[0];
  if (!leftSource || !rightSource || input.frameCount <= 0) {
    throw new Error('Stem separation input has no audio samples.');
  }

  return {
    left: resampleChannel(leftSource, input.sampleRate, model.inputSampleRate),
    right: resampleChannel(rightSource, input.sampleRate, model.inputSampleRate),
  };
}

export function frequencyOutputToSpecs(freqOutput: Float32Array): StereoChannels[] {
  const specs: StereoChannels[] = [];
  const channelsPerStem = 4;
  const planeSize = MODEL_SPEC_BINS * MODEL_SPEC_FRAMES;

  for (let stemIndex = 0; stemIndex < 4; stemIndex += 1) {
    const leftReal = new Float32Array(planeSize);
    const leftImag = new Float32Array(planeSize);
    const rightReal = new Float32Array(planeSize);
    const rightImag = new Float32Array(planeSize);

    for (let frame = 0; frame < MODEL_SPEC_FRAMES; frame += 1) {
      for (let bin = 0; bin < MODEL_SPEC_BINS; bin += 1) {
        const sourceOffset = stemIndex * channelsPerStem * planeSize;
        const outputIndex = bin * MODEL_SPEC_FRAMES + frame;
        leftReal[outputIndex] = freqOutput[sourceOffset + outputIndex] ?? 0;
        leftImag[outputIndex] = freqOutput[sourceOffset + planeSize + outputIndex] ?? 0;
        rightReal[outputIndex] = freqOutput[sourceOffset + 2 * planeSize + outputIndex] ?? 0;
        rightImag[outputIndex] = freqOutput[sourceOffset + 3 * planeSize + outputIndex] ?? 0;
      }
    }

    const leftPadded = padFrequencySpec(leftReal, leftImag);
    const rightPadded = padFrequencySpec(rightReal, rightImag);
    const paddedFrames = MODEL_SPEC_FRAMES + 4;
    const paddedBins = MODEL_SPEC_BINS + 1;
    const istftLength = (paddedFrames - 1) * HOP_SIZE + FFT_SIZE;
    const totalOffset = FFT_SIZE / 2 + Math.floor(HOP_SIZE / 2) * 3;
    const leftFull = istft(leftPadded.real, leftPadded.imag, paddedFrames, paddedBins, FFT_SIZE, HOP_SIZE, istftLength);
    const rightFull = istft(rightPadded.real, rightPadded.imag, paddedFrames, paddedBins, FFT_SIZE, HOP_SIZE, istftLength);
    specs.push({
      left: new Float32Array(leftFull.subarray(totalOffset, totalOffset + TRAINING_SAMPLES)),
      right: new Float32Array(rightFull.subarray(totalOffset, totalOffset + TRAINING_SAMPLES)),
    });
  }

  return specs;
}

function padFrequencySpec(real: Float32Array, imag: Float32Array): { real: Float32Array; imag: Float32Array } {
  const paddedBins = MODEL_SPEC_BINS + 1;
  const paddedFrames = MODEL_SPEC_FRAMES + 4;
  const paddedReal = new Float32Array(paddedFrames * paddedBins);
  const paddedImag = new Float32Array(paddedFrames * paddedBins);

  for (let frame = 0; frame < MODEL_SPEC_FRAMES; frame += 1) {
    for (let bin = 0; bin < MODEL_SPEC_BINS; bin += 1) {
      const sourceIndex = bin * MODEL_SPEC_FRAMES + frame;
      const destinationIndex = (frame + 2) * paddedBins + bin;
      paddedReal[destinationIndex] = real[sourceIndex] ?? 0;
      paddedImag[destinationIndex] = imag[sourceIndex] ?? 0;
    }
  }

  return { real: paddedReal, imag: paddedImag };
}

function getTensorData(tensor: ort.Tensor | undefined): Float32Array | null {
  if (!tensor || tensor.type !== 'float32') {
    return null;
  }
  return tensor.data as Float32Array;
}

export function findDemucsOutputs(results: Record<string, ort.Tensor>): {
  timeData: Float32Array;
  timeShape: number[];
  freqData: Float32Array | null;
} {
  let timeData: Float32Array | null = null;
  let timeShape: number[] | null = null;
  let freqData: Float32Array | null = null;

  for (const tensor of Object.values(results)) {
    const dims = tensor.dims.map(Number);
    const data = getTensorData(tensor);
    if (!data) continue;

    if (dims.length === 4 && dims[2] === 2) {
      timeData = data;
      timeShape = dims;
    } else if (dims.length === 5 && dims[2] === 4) {
      freqData = data;
    }
  }

  if (!timeData || !timeShape) {
    throw new Error('Stem model did not return a time-domain output tensor.');
  }

  return { timeData, timeShape, freqData };
}
