export const VIDEO_IMAGE_RATIOS = [21 / 9, 16 / 9, 4 / 3, 1, 3 / 4, 9 / 16] as const;
/** Leave headroom below TOS image/info's hard 20 MiB processing limit. */
export const IMAGE_REENCODE_THRESHOLD_BYTES = 18 * 1024 * 1024;

export type ImageNormalizationPlan = {
  adjusted: boolean;
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  drawX: number;
  drawY: number;
  drawWidth: number;
  drawHeight: number;
};

const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);

const closestStandardRatio = (ratio: number) => VIDEO_IMAGE_RATIOS.reduce((closest, candidate) => (
  Math.abs(Math.log(candidate / ratio)) < Math.abs(Math.log(closest / ratio)) ? candidate : closest
));

/**
 * ModelArk accepts image dimensions from 300 to 6000 px and ratios strictly
 * between 0.4 and 2.5. TOS image/info accepts at most 20 MiB, so oversized
 * source files are re-encoded with headroom even when their dimensions are
 * valid. Adjusted files are contained on a white canvas and capped to keep
 * batch preprocessing responsive on ordinary laptops.
 */
export const imageNormalizationPlan = (sourceWidth: number, sourceHeight: number, sourceBytes = 0): ImageNormalizationPlan => {
  if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error("无法识别图片尺寸");
  }
  const sourceRatio = sourceWidth / sourceHeight;
  const adjusted = sourceWidth < 300 || sourceWidth > 6000 || sourceHeight < 300 || sourceHeight > 6000
    || sourceRatio <= .4 || sourceRatio >= 2.5 || sourceBytes > IMAGE_REENCODE_THRESHOLD_BYTES;
  if (!adjusted) return { adjusted: false, sourceWidth, sourceHeight, targetWidth: sourceWidth, targetHeight: sourceHeight, drawX: 0, drawY: 0, drawWidth: sourceWidth, drawHeight: sourceHeight };

  const targetRatio = sourceRatio <= .4 || sourceRatio >= 2.5 ? closestStandardRatio(sourceRatio) : sourceRatio;
  let canvasWidth = sourceWidth;
  let canvasHeight = sourceHeight;
  if (sourceRatio > targetRatio) canvasHeight = sourceWidth / targetRatio;
  else if (sourceRatio < targetRatio) canvasWidth = sourceHeight * targetRatio;

  const maxScale = Math.min(1, 4096 / Math.max(canvasWidth, canvasHeight), Math.sqrt(12_000_000 / (canvasWidth * canvasHeight)));
  canvasWidth *= maxScale;
  canvasHeight *= maxScale;
  const minimumScale = Math.max(1, 512 / Math.min(canvasWidth, canvasHeight));
  canvasWidth *= minimumScale;
  canvasHeight *= minimumScale;

  const targetWidth = even(canvasWidth);
  const targetHeight = even(canvasHeight);
  const drawScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const drawWidth = sourceWidth * drawScale;
  const drawHeight = sourceHeight * drawScale;
  return {
    adjusted: true,
    sourceWidth,
    sourceHeight,
    targetWidth,
    targetHeight,
    drawX: (targetWidth - drawWidth) / 2,
    drawY: (targetHeight - drawHeight) / 2,
    drawWidth,
    drawHeight
  };
};
