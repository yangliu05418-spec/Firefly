import * as ort from 'onnxruntime-web';
import { flags } from '../../../engine/featureFlags';
import { requireStemModel } from './modelCatalog';
import type {
  StemModelCatalogEntry,
  StemSeparationWorkerBackendPreference,
  StemSeparationBackend,
  StemSeparationInput,
  StemSeparationWorkerRequest,
  StemSeparationWorkerResponse,
  StemSeparationWorkerStemResult,
} from './types';
import {
  createStemOverlapWindow,
  createStemSegmentStarts,
} from './segmentSchedule';
import {
  MODEL_SPEC_BINS,
  MODEL_SPEC_FRAMES,
  TRAINING_SAMPLES,
  findDemucsOutputs,
  frequencyOutputToSpecs,
  normalizeToModelStereo,
  prepareModelInput,
} from './worker/demucsModelIO';

const SEGMENT_OVERLAP = 0.25;

ort.env.wasm.proxy = false;
ort.env.wasm.numThreads = 1;

let session: ort.InferenceSession | null = null;
let loadedModel: StemModelCatalogEntry | null = null;
let loadedBackend: StemSeparationBackend | null = null;
const cancelledJobs = new Set<string>();

function post(message: StemSeparationWorkerResponse, transfer?: Transferable[]): void {
  self.postMessage(message, { transfer: transfer ?? [] });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  return `${Math.round(bytes / 1_000_000)} MB`;
}

