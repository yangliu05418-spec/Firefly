import { ExportImageControls } from './ExportImageControls';
import { ExportVideoControls } from './ExportVideoControls';
import type { BatchExportMediaType } from '../../../stores/exportStore';
import type {
  ExportBasicsActions,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsImageState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const ui = (zh: string, en: string) => IS_FIREFLY_VARIANT ? zh : en;

interface ExportVisualChannelCardProps {
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  image: ExportBasicsImageState;
  gif: ExportBasicsGifState;
  options: ExportBasicsOptionState;
  time: ExportBasicsTimeState;
  useInOut: boolean;
  actions: ExportBasicsActions;
  sourceMediaType?: BatchExportMediaType;
}

export function ExportVisualChannelCard({
  mode,
  display,
  video,
  image,
  gif,
  options,
  time,
  useInOut,
  actions,
  sourceMediaType,
}: ExportVisualChannelCardProps) {
  return (
    <div className={`export-channel-card${!mode.isXmlMode && mode.videoEnabled ? '' : ' is-disabled'}`} data-export-target={mode.isImageMode ? 'image-section' : 'video-section'}>
      <div className="export-channel-head">
        <div className="export-channel-title">
          <span>{mode.isXmlMode ? 'XML' : mode.isImageMode ? ui('图片', 'Image') : ui('视频', 'Video')}</span>
          {mode.isXmlMode && <strong>{ui('时间线交换', 'Timeline interchange')}</strong>}
        </div>
        {mode.isXmlMode ? (
          <span className="export-chip export-chip-static">FCPXML</span>
        ) : (
          <button
            type="button"
            className={`export-toggle${mode.videoEnabled ? ' is-active' : ''}`}
            disabled={sourceMediaType !== undefined}
            title={sourceMediaType ? ui('画面通道由源素材类型决定', 'The visual channel is fixed by the source media type') : undefined}
            onClick={() => {
              if (mode.videoEnabled) {
                actions.setVideoEnabled(false);
                return;
              }
              actions.setSpecialContainer('none');
              actions.setVideoEnabled(true);
              actions.setVisualMode('video');
            }}
          >
            {mode.videoEnabled ? ui('开启', 'On') : ui('关闭', 'Off')}
          </button>
        )}
      </div>

      {mode.isXmlMode ? (
        <div className="export-inline-note">
          {ui('XML 会保留当前时间线结构与片段引用，不应用渲染参数。', 'XML export uses the current timeline structure and clip references. Render-specific video settings do not apply here.')}
        </div>
      ) : mode.isImageMode ? (
        <ExportImageControls
          image={image}
          video={video}
          options={options}
          time={time}
          actions={actions}
          isImageSequenceMode={mode.isImageSequenceMode}
          imageSequenceOutputLabel={mode.imageSequenceOutputLabel}
          useInOut={useInOut}
          directSource={sourceMediaType !== undefined}
        />
      ) : mode.videoEnabled ? (
        <ExportVideoControls
          mode={mode}
          display={display}
          video={video}
          gif={gif}
          options={options}
          useInOut={useInOut}
          actions={actions}
        />
      ) : (
        <div className="export-inline-note">
          {ui('画面导出已关闭。请选择视频、图片或仅音频导出。', 'Visual export is disabled. Switch to Video or Image, or use Audio-only export.')}
        </div>
      )}
    </div>
  );
}
