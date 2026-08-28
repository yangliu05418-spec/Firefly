export function createBlackThumbnail(width: number, height: number): string {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.fillStyle = 'black';
  ctx.fillRect(0, 0, width, height);

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');
  if (!tempCtx) return '';
  tempCtx.drawImage(canvas, 0, 0);
  return tempCanvas.toDataURL('image/jpeg', 0.6);
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
