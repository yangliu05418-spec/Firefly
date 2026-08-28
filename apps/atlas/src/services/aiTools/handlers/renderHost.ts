import {
  getRenderHostDevMode,
  setRenderHostDevMode,
  type RenderHostDevMode,
} from '../../render/renderHostPort';
import type { ToolResult } from '../types';

type RenderHostModeRequest = RenderHostDevMode | 'default';

const ALLOWED_RENDER_HOST_MODES = new Set<RenderHostModeRequest>([
  'main',
  'worker-shadow',
  'worker-presenting',
  'worker-only',
  'worker-gpu-only',
  'default',
]);

function readRequestedMode(args: Record<string, unknown>): RenderHostModeRequest | null {
  const mode = args.mode;
  if (typeof mode !== 'string') return null;
  return ALLOWED_RENDER_HOST_MODES.has(mode as RenderHostModeRequest)
    ? mode as RenderHostModeRequest
    : null;
}

export async function handleSetRenderHostMode(args: Record<string, unknown>): Promise<ToolResult> {
  const requestedMode = readRequestedMode(args);
  if (!requestedMode) {
    return {
      success: false,
      error: 'mode must be one of: main, worker-shadow, worker-presenting, worker-only, worker-gpu-only, default',
    };
  }

  const previousMode = getRenderHostDevMode();
  const nextMode = requestedMode === 'default' ? null : requestedMode;
  const telemetry = setRenderHostDevMode(nextMode);

  return {
    success: true,
    data: {
      previousMode,
      requestedMode,
      nextMode: getRenderHostDevMode(),
      telemetry,
    },
  };
}
