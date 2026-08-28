export function drawTimelineClipCanvasCover(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bmp: ImageBitmap,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const scale = Math.max(dw / bmp.width, dh / bmp.height);
  const sw = dw / scale;
  const sh = dh / scale;
  const sx = (bmp.width - sw) / 2;
  const sy = (bmp.height - sh) / 2;
  ctx.drawImage(bmp, sx, sy, sw, sh, dx, dy, dw, dh);
}
