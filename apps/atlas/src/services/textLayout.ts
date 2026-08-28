export type {
  TextBoxRect,
  TextLayoutCharacter,
  TextLayoutLine,
  TextLayoutSnapshot,
  TextShapeLine,
} from './textLayoutEngine/textLayoutTypes';

export {
  applyTextBoundsPathValue,
  cloneTextBoundsPath,
  createDefaultTextBoundsPath,
  createTextBoundsFromRect,
  getTextBoundsBoundingBox,
  getTextBoundsPathValue,
  isAreaTextEnabled,
  resolveTextBoundsPath,
  resolveTextBoxRect,
  traceTextBoundsPath,
} from './textLayoutEngine/textBounds';

export { measureTextWithLetterSpacing } from './textLayoutEngine/textMeasurement';
export { wrapTextToShapeLines } from './textLayoutEngine/textShapeWrapping';
export { wrapTextToLines } from './textLayoutEngine/textLineWrapping';
export { createTextLayoutSnapshot } from './textLayoutEngine/textLayoutSnapshot';
