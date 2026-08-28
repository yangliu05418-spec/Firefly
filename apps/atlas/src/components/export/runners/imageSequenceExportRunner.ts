import {
  blobToUint8Array,
  createImageSequenceZip,
  getImageSequenceFolderName,
  getImageSequenceFrameName,
  isImageSequenceFolderExportSupported,
  isImageSequenceFolderSelectionAbort,
  pickImageSequenceOutputDirectory,
  writeImageSequenceFrame,
  type ImageSequenceDirectoryHandle,
  type ImageSequenceEntry,
} from '../../../engine/export/ImageSequenceExporter';
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

const log = Logger.create('ImageSequenceExportRunner');

export interface ImageSequenceExportRunnerInput {
  width: number;
  height: number;
  fps: number;
  startTime: number;
  endTime: number;
  exportMode: 'fast' | 'precise';
  filename: string;
  imageFormat: string;
  imageQuality: number;
  selectedImageFormat: RunnerImageFormatOption;
  frameRendererRef: { current: FFmpegFrameRenderer | null };
  renderSessionRef: ExportRenderSessionRef;
  createRenderSession: ExportRenderSessionFactory;
  onTimelineStart: (startTime: number, endTime: number) => void;
  onProgress: (progress: {
    phase: 'video' | 'muxing';
    currentFrame: number;
    totalFrames: number;
    percent: number;
    estimatedTimeRemaining: number;
    currentTime: number;
  }) => void;
  onTimelineProgress: (percent: number, time: number) => void;
}

export type ImageSequenceExportRunnerResult =
  | { kind: 'folder'; folderName: string }
  | { kind: 'zip'; blob: Blob; filename: string };

export async function runImageSequenceExport(
  input: ImageSequenceExportRunnerInput,
): Promise<ImageSequenceExportRunnerResult | null> {
  const frameDuration = 1 / Math.max(input.fps, 1);
  const totalFrames = Math.max(1, Math.ceil(Math.max(0, input.endTime - input.startTime) * input.fps));
  const folderExportSupported = isImageSequenceFolderExportSupported();
  const sequenceFolderName = getImageSequenceFolderName(input.filename, input.imageFormat);
  const frameRenderer = new FFmpegFrameRenderer({
    width: input.width,
    height: input.height,
    fps: input.fps,
    startTime: input.startTime,
    endTime: Math.max(input.endTime, input.startTime + frameDuration),
    exportMode: input.exportMode,
    runtimeReporting: true,
    runtimeExportKind: 'image-sequence',
  });
  input.frameRendererRef.current = frameRenderer;
  let renderSession: ReturnType<ExportRenderSessionFactory> | null = null;

  try {
    const outputDirectory: ImageSequenceDirectoryHandle | null = folderExportSupported
      ? await pickImageSequenceOutputDirectory(sequenceFolderName)
      : null;

    input.onTimelineStart(input.startTime, input.endTime);
    await frameRenderer.initialize();

    const sequenceEntries: ImageSequenceEntry[] = [];
    const startedAt = performance.now();
    renderSession = input.createRenderSession({
      runId: frameRenderer.getRuntimeRunId() ?? createExportRunId(),
      width: input.width,
      height: input.height,
      stackedAlpha: false,
      preferZeroCopy: false,
    });
    attachRenderSession(input.renderSessionRef, renderSession);
    await renderSession.begin();

    for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
      if (frameRenderer.isCancelled()) {
        return null;
      }

      const frameTime = input.startTime + frameIndex * frameDuration;
      const layers = await frameRenderer.buildLayersAtTime(frameTime);

      const capture = await renderSession.renderFrame({
        time: frameTime,
        layers,
      });
      const pixels = getReadbackPixels(capture);

      const imageData = new ImageData(new Uint8ClampedArray(pixels), input.width, input.height);
      const blob = await encodeImageDataToBlob(
        imageData,
        input.selectedImageFormat,
        input.imageQuality,
      );
      const filenameForFrame = getImageSequenceFrameName(
        input.filename,
        frameIndex,
        totalFrames,
        input.imageFormat,
      );
      if (outputDirectory) {
        await writeImageSequenceFrame(outputDirectory, filenameForFrame, blob);
      } else {
        sequenceEntries.push({
          filename: filenameForFrame,
          data: await blobToUint8Array(blob),
        });
      }

      const completedFrames = frameIndex + 1;
      const renderPercent = (completedFrames / totalFrames) * 92;
      const elapsedMs = performance.now() - startedAt;
      const avgFrameMs = elapsedMs / completedFrames;
      const remainingFrames = totalFrames - completedFrames;
      input.onProgress({
        phase: 'video',
        currentFrame: completedFrames,
        totalFrames,
        percent: renderPercent,
        estimatedTimeRemaining: (remainingFrames * avgFrameMs) / 1000,
        currentTime: frameTime,
      });
      input.onTimelineProgress(renderPercent, frameTime);
    }

    if (frameRenderer.isCancelled()) {
      return null;
    }

    if (!outputDirectory) {
      input.onProgress({
        phase: 'muxing',
        currentFrame: totalFrames,
        totalFrames,
        percent: 96,
        estimatedTimeRemaining: 0,
        currentTime: input.endTime,
      });
      input.onTimelineProgress(96, input.endTime);

      const zipBlob = createImageSequenceZip(sequenceEntries);
      return {
        kind: 'zip',
        blob: zipBlob,
        filename: `${sequenceFolderName}.zip`,
      };
    }

    input.onProgress({
      phase: 'muxing',
      currentFrame: totalFrames,
      totalFrames,
      percent: 100,
      estimatedTimeRemaining: 0,
      currentTime: input.endTime,
    });
    input.onTimelineProgress(100, input.endTime);

    return {
      kind: 'folder',
      folderName: sequenceFolderName,
    };
  } catch (error) {
    if (isImageSequenceFolderSelectionAbort(error)) {
      log.info('Image sequence folder export cancelled');
      return null;
    }
    if (frameRenderer.isCancelled()) {
      log.info('Image sequence export cancelled');
      return null;
    }
    log.error('Image sequence export failed', error);
    throw error;
  } finally {
    disposeRenderSession(input.renderSessionRef, renderSession);
    frameRenderer.cleanup();
    input.frameRendererRef.current = null;
  }
}
