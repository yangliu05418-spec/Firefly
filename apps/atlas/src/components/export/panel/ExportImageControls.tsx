import { IMAGE_QUALITY_PRESETS } from '../exportSettingsState';
import type {
  ExportBasicsActions,
  ExportBasicsImageState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const ui = (zh: string, en: string) => IS_FIREFLY_VARIANT ? zh : en;

interface ExportImageControlsProps {
  image: ExportBasicsImageState;
  video: ExportBasicsVideoState;
  options: ExportBasicsOptionState;
  time: ExportBasicsTimeState;
  actions: ExportBasicsActions;
  isImageSequenceMode: boolean;
  imageSequenceOutputLabel: string;
  useInOut: boolean;
  directSource?: boolean;
}

export function ExportImageControls({
  image,
  video,
  options,
  time,
  actions,
  isImageSequenceMode,
  imageSequenceOutputLabel,
  useInOut,
  directSource = false,
}: ExportImageControlsProps) {
  return (
    <>
      <div className="export-quick-grid export-quick-grid-stack">
        {!directSource && <div className="export-field-card export-subcard" data-export-target="image-mode">
          <div className="export-field-head">
            <span>{ui('模式', 'Mode')}</span>
            <strong>{isImageSequenceMode ? `${ui('序列', 'Sequence')} ${imageSequenceOutputLabel}` : ui('单帧', 'Single frame')}</strong>
          </div>
          <div className="export-chip-row">
            <button
              type="button"
              className={`export-chip${image.imageExportMode === 'frame' ? ' is-active' : ''}`}
              onClick={() => actions.setImageExportMode('frame')}
            >
              {ui('单帧', 'Frame')}
            </button>
            <button
              type="button"
              className={`export-chip${image.imageExportMode === 'sequence' ? ' is-active' : ''}`}
              onClick={() => actions.setImageExportMode('sequence')}
            >
              {ui('序列', 'Sequence')}
            </button>
          </div>
        </div>}

        <div className="export-field-card export-subcard" data-export-target="image-resolution">
          <div className="export-field-head">
            <span>{ui('分辨率', 'Resolution')}</span>
            <strong>{video.actualWidth}x{video.actualHeight}</strong>
          </div>
          <div className="export-chip-row">
            {options.quickResolutionPresets.map(({ label, width: presetWidth, height: presetHeight }) => (
              <button
                key={`${presetWidth}x${presetHeight}`}
                type="button"
                className={`export-chip${!video.useCustomResolution && video.width === presetWidth && video.height === presetHeight ? ' is-active' : ''}`}
                onClick={() => actions.handleQuickResolutionPreset(`${presetWidth}x${presetHeight}`)}
              >
                {label.split(' ')[0]}
              </button>
            ))}
            <button
              type="button"
              className={`export-chip${video.useCustomResolution ? ' is-active' : ''}`}
              onClick={() => actions.setUseCustomResolution(true)}
            >
              {ui('自定义', 'Custom')}
            </button>
          </div>
          {video.useCustomResolution && (
            <div className="export-inline-inputs">
              <input
                type="number"
                value={video.customWidth}
                onChange={(e) => actions.setCustomWidth(Math.max(1, parseInt(e.target.value) || 1920))}
                placeholder={ui('宽度', 'Width')}
                min="1"
                max="7680"
              />
              <span>x</span>
              <input
                type="number"
                value={video.customHeight}
                onChange={(e) => actions.setCustomHeight(Math.max(1, parseInt(e.target.value) || 1080))}
                placeholder={ui('高度', 'Height')}
                min="1"
                max="4320"
              />
            </div>
          )}
        </div>

        <div className="export-field-card export-subcard" data-export-target="image-quality">
          <div className="export-field-head">
            <span>{ui('质量', 'Quality')}</span>
            <strong>{image.selectedImageFormat.lossless ? ui('无损', 'Lossless') : `${Math.round(image.imageQuality * 100)}%`}</strong>
          </div>
          <div className="export-chip-row">
            <span className="export-chip export-chip-static">
              {image.selectedImageFormat.supportsAlpha ? ui('保留 Alpha', 'Alpha kept') : ui('不透明', 'Opaque')}
            </span>
            {!image.selectedImageFormat.lossless && IMAGE_QUALITY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`export-chip${Math.abs(image.imageQuality - preset.value) < 0.001 ? ' is-active' : ''}`}
                onClick={() => actions.setImageQuality(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {!image.selectedImageFormat.lossless && (
            <div className="export-slider-control">
              <div className="export-slider-head">
                <label>{ui('精细调整', 'Fine Tune')}</label>
                <span className="export-slider-value">{Math.round(image.imageQuality * 100)}%</span>
              </div>
              <input
                className="export-slider-input"
                type="range"
                min={0.4}
                max={1}
                step={0.01}
                value={image.imageQuality}
                onChange={(e) => actions.setImageQuality(Number(e.target.value))}
              />
            </div>
          )}
        </div>
      </div>

      {isImageSequenceMode ? (
        <>
          <div className="export-field-card export-subcard" data-export-target="image-fps">
            <div className="export-field-head">
              <span>{ui('帧率', 'Frame Rate')}</span>
              <strong>{video.actualFps} fps</strong>
            </div>
            <div className="export-chip-row">
              {[24, 25, 30, 60].map((presetFps) => (
                <button
                  key={`image-sequence-fps-${presetFps}`}
                  type="button"
                  className={`export-chip${!video.useCustomFps && video.fps === presetFps ? ' is-active' : ''}`}
                  onClick={() => {
                    actions.setUseCustomFps(false);
                    actions.setFps(presetFps);
                  }}
                >
                  {presetFps}
                </button>
              ))}
              <button
                type="button"
                className={`export-chip${video.useCustomFps ? ' is-active' : ''}`}
                onClick={() => actions.setUseCustomFps(true)}
              >
                {ui('自定义', 'Custom')}
              </button>
            </div>
            {video.useCustomFps && (
              <div className="export-inline-inputs">
                <input
                  type="number"
                  value={video.customFps}
                  onChange={(e) => actions.setCustomFps(Math.max(1, Math.min(240, parseFloat(e.target.value) || 30)))}
                  min={1}
                  max={240}
                  step={0.001}
                />
                <span>fps</span>
              </div>
            )}
          </div>

          <div className="export-field-card export-subcard" data-export-target="image-range">
            <div className="export-field-head">
              <span>{ui('序列', 'Sequence')}</span>
              <strong>{image.imageSequenceFrameCount} {ui('帧', 'frames')}</strong>
            </div>
            <div className="export-chip-row">
              <button
                type="button"
                className={`export-chip${useInOut ? ' is-active' : ''}`}
                onClick={() => actions.setUseInOut(!useInOut)}
              >
                {ui('使用入点/出点', 'Use In/Out')}
              </button>
              <span className="export-chip export-chip-static">{imageSequenceOutputLabel}</span>
            </div>
            <div className="export-inline-note">
              {ui('范围', 'Range')} {time.formatTime(time.startTime)} - {time.formatTime(time.endTime)} {ui(`将保存为编号的 .${image.imageFormat} 文件。`, `saved as numbered .${image.imageFormat} files.`)}
            </div>
          </div>
        </>
      ) : (
        <div className="export-field-card export-subcard" data-export-target="image-range">
          <div className="export-field-head">
            <span>{ui('帧', 'Frame')}</span>
            <strong>{directSource ? ui('完整源图', 'Full source') : time.formatTime(time.playheadPosition)}</strong>
          </div>
          <div className="export-inline-note">
            {directSource
              ? ui('以所选分辨率编码完整源图。', 'Encodes the complete source image at the selected output resolution.')
              : ui('导出当前播放头下的最终合成帧。', 'Exports the exact composited frame currently under the playhead.')}
          </div>
        </div>
      )}
    </>
  );
}
