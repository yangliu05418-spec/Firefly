import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { acquireWorkerGpuDevice } from '../../src/services/render/workerGpuDevice';
import {
  createWorkerGpuTargetSurface,
  presentGpuClear,
  presentGpuTestPattern,
  reconfigureWorkerGpuTargetSurface,
} from '../../src/services/render/workerGpuTargetSurface';

function createFakeGpu() {
  const workDone = vi.fn(async () => undefined);
  const submit = vi.fn();
  const finish = vi.fn(() => ({ label: 'command-buffer' }));
  const passEnd = vi.fn();
  const beginRenderPass = vi.fn(() => ({ end: passEnd }));
  const createCommandEncoder = vi.fn(() => ({
    beginRenderPass,
    finish,
  }));
  const configure = vi.fn();
  const createView = vi.fn(() => ({ label: 'texture-view' }));
  const getCurrentTexture = vi.fn(() => ({ createView }));
  const context = {
    configure,
    getCurrentTexture,
  };
  const canvas = {
    width: 320,
    height: 180,
    getContext: vi.fn((kind: string) => kind === 'webgpu' ? context : null),
  } as unknown as OffscreenCanvas & {
    getContext: ReturnType<typeof vi.fn>;
  };
  const device = {
    features: new Set(['texture-compression-bc']),
    limits: { maxTextureDimension2D: 8192 },
    queue: {
      submit,
      onSubmittedWorkDone: workDone,
    },
    createCommandEncoder,
    destroy: vi.fn(),
  };
  const adapter = {
    info: {
      vendor: 'test-vendor',
      architecture: 'test-architecture',
      device: 'test-device',
      description: 'test adapter',
    },
    features: new Set(['timestamp-query']),
    limits: { maxTextureDimension2D: 8192 },
    requestDevice: vi.fn(async () => device),
  };
  const gpu = {
    requestAdapter: vi.fn(async () => adapter),
    getPreferredCanvasFormat: vi.fn(() => 'rgba8unorm' as GPUTextureFormat),
  };

  return {
    adapter,
    beginRenderPass,
    canvas,
    configure,
    context,
    createCommandEncoder,
    createView,
    device,
    finish,
    getCurrentTexture,
    gpu,
    passEnd,
    submit,
    workDone,
  };
}

