import type { ClipMask, MaskPathKeyframeValue } from "../../../../types/masks";

import { DEFAULT_MASK_OUTLINE_COLOR } from './maskTabConstants';

export function getColorInputValue(color: string | undefined): string {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? color! : DEFAULT_MASK_OUTLINE_COLOR;
}

export function getMaskPathValue(mask: ClipMask): MaskPathKeyframeValue {
  return {
    closed: mask.closed,
    vertices: mask.vertices.map(vertex => ({
      ...vertex,
      handleIn: { ...vertex.handleIn },
      handleOut: { ...vertex.handleOut },
    })),
  };
}
