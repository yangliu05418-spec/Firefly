import {
  acquireWorkerGpuDevice,
  getWorkerGpuPreferredCanvasFormat,
  type WorkerGpuDeviceDiagnostics,
  type WorkerGpuDeviceOwner,
  type WorkerGpuNavigatorGpu,
  type WorkerGpuPreferredCanvasFormat,
} from './workerGpuDevice';

export type WorkerGpuTargetSurfaceStatus =
  | 'configured'
  | 'webgpu-context-unavailable'
  | 'device-unavailable'
  | 'configure-failed';

export interface WorkerGpuTargetSurfaceDiagnostics {
  readonly status: WorkerGpuTargetSurfaceStatus;
  readonly configured: boolean;
  readonly contextAcquired: boolean;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly devicePixelRatio: number;
  readonly format: GPUTextureFormat;
  readonly preferredFormatSource: WorkerGpuPreferredCanvasFormat['source'];
  readonly alphaMode: GPUCanvasAlphaMode;
  readonly colorSpace: PredefinedColorSpace | null;
  readonly configureCount: number;
  readonly lastPresentedFrameId: string | null;
  readonly device: WorkerGpuDeviceDiagnostics | null;
  readonly error: string | null;
}

export interface WorkerGpuTargetSurface {
  readonly kind: 'worker-gpu-target-surface';
  readonly canvas: OffscreenCanvas;
  readonly context: GPUCanvasContext;
  readonly adapter: GPUAdapter | null;
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  alphaMode: GPUCanvasAlphaMode;
  colorSpace: PredefinedColorSpace | null;
  readonly deviceDiagnostics: WorkerGpuDeviceDiagnostics | null;
  diagnostics: WorkerGpuTargetSurfaceDiagnostics;
  frameSequence: number;
}

export interface WorkerGpuTargetSurfaceCreateOptions {
  readonly canvas: OffscreenCanvas;
  readonly gpu?: WorkerGpuNavigatorGpu | null;
  readonly deviceOwner?: WorkerGpuDeviceOwner | null;
  readonly device?: GPUDevice | null;
  readonly adapter?: GPUAdapter | null;
  readonly format?: GPUTextureFormat;
  readonly alphaMode?: GPUCanvasAlphaMode;
  readonly colorSpace?: PredefinedColorSpace;
  readonly devicePixelRatio?: number;
  readonly size?: {
    readonly width: number;
    readonly height: number;
  };
}

export interface WorkerGpuTargetSurfaceCreateResult {
  readonly ok: boolean;
  readonly surface: WorkerGpuTargetSurface | null;
  readonly diagnostics: WorkerGpuTargetSurfaceDiagnostics;
}

export interface WorkerGpuTargetSurfaceReconfigureOptions {
  readonly size?: {
    readonly width: number;
    readonly height: number;
  };
  readonly devicePixelRatio?: number;
  readonly alphaMode?: GPUCanvasAlphaMode;
  readonly colorSpace?: PredefinedColorSpace;
}

