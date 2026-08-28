import type { WebGPUContext } from '../core/WebGPUContext';
import type { RenderDispatcher } from '../render/RenderDispatcher';
import type { EngineResourceSet } from './engineResources';

export interface DebugInfrastructureState {
  hasDevice: boolean;
  hasRenderDispatcher: boolean;
  hasRenderTargetManager: boolean;
  hasPreviewContext: boolean;
  targetCanvasCount: number;
  hasLayerCollector: boolean;
  hasCompositor: boolean;
  hasSampler: boolean;
  hasCompositorPipeline: boolean;
  hasOutputPipeline: boolean;
  hasPingView: boolean;
  hasPongView: boolean;
}

export interface DebugInfrastructureStateDeps {
  context: WebGPUContext;
  renderDispatcher: RenderDispatcher | null;
  previewContext: GPUCanvasContext | null;
  targetCanvases: Map<string, { canvas: HTMLCanvasElement; context: GPUCanvasContext }>;
  resources: EngineResourceSet | null;
}

export function buildDebugInfrastructureState(deps: DebugInfrastructureStateDeps): DebugInfrastructureState {
  const res = deps.resources;
  return {
    hasDevice: deps.context.getDevice() !== null,
    hasRenderDispatcher: deps.renderDispatcher !== null,
    hasRenderTargetManager: res !== null,
    hasPreviewContext: deps.previewContext !== null,
    targetCanvasCount: deps.targetCanvases.size,
    hasLayerCollector: res !== null,
    hasCompositor: res !== null,
    hasSampler: (res?.sampler ?? null) !== null,
    hasCompositorPipeline: (res?.compositorPipeline ?? null) !== null,
    hasOutputPipeline: (res?.outputPipeline ?? null) !== null,
    hasPingView: res?.renderTargetManager.getPingView() != null,
    hasPongView: res?.renderTargetManager.getPongView() != null,
  };
}
