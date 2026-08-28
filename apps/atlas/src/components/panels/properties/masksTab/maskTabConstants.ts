import type { MaskMode } from "../../../../types/masks";

export const MASK_MODES: { value: MaskMode; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
];

export const DEFAULT_MASK_OUTLINE_COLOR = '#2997E5';

export const MASK_OUTLINE_COLORS = [
  '#2997E5',
  '#ff9900',
  '#7ddc7a',
  '#d16bff',
  '#ff5f6d',
  '#f8d34f',
];
