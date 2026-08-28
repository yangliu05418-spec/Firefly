import type { ExportProgress } from '../../engine/export';
import type { FFmpegProgress } from '../../engine/ffmpeg';
import type { EncoderType } from './useExportState';

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const ui = (zh: string, en: string) => IS_FIREFLY_VARIANT ? zh : en;

interface ExportProgressViewProps {
  encoder: EncoderType;
  progress: ExportProgress | null;
  ffmpegProgress: FFmpegProgress | null;
  exportPhase: 'idle' | 'rendering' | 'audio' | 'encoding';
  usesBrowserProgress: boolean;
  isImageSequenceMode: boolean;
  isGifMode: boolean;
  formatTime: (seconds: number) => string;
  onCancel: () => void;
}

export function ExportProgressView({
  encoder,
  progress,
  ffmpegProgress,
  exportPhase,
  usesBrowserProgress,
  isImageSequenceMode,
  isGifMode,
  formatTime,
  onCancel,
}: ExportProgressViewProps) {
  const progressPercent = (encoder === 'webcodecs' || encoder === 'htmlvideo')
    ? (progress?.percent ?? 0)
    : (ffmpegProgress?.percent ?? 0);

  return (
    <div className="export-progress-container" role="status" aria-label={ui('导出进度', 'Export progress')}>
      <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: 500, color: 'var(--text-primary)' }}>
        {usesBrowserProgress ? (
          <>
            {progress?.phase === 'video' && (
              isImageSequenceMode
                ? ui('正在渲染图片序列…', 'Rendering image sequence...')
                : isGifMode
                  ? ui('正在编码 GIF 帧…', 'Encoding GIF frames...')
                  : ui('正在编码视频帧…', 'Encoding video frames...')
            )}
            {progress?.phase === 'audio' && (
              <>{ui('正在处理音频', 'Processing audio')}: {progress.audioPhase} ({progress.audioPercent}%)</>
            )}
            {progress?.phase === 'muxing' && (isImageSequenceMode ? ui('正在完成序列…', 'Finalizing sequence...') : ui('正在封装成片…', 'Finalizing...'))}
          </>
        ) : (
          <>
            {exportPhase === 'rendering' && ui('正在渲染帧…', 'Rendering frames...')}
            {exportPhase === 'audio' && ui('正在处理音频…', 'Processing audio...')}
            {exportPhase === 'encoding' && (isGifMode ? ui('正在编码 GIF…', 'Encoding GIF (please wait)...') : ui('正在编码视频…', 'Encoding video (please wait)...'))}
          </>
        )}
      </div>

      <div
        className="export-progress-bar"
        role="progressbar"
        aria-label={ui('导出进度', 'Export progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.max(0, Math.min(100, progressPercent))}
      >
        <div
          className="export-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
      <div className="export-progress-info">
        {usesBrowserProgress ? (
          <>
            {progress?.phase === 'video' ? (
              <span>{ui('帧', 'Frame')} {progress?.currentFrame ?? 0} / {progress?.totalFrames ?? 0}</span>
            ) : progress?.phase === 'muxing' ? (
              <span>{isImageSequenceMode ? ui('正在打包序列', 'Packaging sequence') : ui('正在完成', 'Finalizing')}</span>
            ) : (
              <span>{ui('音频处理中', 'Audio processing')}</span>
            )}
            <span>{(progress?.percent ?? 0).toFixed(1)}%</span>
          </>
        ) : (
          <>
            <span>{ui('帧', 'Frame')} {ffmpegProgress?.frame ?? 0}</span>
            <span>{(ffmpegProgress?.percent ?? 0).toFixed(1)}%</span>
          </>
        )}
      </div>
      {usesBrowserProgress && progress && progress.phase === 'video' && progress.estimatedTimeRemaining > 0 && (
        <div className="export-eta">
          {ui('预计剩余', 'ETA')}: {formatTime(progress.estimatedTimeRemaining)}
        </div>
      )}
      <button className="btn export-cancel-btn" onClick={onCancel}>
        {ui('取消', 'Cancel')}
      </button>
    </div>
  );
}
