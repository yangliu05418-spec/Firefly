import type { LayerRenderData } from '../../core/types';
import { getCopiedHtmlVideoPreviewFrame } from '../htmlVideoPreviewFallback';
import type { HtmlVideoCollectRequest } from './htmlVideoCollector';

export function collectExportHtmlVideo(
  request: HtmlVideoCollectRequest,
  currentTime: number,
  targetTime: number
): LayerRenderData | null {
  const { layer, video, deps, videoKey, controller } = request;
  const copiedFrame = getCopiedHtmlVideoPreviewFrame(
    video,
    deps.scrubbingCache,
    targetTime,
    layer.sourceClipId,
    layer.sourceClipId,
  );
  if (copiedFrame) {
    controller.setDecoder('HTMLVideo');
    controller.markHasVideo();
    return {
      layer,
      isVideo: false,
      externalTexture: null,
      textureView: copiedFrame.view,
      sourceWidth: copiedFrame.width,
      sourceHeight: copiedFrame.height,
      displayedMediaTime: copiedFrame.mediaTime ?? currentTime,
      targetMediaTime: targetTime,
      previewPath: 'copied-preview',
    };
  }

  const extTex = deps.textureManager.importVideoTexture(video);
  if (!extTex) {
    return null;
  }

  deps.setLastVideoTime(videoKey, currentTime);
  controller.setDecoder('HTMLVideo');
  controller.markHasVideo();
  return {
    layer,
    isVideo: true,
    externalTexture: extTex,
    textureView: null,
    sourceWidth: video.videoWidth,
    sourceHeight: video.videoHeight,
    displayedMediaTime: currentTime,
    targetMediaTime: targetTime,
    previewPath: 'live-import',
  };
}
