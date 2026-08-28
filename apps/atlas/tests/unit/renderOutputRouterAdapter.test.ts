import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderTargetSnapshot } from '../../src/engine/render/contracts';

const mockFactory = vi.hoisted(() => {
  const snapshot = {
    resolution: { width: 1280, height: 720 },
    targets: [{
      id: 'target-a',
      name: 'Target A',
      source: { type: 'activeComp' },
      destinationType: 'canvas',
      enabled: true,
      showTransparencyGrid: true,
      isFullscreen: false,
    }],
    activeCompositionTargetIds: ['target-a'],
    independentTargetIds: [],
    sliceConfigs: {},
    outputPreview: { activeTab: 'output', previewingTargetId: null },
  };

  return {
    snapshot,
    captureRenderTargetSnapshot: vi.fn(() => snapshot),
  };
});

vi.mock('../../src/services/render/renderTargetSnapshotFactory', () => ({
  captureRenderTargetSnapshot: mockFactory.captureRenderTargetSnapshot,
}));

import { RenderOutputRouterAdapter } from '../../src/engine/render/RenderOutputRouterAdapter';

function createRouter() {
  const previewContext = { label: 'preview' } as unknown as GPUCanvasContext;
  const targetContext = { label: 'target' } as unknown as GPUCanvasContext;
  const exportContext = { label: 'export' } as unknown as GPUCanvasContext;
  const outputPipeline = {
    updateResolution: vi.fn(),
    createOutputBindGroup: vi.fn(),
    renderToCanvas: vi.fn(),
  };
  const slicePipeline = {
    buildVertexBuffer: vi.fn(),
    renderSlicedOutput: vi.fn(),
  };
  const canvasTargets = {
    registerTargetCanvas: vi.fn(() => targetContext),
    unregisterTargetCanvas: vi.fn(),
    getTargetContext: vi.fn(() => targetContext),
  };
  const runtime = {
    getPreviewContext: vi.fn(() => previewContext),
    getOutputPipeline: vi.fn(() => outputPipeline as never),
    getSlicePipeline: vi.fn(() => slicePipeline as never),
    getResolution: vi.fn(() => ({ width: 1920, height: 1080 })),
    shouldSkipPreviewOutput: vi.fn(() => false),
    getExportCanvasContext: vi.fn(() => null),
    isExporting: vi.fn(() => false),
  };
  const adapter = new RenderOutputRouterAdapter({
    canvasTargets,
    ...runtime,
  });

  return {
    adapter,
    canvasTargets,
    exportContext,
    outputPipeline,
    previewContext,
    runtime,
    targetContext,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RenderOutputRouterAdapter', () => {
  it('delegates snapshot capture to the render target snapshot factory', () => {
    const { adapter } = createRouter();

    const snapshot = adapter.captureSnapshot();

    expect(snapshot).toBe(mockFactory.snapshot);
    expect(mockFactory.captureRenderTargetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('delegates target registration, unregistration, and context lookup to the engine target delegate', () => {
    const { adapter, canvasTargets, targetContext } = createRouter();
    const canvas = {} as HTMLCanvasElement;

    expect(adapter.registerCanvasTarget({ id: 'target-a', canvas })).toBe(targetContext);
    adapter.unregisterTarget('target-a');
    expect(adapter.getTargetContext('target-a')).toBe(targetContext);

    expect(canvasTargets.registerTargetCanvas).toHaveBeenCalledWith('target-a', canvas);
    expect(canvasTargets.unregisterTargetCanvas).toHaveBeenCalledWith('target-a');
    expect(canvasTargets.getTargetContext).toHaveBeenCalledWith('target-a');
  });

  it('routes composite frames through the existing output pipeline, target context, and export target', () => {
    const { adapter, exportContext, outputPipeline, previewContext, targetContext } = createRouter();
    const commandEncoder = {} as GPUCommandEncoder;
    const sourceView = {} as GPUTextureView;
    const sampler = {} as GPUSampler;
    const previewBindGroup = { label: 'preview-bind-group' } as unknown as GPUBindGroup;
    const targetBindGroup = { label: 'target-bind-group' } as unknown as GPUBindGroup;
    const exportBindGroup = { label: 'export-bind-group' } as unknown as GPUBindGroup;
    outputPipeline.createOutputBindGroup
      .mockReturnValueOnce(previewBindGroup)
      .mockReturnValueOnce(targetBindGroup)
      .mockReturnValueOnce(exportBindGroup);

    adapter.routeCompositeFrame({
      commandEncoder,
      sourceView,
      sampler,
      snapshot: mockFactory.snapshot as RenderTargetSnapshot,
      targetIds: ['target-a'],
      exportTarget: { context: exportContext, mode: 'stackedAlpha' },
    });

    expect(outputPipeline.updateResolution).toHaveBeenCalledWith(1920, 1080);
    expect(outputPipeline.createOutputBindGroup).toHaveBeenNthCalledWith(1, sampler, sourceView, 'normal');
    expect(outputPipeline.createOutputBindGroup).toHaveBeenNthCalledWith(2, sampler, sourceView, 'grid');
    expect(outputPipeline.createOutputBindGroup).toHaveBeenNthCalledWith(3, sampler, sourceView, 'stackedAlpha');
    expect(outputPipeline.renderToCanvas).toHaveBeenNthCalledWith(1, commandEncoder, previewContext, previewBindGroup);
    expect(outputPipeline.renderToCanvas).toHaveBeenNthCalledWith(2, commandEncoder, targetContext, targetBindGroup);
    expect(outputPipeline.renderToCanvas).toHaveBeenNthCalledWith(3, commandEncoder, exportContext, exportBindGroup);
  });

  it('routes empty frames through the existing output pipeline and target context', () => {
    const { adapter, outputPipeline, previewContext, targetContext } = createRouter();
    const commandEncoder = {} as GPUCommandEncoder;
    const sourceView = {} as GPUTextureView;
    const sampler = {} as GPUSampler;
    const previewBindGroup = { label: 'preview-bind-group' } as unknown as GPUBindGroup;
    const targetBindGroup = { label: 'target-bind-group' } as unknown as GPUBindGroup;
    outputPipeline.createOutputBindGroup
      .mockReturnValueOnce(previewBindGroup)
      .mockReturnValueOnce(targetBindGroup);

    adapter.routeEmptyFrame({
      commandEncoder,
      sourceView,
      sampler,
      snapshot: mockFactory.snapshot as RenderTargetSnapshot,
      targetIds: ['target-a'],
    });

    expect(outputPipeline.updateResolution).toHaveBeenCalledWith(1920, 1080);
    expect(outputPipeline.createOutputBindGroup).toHaveBeenNthCalledWith(1, sampler, sourceView, 'normal');
    expect(outputPipeline.createOutputBindGroup).toHaveBeenNthCalledWith(2, sampler, sourceView, 'grid');
    expect(outputPipeline.renderToCanvas).toHaveBeenNthCalledWith(1, commandEncoder, previewContext, previewBindGroup);
    expect(outputPipeline.renderToCanvas).toHaveBeenNthCalledWith(2, commandEncoder, targetContext, targetBindGroup);
  });

  it('routes cached frames through the existing output pipeline with the original bind group', () => {
    const { adapter, outputPipeline, previewContext, targetContext } = createRouter();
    const commandEncoder = {} as GPUCommandEncoder;
    const bindGroup = { label: 'cached-bind-group' } as unknown as GPUBindGroup;

    adapter.routeCachedFrame({
      commandEncoder,
      bindGroup,
      time: 2.5,
      snapshot: mockFactory.snapshot as RenderTargetSnapshot,
      targetIds: ['target-a'],
    });

    expect(outputPipeline.renderToCanvas).toHaveBeenNthCalledWith(1, commandEncoder, previewContext, bindGroup);
    expect(outputPipeline.renderToCanvas).toHaveBeenNthCalledWith(2, commandEncoder, targetContext, bindGroup);
  });
});
