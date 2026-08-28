import { SORT_THRESHOLD } from './renderParams';

interface WorkerSorterLike {
  readonly hasSortedOrder: boolean;
  requestSort(viewMatrix: Float32Array, worldMatrix: Float32Array, requestedCount: number): void;
  applyPending(queue: GPUQueue): number;
}

export interface WorkerSortSceneState {
  framesSinceSort: number;
  workerSorter: WorkerSorterLike | null;
  workerSortedBindGroup: GPUBindGroup | null;
}

export interface WorkerSortFrameResult {
  canUseWorkerSort: boolean;
  usedWorkerSort: boolean;
  drawCount: number;
}

export function updateWorkerSortFrame(
  scene: WorkerSortSceneState,
  queue: GPUQueue,
  viewMatrix: Float32Array,
  worldMatrix: Float32Array,
  effectiveSplatCount: number,
  sortFrequency: number,
  precise: boolean,
): WorkerSortFrameResult {
  const canUseWorkerSort = !precise &&
    sortFrequency !== 0 &&
    scene.workerSorter !== null &&
    scene.workerSortedBindGroup !== null;

  let drawCount = effectiveSplatCount;
  let usedWorkerSort = false;

  if (canUseWorkerSort && scene.workerSorter) {
    const requestThisFrame = !scene.workerSorter.hasSortedOrder ||
      sortFrequency <= 1 ||
      scene.framesSinceSort + 1 >= sortFrequency;

    if (requestThisFrame) {
      scene.workerSorter.requestSort(viewMatrix, worldMatrix, effectiveSplatCount);
      scene.framesSinceSort = 0;
    } else {
      scene.framesSinceSort++;
    }

    const sortedCount = scene.workerSorter.applyPending(queue);
    if (sortedCount >= 0) {
      drawCount = Math.min(sortedCount, effectiveSplatCount);
    }
    usedWorkerSort = scene.workerSorter.hasSortedOrder;
  }

  return { canUseWorkerSort, usedWorkerSort, drawCount };
}

interface GpuSortPassLike {
  readonly isInitialized: boolean;
  execute(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    splatBuffer: GPUBuffer,
    indexBuffer: GPUBuffer,
    visibleCount: number,
    viewMatrix: Float32Array,
    worldMatrix: Float32Array,
  ): GPUBuffer | null;
}

export interface GpuSortSceneState {
  framesSinceSort: number;
  sortedBindGroup: GPUBindGroup | null;
  identityIndexBuffer: GPUBuffer;
}

export interface GpuSortFrameOptions {
  scene: GpuSortSceneState;
  sortPass: GpuSortPassLike;
  device: GPUDevice;
  commandEncoder: GPUCommandEncoder;
  activeSplatBuffer: GPUBuffer;
  cullIndexBuffer: GPUBuffer | null;
  effectiveSplatCount: number;
  drawCount: number;
  canUseWorkerSort: boolean;
  precise: boolean;
  hasValidatedCullResult: boolean;
  sortFrequency: number;
  viewMatrix: Float32Array;
  worldMatrix: Float32Array;
}

export interface GpuSortFrameResult {
  sortedIndexBuffer: GPUBuffer | null;
  shouldSort: boolean;
  sortThisFrame: boolean;
}

export function updateGpuSortFrame(options: GpuSortFrameOptions): GpuSortFrameResult {
  const shouldSort = !options.canUseWorkerSort &&
    options.effectiveSplatCount > SORT_THRESHOLD &&
    (options.precise || options.hasValidatedCullResult);
  const sortThisFrame = shouldSort && (
    options.sortFrequency !== 0 && (
      !options.scene.sortedBindGroup ||
      options.sortFrequency <= 1 ||
      options.scene.framesSinceSort + 1 >= options.sortFrequency
    )
  );

  let sortedIndexBuffer: GPUBuffer | null = null;
  if (sortThisFrame && options.sortPass.isInitialized) {
    const sourceIndexBuffer = options.precise
      ? options.scene.identityIndexBuffer
      : (options.cullIndexBuffer ?? options.scene.identityIndexBuffer);
    const sortCount = options.precise
      ? options.effectiveSplatCount
      : (options.hasValidatedCullResult ? options.drawCount : options.effectiveSplatCount);

    const sorted = options.sortPass.execute(
      options.device,
      options.commandEncoder,
      options.activeSplatBuffer,
      sourceIndexBuffer,
      sortCount,
      options.viewMatrix,
      options.worldMatrix,
    );

    if (sorted) {
      sortedIndexBuffer = sorted;
      options.scene.framesSinceSort = 0;
    }
  } else if (shouldSort) {
    options.scene.framesSinceSort++;
  }

  return { sortedIndexBuffer, shouldSort, sortThisFrame };
}