describe('worker GPU target surface', () => {
  it('acquires a worker GPU device with structured diagnostics', async () => {
    const fake = createFakeGpu();

    const acquired = await acquireWorkerGpuDevice({ gpu: fake.gpu });

    expect(acquired.ok).toBe(true);
    expect(fake.gpu.requestAdapter).toHaveBeenCalledTimes(1);
    expect(fake.adapter.requestDevice).toHaveBeenCalledTimes(1);
    expect(acquired.diagnostics).toMatchObject({
      status: 'acquired',
      navigatorGpuAvailable: true,
      adapterRequested: true,
      adapterAcquired: true,
      deviceRequested: true,
      deviceAcquired: true,
      preferredCanvasFormat: 'rgba8unorm',
      preferredCanvasFormatSource: 'navigator-preferred',
      adapterInfo: {
        vendor: 'test-vendor',
        architecture: 'test-architecture',
        device: 'test-device',
        description: 'test adapter',
      },
      error: null,
    });
    expect(acquired.diagnostics.adapterFeatures).toEqual(['timestamp-query']);
    expect(acquired.diagnostics.deviceFeatures).toEqual(['texture-compression-bc']);
  });

  it('configures an OffscreenCanvas WebGPU context without using a CPU canvas path', async () => {
    const fake = createFakeGpu();

    const created = await createWorkerGpuTargetSurface({
      canvas: fake.canvas,
      gpu: fake.gpu,
      devicePixelRatio: 2,
      size: { width: 640, height: 360 },
    });

    expect(created.ok).toBe(true);
    expect(created.surface).not.toBeNull();
    expect(fake.canvas.getContext).toHaveBeenCalledTimes(1);
    expect(fake.canvas.getContext).toHaveBeenCalledWith('webgpu');
    expect(fake.configure).toHaveBeenCalledWith({
      device: fake.device,
      format: 'rgba8unorm',
      alphaMode: 'premultiplied',
    });
    expect(created.diagnostics).toMatchObject({
      status: 'configured',
      configured: true,
      contextAcquired: true,
      canvasWidth: 640,
      canvasHeight: 360,
      devicePixelRatio: 2,
      format: 'rgba8unorm',
      preferredFormatSource: 'navigator-preferred',
      configureCount: 1,
      lastPresentedFrameId: null,
      error: null,
    });
  });

  it('reconfigures a worker GPU surface after a target resize', async () => {
    const fake = createFakeGpu();
    const created = await createWorkerGpuTargetSurface({
      canvas: fake.canvas,
      gpu: fake.gpu,
    });

    const diagnostics = reconfigureWorkerGpuTargetSurface(created.surface!, {
      size: { width: 800, height: 450 },
      devicePixelRatio: 2,
    });

    expect(fake.configure).toHaveBeenCalledTimes(2);
    expect(diagnostics).toMatchObject({
      status: 'configured',
      canvasWidth: 800,
      canvasHeight: 450,
      devicePixelRatio: 2,
      configureCount: 2,
    });
  });

  it('presents a GPU-only clear test pattern and reports submit diagnostics', async () => {
    const fake = createFakeGpu();
    const created = await createWorkerGpuTargetSurface({
      canvas: fake.canvas,
      gpu: fake.gpu,
    });

    const presented = await presentGpuTestPattern(created.surface!, {
      targetId: 'preview',
      requestId: 'proof-1',
      frameIndex: 7,
    });

    expect(presented.ok).toBe(true);
    expect(fake.createCommandEncoder).toHaveBeenCalledWith({
      label: 'preview:proof-1:gpu-clear',
    });
    expect(fake.getCurrentTexture).toHaveBeenCalledTimes(1);
    expect(fake.createView).toHaveBeenCalledTimes(1);
    expect(fake.beginRenderPass).toHaveBeenCalledWith({
      colorAttachments: [{
        view: { label: 'texture-view' },
        clearValue: presented.diagnostics.clearValue,
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    expect(fake.passEnd).toHaveBeenCalledTimes(1);
    expect(fake.finish).toHaveBeenCalledTimes(1);
    expect(fake.submit).toHaveBeenCalledWith([{ label: 'command-buffer' }]);
    expect(fake.workDone).toHaveBeenCalledTimes(1);
    expect(presented.diagnostics).toMatchObject({
      status: 'presented',
      targetId: 'preview',
      requestId: 'proof-1',
      frameIndex: 7,
      presentedFrameId: 'preview:proof-1:gpu-clear:1',
      canvasWidth: 320,
      canvasHeight: 180,
      format: 'rgba8unorm',
      commandEncoderCreated: true,
      renderPassEnded: true,
      commandSubmitted: true,
      submittedWorkDoneResolved: true,
      error: null,
    });
    expect(created.surface!.diagnostics.lastPresentedFrameId).toBe('preview:proof-1:gpu-clear:1');
  });

  it('clamps explicit clear values and returns a structured present result', async () => {
    const fake = createFakeGpu();
    const created = await createWorkerGpuTargetSurface({
      canvas: fake.canvas,
      gpu: fake.gpu,
    });

    const presented = await presentGpuClear(created.surface!, {
      targetId: 'preview',
      requestId: 'clear-1',
      clearValue: { r: -1, g: 0.5, b: 2, a: 1.5 },
    });

    expect(presented.ok).toBe(true);
    expect(presented.diagnostics.clearValue).toEqual({
      r: 0,
      g: 0.5,
      b: 1,
      a: 1,
    });
  });

  it('fails closed when a WebGPU context is unavailable and does not ask for 2D fallback', async () => {
    const fake = createFakeGpu();
    const canvas = {
      width: 320,
      height: 180,
      getContext: vi.fn((kind: string) => kind === '2d' ? { fallback: true } : null),
    } as unknown as OffscreenCanvas & {
      getContext: ReturnType<typeof vi.fn>;
    };

    const created = await createWorkerGpuTargetSurface({
      canvas,
      gpu: fake.gpu,
    });

    expect(created.ok).toBe(false);
    expect(created.surface).toBeNull();
    expect(canvas.getContext).toHaveBeenCalledTimes(1);
    expect(canvas.getContext).toHaveBeenCalledWith('webgpu');
    expect(fake.gpu.requestAdapter).not.toHaveBeenCalled();
    expect(created.diagnostics).toMatchObject({
      status: 'webgpu-context-unavailable',
      configured: false,
      contextAcquired: false,
    });
  });

  it('keeps worker GPU modules free of software and DOM canvas fallback imports', () => {
    const targetSurfaceSource = readFileSync(
      'src/services/render/workerGpuTargetSurface.ts',
      'utf8',
    );
    const deviceSource = readFileSync(
      'src/services/render/workerGpuDevice.ts',
      'utf8',
    );

    expect(targetSurfaceSource).not.toMatch(/getContext\(['"]2d['"]\)/);
    expect(targetSurfaceSource).not.toMatch(/workerSoftware|WorkerRenderSoftwareFrame|HTMLCanvasElement/);
    expect(deviceSource).not.toMatch(/workerSoftware|WorkerRenderSoftwareFrame|HTMLCanvasElement/);
  });
});
