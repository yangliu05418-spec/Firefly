import { FrameExporter } from '../../../engine/export';
import type { VideoCodec } from '../../../engine/export';
import {
  DNXHR_PROFILES,
  getCodecsForContainer,
  PRORES_PROFILES,
} from '../../../engine/ffmpeg';
import type { DnxhrProfile, FFmpegVideoCodec, ProResProfile } from '../../../engine/ffmpeg';
import type {
  ExportBasicsActions,
  ExportBasicsDisplayState,
  ExportBasicsModeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

interface ExportVideoCodecCardProps {
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  actions: ExportBasicsActions;
}

export function ExportVideoCodecCard({
  mode,
  display,
  video,
  actions,
}: ExportVideoCodecCardProps) {
  return (
    <div className="export-field-card export-subcard" data-export-target="video-codec">
      <div className="export-field-head">
        <span>Codec</span>
        <strong>{display.currentCodecLabel}</strong>
      </div>
      <div className="export-chip-row">
        {mode.isGifMode ? (
          <span className="export-chip export-chip-static">
            {mode.encoder === 'ffmpeg' ? 'FFmpeg palette' : 'Browser encoder'}
          </span>
        ) : mode.isWebCodecsEncoder
          ? FrameExporter.getVideoCodecs(video.containerFormat).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={`export-chip${video.videoCodec === id ? ' is-active' : ''}`}
                onClick={() => actions.setVideoCodec(id as VideoCodec)}
                disabled={!video.codecSupport[id]}
              >
                {label}
              </button>
            ))
          : getCodecsForContainer(video.ffmpegContainer).map((codec) => (
              <button
                key={codec.id}
                type="button"
                className={`export-chip${video.ffmpegCodec === codec.id ? ' is-active' : ''}`}
                onClick={() => actions.handleFFmpegCodecChange(codec.id as FFmpegVideoCodec)}
              >
                {codec.name}
              </button>
            ))}
      </div>

      {(mode.encoder === 'ffmpeg' || mode.isGifMode) && display.ffmpegCodecInfo && (
        <div className="export-inline-note">
          {display.ffmpegCodecInfo.description}
          {display.ffmpegCodecInfo.supportsAlpha && ' | Alpha'}
          {display.ffmpegCodecInfo.supports10bit && ' | 10-bit'}
        </div>
      )}

      {mode.encoder === 'ffmpeg' && !mode.isGifMode && video.ffmpegCodec === 'prores' && (
        <div className="export-chip-row">
          {PRORES_PROFILES.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`export-chip${video.proresProfile === profile.id ? ' is-active' : ''}`}
              onClick={() => actions.setProresProfile(profile.id as ProResProfile)}
            >
              {profile.name}
            </button>
          ))}
        </div>
      )}

      {mode.encoder === 'ffmpeg' && !mode.isGifMode && video.ffmpegCodec === 'dnxhd' && (
        <div className="export-chip-row">
          {DNXHR_PROFILES.map((profile) => (
            <button
              key={profile.id}
              type="button"
              className={`export-chip${video.dnxhrProfile === profile.id ? ' is-active' : ''}`}
              onClick={() => actions.setDnxhrProfile(profile.id as DnxhrProfile)}
            >
              {profile.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
