import type { RenderTargetManager } from '../core/RenderTargetManager';
import type { Compositor } from '../render/Compositor';

export class PixelReadback {
  private readbackBuffer: GPUBuffer | null = null;
  private readbackBufferSize = 0;
  private readbackBytesPerRow = 0;
  private readbackHeight = 0;

  async readPixels(
    device: GPUDevice,
    renderTargetManager: RenderTargetManager,
    compositor: Compositor | null,
  ): Promise<Uint8ClampedArray | null> {
    const pingTex = renderTargetManager.getPingTexture();
    const pongTex = renderTargetManager.getPongTexture();
    if (!pingTex || !pongTex) return null;

    const { width, height } = renderTargetManager.getResolution();
    const sourceTexture = compositor?.getLastRenderWasPing() ? pingTex : pongTex;

    const bytesPerPixel = 4;
    const unalignedBytesPerRow = width * bytesPerPixel;
    const bytesPerRow = Math.ceil(unalignedBytesPerRow / 256) * 256;
    const bufferSize = bytesPerRow * height;
    const stagingBuffer = this.getOrCreateReadbackBuffer(device, bufferSize, bytesPerRow, height);
    if (!stagingBuffer) {
      return null;
    }

    const commandEncoder = device.createCommandEncoder();
    commandEncoder.copyTextureToBuffer(
      { texture: sourceTexture },
      { buffer: stagingBuffer, bytesPerRow, rowsPerImage: height },
      [width, height]
    );
    device.queue.submit([commandEncoder.finish()]);

    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const arrayBuffer = stagingBuffer.getMappedRange();
    const result = new Uint8ClampedArray(width * height * bytesPerPixel);
    const srcView = new Uint8Array(arrayBuffer);

    if (bytesPerRow === unalignedBytesPerRow) {
      result.set(srcView.subarray(0, result.length));
    } else {
      for (let y = 0; y < height; y++) {
        const srcOffset = y * bytesPerRow;
        const dstOffset = y * unalignedBytesPerRow;
        result.set(srcView.subarray(srcOffset, srcOffset + unalignedBytesPerRow), dstOffset);
      }
    }

    stagingBuffer.unmap();
    return result;
  }

  destroy(): void {
    if (this.readbackBuffer) {
      try {
        this.readbackBuffer.destroy();
      } catch {}
      this.readbackBuffer = null;
    }
    this.readbackBufferSize = 0;
    this.readbackBytesPerRow = 0;
    this.readbackHeight = 0;
  }

  private getOrCreateReadbackBuffer(
    device: GPUDevice,
    bufferSize: number,
    bytesPerRow: number,
    height: number,
  ): GPUBuffer | null {
    const needsNewBuffer =
      !this.readbackBuffer ||
      this.readbackBufferSize !== bufferSize ||
      this.readbackBytesPerRow !== bytesPerRow ||
      this.readbackHeight !== height;

    if (needsNewBuffer) {
      this.destroy();
      this.readbackBuffer = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      this.readbackBufferSize = bufferSize;
      this.readbackBytesPerRow = bytesPerRow;
      this.readbackHeight = height;
    }

    return this.readbackBuffer;
  }
}
