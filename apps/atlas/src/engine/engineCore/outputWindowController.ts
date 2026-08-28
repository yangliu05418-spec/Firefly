import { useRenderTargetStore } from '../../stores/renderTargetStore';
import { getSavedTargetMeta, type SavedTargetMeta } from '../../stores/sliceStore';
import type { OutputWindowManager } from '../managers/OutputWindowManager';

export interface OutputWindowControllerDeps {
  getOutputWindowManager(): OutputWindowManager | null;
  registerTargetCanvas(targetId: string, canvas: HTMLCanvasElement): GPUCanvasContext | null;
  unregisterTargetCanvas(targetId: string): void;
}

export function createOutputWindow(
  deps: OutputWindowControllerDeps,
  id: string,
  name: string,
): { id: string; name: string } | null {
  const outputWindowManager = deps.getOutputWindowManager();
  if (!outputWindowManager) return null;

  const result = outputWindowManager.createWindow(id, name);
  if (!result) return null;

  const gpuContext = deps.registerTargetCanvas(id, result.canvas);
  if (!gpuContext) {
    result.window.close();
    return null;
  }

  useRenderTargetStore.getState().registerTarget({
    id,
    name,
    source: { type: 'activeComp' },
    destinationType: 'window',
    enabled: true,
    showTransparencyGrid: false,
    canvas: result.canvas,
    context: gpuContext,
    window: result.window,
    isFullscreen: false,
  });

  return { id, name };
}

export function closeOutputWindow(deps: OutputWindowControllerDeps, id: string): void {
  const target = useRenderTargetStore.getState().targets.get(id);
  if (target?.window && !target.window.closed) {
    target.window.close();
  }
  deps.unregisterTargetCanvas(id);
  useRenderTargetStore.getState().deactivateTarget(id);
}

export function restoreOutputWindow(deps: OutputWindowControllerDeps, id: string): boolean {
  const outputWindowManager = deps.getOutputWindowManager();
  if (!outputWindowManager) return false;

  const target = useRenderTargetStore.getState().targets.get(id);
  if (!target || target.destinationType !== 'window') return false;

  const savedTargets = getSavedTargetMeta();
  const savedMeta = savedTargets.find((t) => t.id === id);
  const geometry = savedMeta ? {
    screenX: savedMeta.screenX,
    screenY: savedMeta.screenY,
    outerWidth: savedMeta.outerWidth,
    outerHeight: savedMeta.outerHeight,
  } : undefined;

  const result = outputWindowManager.createWindow(id, target.name, geometry);
  if (!result) return false;

  const gpuContext = deps.registerTargetCanvas(id, result.canvas);
  if (!gpuContext) {
    result.window.close();
    return false;
  }

  const store = useRenderTargetStore.getState();
  store.setTargetCanvas(id, result.canvas, gpuContext);
  store.setTargetWindow(id, result.window);
  store.setTargetEnabled(id, true);

  if (savedMeta?.isFullscreen || target.isFullscreen) {
    result.canvas.requestFullscreen().catch(() => {});
  }

  return true;
}

export function removeOutputTarget(deps: OutputWindowControllerDeps, id: string): void {
  deps.unregisterTargetCanvas(id);
  useRenderTargetStore.getState().unregisterTarget(id);
}

export function reconnectOutputWindows(
  deps: OutputWindowControllerDeps,
  savedTargets: Array<Pick<SavedTargetMeta, 'id' | 'name' | 'source'>>,
): number {
  const outputWindowManager = deps.getOutputWindowManager();
  if (!outputWindowManager) return 0;

  let reconnected = 0;
  for (const saved of savedTargets) {
    const result = outputWindowManager.reconnectWindow(saved.id);
    if (!result) continue;

    const gpuContext = deps.registerTargetCanvas(saved.id, result.canvas);
    if (!gpuContext) continue;

    useRenderTargetStore.getState().registerTarget({
      id: saved.id,
      name: saved.name,
      source: saved.source,
      destinationType: 'window',
      enabled: true,
      showTransparencyGrid: false,
      canvas: result.canvas,
      context: gpuContext,
      window: result.window,
      isFullscreen: false,
    });

    reconnected++;
  }

  return reconnected;
}
