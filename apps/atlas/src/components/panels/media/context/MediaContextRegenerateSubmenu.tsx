import type { MediaFile } from '../../../../stores/mediaStore';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';

export interface MediaContextRegenerateSubmenuProps {
  mediaFile: MediaFile;
  isVideoFile: boolean;
  isImageFile: boolean;
  hasAudio: boolean;
  isGenerating: boolean;
  hasProxy: boolean;
  isAudioProxyGenerating: boolean;
  hasAudioProxy: boolean;
  isSourceAudioAnalysisGenerating: boolean;
  hasSourceWaveform: boolean;
  hasSourceSpectrogram: boolean;
  onCancelProxyGeneration: (mediaFileId: string) => void;
  onGenerateProxy: (
    mediaFileId: string,
    options: { force?: boolean },
  ) => void;
  onAnalyzeSceneCuts: (mediaFileId: string, options: { force?: boolean }) => void;
  onRegenerateThumbnails: (mediaFile: MediaFile) => void;
  onRegenerateAudioProxy: (mediaFile: MediaFile, force: boolean) => void;
  onRegenerateWaveform: (mediaFile: MediaFile) => void;
  onRegenerateSpectrogram: (mediaFile: MediaFile) => void;
  onClose: () => void;
}

export function MediaContextRegenerateSubmenu({
  mediaFile,
  isVideoFile,
  isImageFile,
  hasAudio,
  isGenerating,
  hasProxy,
  isAudioProxyGenerating,
  hasAudioProxy,
  isSourceAudioAnalysisGenerating,
  hasSourceWaveform,
  hasSourceSpectrogram,
  onCancelProxyGeneration,
  onGenerateProxy,
  onAnalyzeSceneCuts,
  onRegenerateThumbnails,
  onRegenerateAudioProxy,
  onRegenerateWaveform,
  onRegenerateSpectrogram,
  onClose,
}: MediaContextRegenerateSubmenuProps) {
  const firefly = import.meta.env.VITE_APP_VARIANT === 'firefly';
  const text = (zh: string, en: string) => firefly ? zh : en;
  return (
    <>
      <div className="context-menu-separator" />
      <div className="context-menu-item has-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span>{text('重新生成派生素材', 'Regenerate')}</span>
        <span className="submenu-arrow">&#9654;</span>
        <div className="context-submenu">
          {isVideoFile && (
            <div
              className={`context-menu-item ${(!mediaFile.file && !isGenerating) || mediaFile.sceneCutStatus === 'analyzing' ? 'disabled' : ''}`}
              onClick={() => {
                if ((!mediaFile.file && !isGenerating) || mediaFile.sceneCutStatus === 'analyzing') return;
                if (isGenerating) {
                  onCancelProxyGeneration(mediaFile.id);
                } else {
                  onGenerateProxy(mediaFile.id, { force: hasProxy });
                }
                onClose();
              }}
            >
              {isGenerating
                ? text(`停止生成代理（${mediaFile.proxyProgress || 0}%）`, `Stop Proxy Generation (${mediaFile.proxyProgress || 0}%)`)
                : text(`代理文件${hasProxy ? '（已就绪）' : ''}`, `Proxy${hasProxy ? ' (ready)' : ''}`)}
            </div>
          )}
          {isVideoFile && (
            <div
              className={`context-menu-item ${!mediaFile.file || isGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (!mediaFile.file || isGenerating) return;
                if (mediaFile.sceneCutStatus === 'analyzing') {
                  onCancelProxyGeneration(mediaFile.id);
                } else {
                  onAnalyzeSceneCuts(mediaFile.id, { force: true });
                }
                onClose();
              }}
            >
              {mediaFile.sceneCutStatus === 'analyzing' ? text('停止镜头分析', 'Stop Scene Cuts') : text('镜头分析', 'Scene Cuts')}
              {mediaFile.sceneCutStatus === 'analyzing'
                ? text(`（${Math.round(mediaFile.sceneCutProgress || 0)}%）`, ` (${Math.round(mediaFile.sceneCutProgress || 0)}%)`)
                : mediaFile.sceneCutStatus === 'ready'
                  ? text(`（发现 ${mediaFile.sceneCutAnalysis?.cuts.length ?? 0} 个）`, ` (${mediaFile.sceneCutAnalysis?.cuts.length ?? 0} found)`)
                  : mediaFile.sceneCutStatus === 'error'
                    ? text('（失败）', ' (error)')
                    : ''}
            </div>
          )}
          {(isVideoFile || isImageFile) && (
            <div
              className="context-menu-item"
              onClick={() => onRegenerateThumbnails(mediaFile)}
            >
              {text(`缩略图${mediaFile.thumbnailUrl ? '（已就绪）' : ''}`, `Thumbnails${mediaFile.thumbnailUrl ? ' (ready)' : ''}`)}
            </div>
          )}
          {hasAudio && (
            <div
              className={`context-menu-item ${isAudioProxyGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (isAudioProxyGenerating) return;
                onRegenerateAudioProxy(mediaFile, hasAudioProxy);
              }}
            >
              {text('WAV 音频代理', 'WAV Audio Proxy')}
              {isAudioProxyGenerating
                ? text(`（${mediaFile.audioProxyProgress || 0}%）`, ` (${mediaFile.audioProxyProgress || 0}%)`)
                : hasAudioProxy
                ? text('（已就绪）', ' (ready)')
                : ''}
            </div>
          )}
          {hasAudio && (
            <div
              className={`context-menu-item ${isSourceAudioAnalysisGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (isSourceAudioAnalysisGenerating) return;
                onRegenerateWaveform(mediaFile);
              }}
            >
              {text('波形', 'Waveform')}
              {isSourceAudioAnalysisGenerating
                ? text(`（${Math.round(mediaFile.waveformProgress || 0)}%）`, ` (${Math.round(mediaFile.waveformProgress || 0)}%)`)
                : hasSourceWaveform
                ? text('（已就绪）', ' (ready)')
                : ''}
            </div>
          )}
          {hasAudio && (
            <div
              className={`context-menu-item ${isSourceAudioAnalysisGenerating ? 'disabled' : ''}`}
              onClick={() => {
                if (isSourceAudioAnalysisGenerating) return;
                onRegenerateSpectrogram(mediaFile);
              }}
            >
              {text(`频谱${hasSourceSpectrogram ? '（已就绪）' : ''}`, `Spectral${hasSourceSpectrogram ? ' (ready)' : ''}`)}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
