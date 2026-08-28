import { ExportFrameCaptureUnavailableError } from '../../../engine/export/ExportRenderSessionImpl';
import { Logger } from '../../../services/logger';
import { createExportRunId } from '../../../services/timeline/exportRuntimeReporting';
import { FFmpegFrameRenderer } from '../exportHelpers';
import {
  attachRenderSession,
  disposeRenderSession,
  encodeImageDataToBlob,
  getReadbackPixels,
  type ExportRenderSessionFactory,
  type ExportRenderSessionRef,
  type RunnerImageFormatOption,
} from './runnerUtils';

const log = Logger.create('StillImageExportRunner');

export interface StillImageExportRunnerInput {
  width: number;
  height: number;
  fps: number;
  exportTime: number;
  filename: string;
  imageFormat: string;
  imageQuality: number;
  selectedImageFormat: RunnerImageFormatOption;
  renderSessionRef: ExportRenderSessionRef;
  createRenderSession: ExportRenderSessionFactory;
}

export interface StillImageExportRunnerResult {
  blob: Blob;
  filename: string;
}

export async function runStillImageExport(
  input: StillImageExportRunnerInput,
): Promise<StillImageExportRunnerResult | null> {
  const frameRenderer = new FFmpegFrameRenderer({
    width: input.width,
    height: input.height,
    fps: input.fps,
    startTime: input.exportTime,
    endTime: input.exportTime + (1 / Math.max(input.fps, 1)),
  });
  let renderSession: ReturnType<ExportRenderSessionFactory> | null = null;

  try {
    await frameRenderer.initialize();
    renderSession = input.createRenderSession({
      runId: frameRenderer.getRuntimeRunId() ?? createExportRunId(),
      width: input.width,
      height: input.height,
      stackedAlpha: false,
      preferZeroCopy: false,
    });
    attachRenderSession(input.renderSessionRef, renderSession);
    await renderSession.begin();

    const layers = await frameRenderer.buildLayersAtTime(input.exportTime);
    let pixels: Uint8ClampedArray;
    try {
      const capture = await renderSession.renderFrame({
        time: input.exportTime,
        layers,
      });
      pixels = getReadbackPixels(capture);
    } catch (renderError) {
      if (
        renderError instanceof ExportFrameCaptureUnavailableError &&
        renderError.captureKind === 'rgba-pixels'
      ) {
        throw new Error('Failed to read frame from GPU');
      }
      throw renderError;
    }

    const imageData = new ImageData(new Uint8ClampedArray(pixels), input.width, input.height);
    const blob = await encodeImageDataToBlob(
      imageData,
      input.selectedImageFormat,
      input.imageQuality,
    );

    return {
      blob,
      filename: `${input.filename}_frame_${Math.floor(input.exportTime * 1000)}.${input.imageFormat}`,
    };
  } catch (error) {
    log.error('Frame render failed', error);
    throw error;
  } finally {
    disposeRenderSession(input.renderSessionRef, renderSession);
    frameRenderer.cleanup();
  }
}
