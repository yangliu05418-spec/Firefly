import { calculateSourcePixelScale } from '../../utils/sourcePixelScale';

export interface CompositorPixelGeometryInput {
  sourceWidth: number;
  sourceHeight: number;
  renderWidth: number;
  renderHeight: number;
  logicalWidth: number;
  logicalHeight: number;
}

export interface CompositorPixelGeometry {
  sourceAspect: number;
  outputAspect: number;
  sourcePixelScale: number;
}

/**
 * Resolves transform geometry in project-space pixels. The backing render
 * resolution is deliberately excluded: preview quality may change raster
 * density, but must never resize or reposition media in the composition.
 */
export function resolveCompositorPixelGeometry(
  input: CompositorPixelGeometryInput,
): CompositorPixelGeometry {
  void input.renderWidth;
  void input.renderHeight;
  const logicalWidth = finitePositive(input.logicalWidth, 1);
  const logicalHeight = finitePositive(input.logicalHeight, 1);
  const sourceWidth = finitePositive(input.sourceWidth, logicalWidth);
  const sourceHeight = finitePositive(input.sourceHeight, logicalHeight);

  return {
    sourceAspect: sourceWidth / sourceHeight,
    outputAspect: logicalWidth / logicalHeight,
    sourcePixelScale: calculateSourcePixelScale(
      sourceWidth,
      sourceHeight,
      logicalWidth,
      logicalHeight,
    ),
  };
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