function concatChunksToArrayBuffer(chunks: readonly Uint8Array[], totalBytes: number): ArrayBuffer {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function getNavigatorGpu(): GPU | undefined {
  return (self.navigator as Navigator & { gpu?: GPU }).gpu;
}

function throwIfCancelled(jobId: string): void {
  if (cancelledJobs.has(jobId)) {
    const error = new Error('Stem separation was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
}

async function createOrtSession(
  source: string | ArrayBuffer,
  options: ort.InferenceSession.SessionOptions,
): Promise<ort.InferenceSession> {
  if (typeof source === 'string') {
    return ort.InferenceSession.create(source, options);
  }
  return ort.InferenceSession.create(source, options);
}

async function loadModelFromSource(
  modelId: string,
  source: string | ArrayBuffer,
  backendPreference: StemSeparationWorkerBackendPreference = 'auto',
): Promise<void> {
  const model = requireStemModel(modelId);
  const canUseWebGpu = model.supportedBackends.includes('webgpu') && Boolean(getNavigatorGpu());
  const preferWebGpu = canUseWebGpu && (
    backendPreference === 'webgpu' ||
    (backendPreference === 'auto' && flags.stemSeparationWebGPU)
  );
  const baseOptions: ort.InferenceSession.SessionOptions = {
    graphOptimizationLevel: 'basic',
    enableCpuMemArena: false,
    enableMemPattern: false,
  };

  try {
    session = await createOrtSession(source, {
      ...baseOptions,
      executionProviders: preferWebGpu ? ['webgpu', 'wasm'] : ['wasm'],
    });
    loadedBackend = preferWebGpu ? 'webgpu' : 'wasm';
  } catch (error) {
    if (!preferWebGpu) throw error;
    session = await createOrtSession(source, {
      ...baseOptions,
      executionProviders: ['wasm'],
    });
    loadedBackend = 'wasm';
  }

  loadedModel = model;
}

async function loadModel(
  modelId: string,
  modelBuffers: readonly { buffer: ArrayBuffer }[],
  backendPreference: StemSeparationWorkerBackendPreference = 'auto',
): Promise<void> {
  const firstBuffer = modelBuffers[0]?.buffer;
  if (!firstBuffer) {
    throw new Error(`Stem separation model ${modelId} did not provide an ONNX file.`);
  }

  post({
    type: 'model-load-progress',
    modelId,
    phase: 'loading-model',
    progress: 0.2,
    message: 'Cached stem model reached worker. Opening runtime session.',
  });
  post({
    type: 'model-load-progress',
    modelId,
    phase: 'loading-model',
    progress: 0.9,
    message: 'Creating stem model runtime session.',
  });
  await loadModelFromSource(modelId, firstBuffer, backendPreference);
}

async function loadModelFromUrl(
  modelId: string,
  modelUrl: string,
  backendPreference: StemSeparationWorkerBackendPreference = 'auto',
): Promise<void> {
  if (!modelUrl) {
    throw new Error(`Stem separation model ${modelId} did not provide a URL.`);
  }

  const model = requireStemModel(modelId);
  const response = await fetch(modelUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download stem model: HTTP ${response.status}`);
  }

  const expectedBytes = Number(response.headers.get('content-length')) || model.files[0]?.sizeBytes || 0;
  let sessionSource: string | ArrayBuffer = modelUrl;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        downloadedBytes += value.byteLength;
        post({
          type: 'model-load-progress',
          modelId,
          phase: 'loading-model',
          progress: expectedBytes > 0 ? Math.min(0.85, downloadedBytes / expectedBytes) : 0.25,
          message: `Loading stem model in worker ${formatBytes(downloadedBytes)} / ${formatBytes(expectedBytes)}`,
        });
      }
    } finally {
      reader.releaseLock();
    }

    sessionSource = concatChunksToArrayBuffer(chunks, downloadedBytes);
    post({
      type: 'model-load-progress',
      modelId,
      phase: 'loading-model',
      progress: 0.88,
      message: `Stem model downloaded ${formatBytes(downloadedBytes)}. Opening runtime session.`,
    });
  } else {
    sessionSource = await response.arrayBuffer();
    post({
      type: 'model-load-progress',
      modelId,
      phase: 'loading-model',
      progress: 0.35,
      message: 'Stem model response is ready. Opening runtime session.',
    });
  }

  post({
    type: 'model-load-progress',
    modelId,
    phase: 'loading-model',
    progress: 0.9,
    message: 'Creating stem model runtime session.',
  });
  await loadModelFromSource(modelId, sessionSource, backendPreference);
}

async function separate(jobId: string, input: StemSeparationInput): Promise<StemSeparationWorkerStemResult[]> {
  if (!session || !loadedModel || loadedModel.id !== input.modelId) {
    throw new Error(`Stem separation model ${input.modelId} is not loaded.`);
  }

  const model = loadedModel;
  const stereo = normalizeToModelStereo(input, model);
  const totalSamples = stereo.left.length;
  const stride = Math.max(1, Math.floor(TRAINING_SAMPLES * (1 - SEGMENT_OVERLAP)));
  const segmentStarts = createStemSegmentStarts(totalSamples, TRAINING_SAMPLES, stride);
  const totalSegments = segmentStarts.length;
  const outputs = model.outputStemOrder.map(() => ({
    left: new Float32Array(totalSamples),
    right: new Float32Array(totalSamples),
  }));
  const weights = new Float32Array(totalSamples);

  for (let segmentIndex = 0; segmentIndex < segmentStarts.length; segmentIndex += 1) {
    throwIfCancelled(jobId);
    const start = segmentStarts[segmentIndex] ?? 0;
    const end = Math.min(start + TRAINING_SAMPLES, totalSamples);
    const segmentLength = end - start;
    const segmentLeft = new Float32Array(TRAINING_SAMPLES);
    const segmentRight = new Float32Array(TRAINING_SAMPLES);
    segmentLeft.set(stereo.left.subarray(start, end));
    segmentRight.set(stereo.right.subarray(start, end));

    post({
      type: 'progress',
      jobId,
      phase: 'separating',
      progress: segmentIndex / totalSegments,
      message: `Separating stem segment ${segmentIndex + 1} of ${totalSegments}`,
    });

    const prepared = prepareModelInput(segmentLeft, segmentRight);
    const waveformTensor = new ort.Tensor('float32', prepared.waveform, [1, 2, TRAINING_SAMPLES]);
    const magSpecTensor = new ort.Tensor('float32', prepared.magSpec, [1, 4, MODEL_SPEC_BINS, MODEL_SPEC_FRAMES]);
    const feeds: Record<string, ort.Tensor> = {
      [session.inputNames[0] ?? 'waveform']: waveformTensor,
    };
    if (session.inputNames.length > 1) {
      feeds[session.inputNames[1] ?? 'spec'] = magSpecTensor;
    }

    const inference = await session.run(feeds);
    throwIfCancelled(jobId);

    const { timeData, timeShape, freqData } = findDemucsOutputs(inference);
    const numTracks = Math.min(timeShape[1] ?? outputs.length, outputs.length);
    const numChannels = timeShape[2] ?? 2;
    const samples = timeShape[3] ?? TRAINING_SAMPLES;
    const frequencyOutputs = freqData ? frequencyOutputToSpecs(freqData) : null;
    const previousStart = segmentStarts[segmentIndex - 1];
    const nextStart = segmentStarts[segmentIndex + 1];
    const previousOverlap = previousStart === undefined ? 0 : Math.max(0, previousStart + TRAINING_SAMPLES - start);
    const nextOverlap = nextStart === undefined ? 0 : Math.max(0, start + TRAINING_SAMPLES - nextStart);
    const overlapWindow = createStemOverlapWindow(segmentLength, previousOverlap, nextOverlap);

    for (let trackIndex = 0; trackIndex < numTracks; trackIndex += 1) {
      const track = outputs[trackIndex];
      if (!track) continue;

      for (let index = 0; index < segmentLength && start + index < totalSamples; index += 1) {
        const frequencyTrack = frequencyOutputs?.[trackIndex];
        const timeBase = trackIndex * numChannels * samples;
        const leftValue = frequencyTrack
          ? (timeData[timeBase + index] ?? 0) + (frequencyTrack.left[index] ?? 0)
          : timeData[timeBase + index] ?? 0;
        const rightValue = frequencyTrack
          ? (timeData[timeBase + samples + index] ?? 0) + (frequencyTrack.right[index] ?? 0)
          : timeData[timeBase + samples + index] ?? 0;
        const weight = overlapWindow[index] ?? 0;
        track.left[start + index] += leftValue * weight;
        track.right[start + index] += rightValue * weight;
      }
    }

    for (let index = 0; index < segmentLength && start + index < totalSamples; index += 1) {
      weights[start + index] += overlapWindow[index] ?? 0;
    }

    post({
      type: 'progress',
      jobId,
      phase: 'separating',
      progress: (segmentIndex + 1) / totalSegments,
      message: `Separated stem segment ${segmentIndex + 1} of ${totalSegments}`,
    });
  }

  for (const track of outputs) {
    for (let index = 0; index < totalSamples; index += 1) {
      const weight = weights[index] ?? 0;
      if (weight > 0) {
        track.left[index] /= weight;
        track.right[index] /= weight;
      }
    }
  }

  return outputs.map((track, index) => ({
    kind: model.outputStemOrder[index] ?? model.stems[index] ?? 'other',
    sampleRate: model.inputSampleRate,
    channels: [track.left, track.right],
  }));
}

self.onmessage = async (event: MessageEvent<StemSeparationWorkerRequest>) => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'load-model':
        await loadModel(message.modelId, message.modelBuffers, message.backendPreference);
        post({
          type: 'model-ready',
          modelId: message.modelId,
          backend: loadedBackend ?? 'wasm',
        });
        break;

      case 'load-model-url':
        await loadModelFromUrl(message.modelId, message.modelUrl, message.backendPreference);
        post({
          type: 'model-ready',
          modelId: message.modelId,
          backend: loadedBackend ?? 'wasm',
        });
        break;

      case 'separate': {
        cancelledJobs.delete(message.jobId);
        const stems = await separate(message.jobId, message.input);
        const transfer = stems.flatMap(stem => stem.channels.map(channel => channel.buffer));
        post({ type: 'result', jobId: message.jobId, stems }, transfer);
        break;
      }

      case 'cancel':
        cancelledJobs.add(message.jobId);
        post({ type: 'cancelled', jobId: message.jobId });
        break;

      case 'dispose-model':
        session = null;
        loadedModel = null;
        loadedBackend = null;
        cancelledJobs.clear();
        break;

      default:
        post({ type: 'error', error: `Unknown stem worker message: ${(message as { type?: unknown }).type}` });
        break;
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError' && 'jobId' in message) {
      post({ type: 'cancelled', jobId: message.jobId });
      return;
    }

    post({
      type: 'error',
      jobId: 'jobId' in message ? message.jobId : undefined,
      error: getErrorMessage(error),
    });
  }
};