export interface WorkerGpuClearValue {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

export type WorkerGpuPresentStatus = 'presented' | 'present-failed';

export interface WorkerGpuPresentDiagnostics {
  readonly status: WorkerGpuPresentStatus;
  readonly targetId: string;
  readonly requestId: string;
  readonly frameIndex: number;
  readonly presentedFrameId: string | null;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly format: GPUTextureFormat;
  readonly clearValue: WorkerGpuClearValue;
  readonly commandEncoderCreated: boolean;
  readonly renderPassEnded: boolean;
  readonly commandSubmitted: boolean;
  readonly submittedWorkDoneResolved: boolean;
  readonly error: string | null;
}

export interface WorkerGpuPresentResult {
  readonly ok: boolean;
  readonly diagnostics: WorkerGpuPresentDiagnostics;
}

export interface WorkerGpuPresentBaseOptions {
  readonly targetId?: string;
  readonly requestId?: string;
  readonly frameIndex?: number;
}

export interface WorkerGpuClearOptions extends WorkerGpuPresentBaseOptions {
  readonly clearValue: WorkerGpuClearValue;
}

const DEFAULT_ALPHA_MODE: GPUCanvasAlphaMode = 'premultiplied';
const DEFAULT_TARGET_ID = 'worker-gpu-target';
const DEFAULT_REQUEST_ID = 'gpu-test-pattern';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function finitePositive(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function applySurfaceSize(
  canvas: OffscreenCanvas,
  size: WorkerGpuTargetSurfaceCreateOptions['size'] | undefined,
): void {
  if (!size) return;
  canvas.width = Math.max(1, Math.ceil(size.width));
  canvas.height = Math.max(1, Math.ceil(size.height));
}

function createSurfaceDiagnostics(input: {
  readonly status: WorkerGpuTargetSurfaceStatus;
  readonly configured: boolean;
  readonly contextAcquired: boolean;
  readonly canvas: OffscreenCanvas;
  readonly devicePixelRatio: number;
  readonly format: GPUTextureFormat;
  readonly preferredFormat: WorkerGpuPreferredCanvasFormat;
  readonly alphaMode: GPUCanvasAlphaMode;
  readonly colorSpace: PredefinedColorSpace | null;
  readonly configureCount: number;
  readonly lastPresentedFrameId: string | null;
  readonly deviceDiagnostics: WorkerGpuDeviceDiagnostics | null;
  readonly error: string | null;
}): WorkerGpuTargetSurfaceDiagnostics {
  return {
    status: input.status,
    configured: input.configured,
    contextAcquired: input.contextAcquired,
    canvasWidth: input.canvas.width,
    canvasHeight: input.canvas.height,
    devicePixelRatio: input.devicePixelRatio,
    format: input.format,
    preferredFormatSource: input.preferredFormat.source,
    alphaMode: input.alphaMode,
    colorSpace: input.colorSpace,
    configureCount: input.configureCount,
    lastPresentedFrameId: input.lastPresentedFrameId,
    device: input.deviceDiagnostics,
    error: input.error ?? input.preferredFormat.error,
  };
}

function configureContext(input: {
  readonly context: GPUCanvasContext;
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  readonly alphaMode: GPUCanvasAlphaMode;
  readonly colorSpace: PredefinedColorSpace | null;
}): void {
  const configuration: GPUCanvasConfiguration = {
    device: input.device,
    format: input.format,
    alphaMode: input.alphaMode,
  };
  if (input.colorSpace) {
    configuration.colorSpace = input.colorSpace;
  }
  input.context.configure(configuration);
}

export async function createWorkerGpuTargetSurface(
  options: WorkerGpuTargetSurfaceCreateOptions,
): Promise<WorkerGpuTargetSurfaceCreateResult> {
  const alphaMode = options.alphaMode ?? DEFAULT_ALPHA_MODE;
  const colorSpace = options.colorSpace ?? null;
  const devicePixelRatio = finitePositive(options.devicePixelRatio, 1);
  const preferredFormat = getWorkerGpuPreferredCanvasFormat(options.gpu);
  const format = options.format ?? options.deviceOwner?.diagnostics.preferredCanvasFormat ?? preferredFormat.format;

  applySurfaceSize(options.canvas, options.size);

  const context = options.canvas.getContext('webgpu');
  if (!context) {
    const diagnostics = createSurfaceDiagnostics({
      status: 'webgpu-context-unavailable',
      configured: false,
      contextAcquired: false,
      canvas: options.canvas,
      devicePixelRatio,
      format,
      preferredFormat,
      alphaMode,
      colorSpace,
      configureCount: 0,
      lastPresentedFrameId: null,
      deviceDiagnostics: options.deviceOwner?.diagnostics ?? null,
      error: null,
    });
    return { ok: false, surface: null, diagnostics };
  }

  const acquired = options.device || options.deviceOwner
    ? null
    : await acquireWorkerGpuDevice({ gpu: options.gpu });
  const device = options.device ?? options.deviceOwner?.device ?? acquired?.owner?.device ?? null;
  const adapter = options.adapter ?? options.deviceOwner?.adapter ?? acquired?.owner?.adapter ?? null;
  const deviceDiagnostics = options.deviceOwner?.diagnostics ?? acquired?.diagnostics ?? null;

  if (!device) {
    const diagnostics = createSurfaceDiagnostics({
      status: 'device-unavailable',
      configured: false,
      contextAcquired: true,
      canvas: options.canvas,
      devicePixelRatio,
      format,
      preferredFormat,
      alphaMode,
      colorSpace,
      configureCount: 0,
      lastPresentedFrameId: null,
      deviceDiagnostics,
      error: deviceDiagnostics?.error ?? null,
    });
    return { ok: false, surface: null, diagnostics };
  }

  try {
    configureContext({
      context,
      device,
      format,
      alphaMode,
      colorSpace,
    });
  } catch (error) {
    const diagnostics = createSurfaceDiagnostics({
      status: 'configure-failed',
      configured: false,
      contextAcquired: true,
      canvas: options.canvas,
      devicePixelRatio,
      format,
      preferredFormat,
      alphaMode,
      colorSpace,
      configureCount: 0,
      lastPresentedFrameId: null,
      deviceDiagnostics,
      error: errorMessage(error),
    });
    return { ok: false, surface: null, diagnostics };
  }

  const diagnostics = createSurfaceDiagnostics({
    status: 'configured',
    configured: true,
    contextAcquired: true,
    canvas: options.canvas,
    devicePixelRatio,
    format,
    preferredFormat,
    alphaMode,
    colorSpace,
    configureCount: 1,
    lastPresentedFrameId: null,
    deviceDiagnostics,
    error: null,
  });

  return {
    ok: true,
    surface: {
      kind: 'worker-gpu-target-surface',
      canvas: options.canvas,
      context,
      adapter,
      device,
      format,
      alphaMode,
      colorSpace,
      deviceDiagnostics,
      diagnostics,
      frameSequence: 0,
    },
    diagnostics,
  };
}

export function reconfigureWorkerGpuTargetSurface(
  surface: WorkerGpuTargetSurface,
  options: WorkerGpuTargetSurfaceReconfigureOptions = {},
): WorkerGpuTargetSurfaceDiagnostics {
  applySurfaceSize(surface.canvas, options.size);
  const alphaMode = options.alphaMode ?? surface.alphaMode;
  const colorSpace = options.colorSpace ?? surface.colorSpace;
  const preferredFormat: WorkerGpuPreferredCanvasFormat = {
    format: surface.format,
    source: surface.diagnostics.preferredFormatSource,
    error: null,
  };

  try {
    configureContext({
      context: surface.context,
      device: surface.device,
      format: surface.format,
      alphaMode,
      colorSpace,
    });
    surface.alphaMode = alphaMode;
    surface.colorSpace = colorSpace;
    surface.diagnostics = createSurfaceDiagnostics({
      status: 'configured',
      configured: true,
      contextAcquired: true,
      canvas: surface.canvas,
      devicePixelRatio: finitePositive(options.devicePixelRatio, surface.diagnostics.devicePixelRatio),
      format: surface.format,
      preferredFormat,
      alphaMode,
      colorSpace,
      configureCount: surface.diagnostics.configureCount + 1,
      lastPresentedFrameId: surface.diagnostics.lastPresentedFrameId,
      deviceDiagnostics: surface.deviceDiagnostics,
      error: null,
    });
    return surface.diagnostics;
  } catch (error) {
    surface.diagnostics = createSurfaceDiagnostics({
      status: 'configure-failed',
      configured: false,
      contextAcquired: true,
      canvas: surface.canvas,
      devicePixelRatio: finitePositive(options.devicePixelRatio, surface.diagnostics.devicePixelRatio),
      format: surface.format,
      preferredFormat,
      alphaMode,
      colorSpace,
      configureCount: surface.diagnostics.configureCount,
      lastPresentedFrameId: surface.diagnostics.lastPresentedFrameId,
      deviceDiagnostics: surface.deviceDiagnostics,
      error: errorMessage(error),
    });
    return surface.diagnostics;
  }
}

export function selectGpuTestPatternClearValue(frameIndex: number): WorkerGpuClearValue {
  void frameIndex;
  return {
    r: 0,
    g: 0,
    b: 0,
    a: 1,
  };
}

function normalizeClearValue(clearValue: WorkerGpuClearValue): WorkerGpuClearValue {
  return {
    r: clampUnit(clearValue.r),
    g: clampUnit(clearValue.g),
    b: clampUnit(clearValue.b),
    a: clampUnit(clearValue.a),
  };
}

function createPresentDiagnostics(input: {
  readonly status: WorkerGpuPresentStatus;
  readonly surface: WorkerGpuTargetSurface;
  readonly targetId: string;
  readonly requestId: string;
  readonly frameIndex: number;
  readonly presentedFrameId: string | null;
  readonly clearValue: WorkerGpuClearValue;
  readonly commandEncoderCreated: boolean;
  readonly renderPassEnded: boolean;
  readonly commandSubmitted: boolean;
  readonly submittedWorkDoneResolved: boolean;
  readonly error: string | null;
}): WorkerGpuPresentDiagnostics {
  return {
    status: input.status,
    targetId: input.targetId,
    requestId: input.requestId,
    frameIndex: input.frameIndex,
    presentedFrameId: input.presentedFrameId,
    canvasWidth: input.surface.canvas.width,
    canvasHeight: input.surface.canvas.height,
    format: input.surface.format,
    clearValue: input.clearValue,
    commandEncoderCreated: input.commandEncoderCreated,
    renderPassEnded: input.renderPassEnded,
    commandSubmitted: input.commandSubmitted,
    submittedWorkDoneResolved: input.submittedWorkDoneResolved,
    error: input.error,
  };
}

export async function presentGpuClear(
  surface: WorkerGpuTargetSurface,
  options: WorkerGpuClearOptions,
): Promise<WorkerGpuPresentResult> {
  const targetId = options.targetId ?? DEFAULT_TARGET_ID;
  const requestId = options.requestId ?? DEFAULT_REQUEST_ID;
  const frameIndex = options.frameIndex ?? surface.frameSequence + 1;
  const clearValue = normalizeClearValue(options.clearValue);
  const nextSequence = surface.frameSequence + 1;
  const presentedFrameId = `${targetId}:${requestId}:gpu-clear:${nextSequence}`;
  let commandEncoderCreated = false;
  let renderPassEnded = false;
  let commandSubmitted = false;
  let submittedWorkDoneResolved = false;
  let pass: GPURenderPassEncoder | null = null;

  try {
    const commandEncoder = surface.device.createCommandEncoder({
      label: `${targetId}:${requestId}:gpu-clear`,
    });
    commandEncoderCreated = true;
    pass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: surface.context.getCurrentTexture().createView(),
        clearValue,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    pass.end();
    renderPassEnded = true;
    surface.device.queue.submit([commandEncoder.finish()]);
    commandSubmitted = true;

    if (typeof surface.device.queue.onSubmittedWorkDone === 'function') {
      await surface.device.queue.onSubmittedWorkDone();
      submittedWorkDoneResolved = true;
    }

    surface.frameSequence = nextSequence;
    surface.diagnostics = {
      ...surface.diagnostics,
      lastPresentedFrameId: presentedFrameId,
    };

    return {
      ok: true,
      diagnostics: createPresentDiagnostics({
        status: 'presented',
        surface,
        targetId,
        requestId,
        frameIndex,
        presentedFrameId,
        clearValue,
        commandEncoderCreated,
        renderPassEnded,
        commandSubmitted,
        submittedWorkDoneResolved,
        error: null,
      }),
    };
  } catch (error) {
    if (pass && !renderPassEnded) {
      try {
        pass.end();
        renderPassEnded = true;
      } catch {
        // Ignore cleanup errors after a failed WebGPU command.
      }
    }
    return {
      ok: false,
      diagnostics: createPresentDiagnostics({
        status: 'present-failed',
        surface,
        targetId,
        requestId,
        frameIndex,
        presentedFrameId: null,
        clearValue,
        commandEncoderCreated,
        renderPassEnded,
        commandSubmitted,
        submittedWorkDoneResolved,
        error: errorMessage(error),
      }),
    };
  }
}

export function presentGpuTestPattern(
  surface: WorkerGpuTargetSurface,
  options: WorkerGpuPresentBaseOptions = {},
): Promise<WorkerGpuPresentResult> {
  const frameIndex = options.frameIndex ?? surface.frameSequence + 1;
  return presentGpuClear(surface, {
    ...options,
    frameIndex,
    clearValue: selectGpuTestPatternClearValue(frameIndex),
  });
}
