// src/engine/ffmpeg/bridge/ffmpegEncodeArgs.ts
// Pure FFmpeg command-line construction for encode runs: video/audio codec
// argument mapping, GIF palette filter graphs, and PCM payload interleaving.
// No FFmpeg core, virtual filesystem, or worker handles live here.

import type { FFmpegExportSettings, ProResProfile } from '../types';
import { Logger } from '../../../services/logger';
import {
  clampGifAlphaThreshold,
  clampGifBayerScale,
  clampGifColors,
  getGifRepeatCount,
} from '../../gif/gifOptions';

const log = Logger.create('FFmpegBridge');

/**
 * Build FFmpeg command line arguments for a raw-frames encode run
 */
export function buildEncodeArgs(
  settings: FFmpegExportSettings,
  frameCount?: number,
  audioBuffer?: AudioBuffer | null
): string[] {
  // Calculate duration from frame count for rawvideo input
  const duration = frameCount && settings.fps ? frameCount / settings.fps : undefined;

  const args: string[] = [
    '-nostdin',                      // Don't read from stdin (prevents prompt in browser)
    '-y',                            // Overwrite output
    '-v', 'info',                    // Verbose output for progress parsing
    '-stats',                        // Force progress stats output
    '-f', 'rawvideo',                // Input format for video
    '-pix_fmt', 'rgba',              // Input pixel format (from canvas)
    '-s', `${settings.width}x${settings.height}`,
    '-r', String(settings.fps),
    '-i', '/input/frames.raw',       // Video input
  ];

  // Add audio input if available
  if (audioBuffer && settings.container !== 'gif' && settings.codec !== 'gif') {
    args.push(
      '-f', 'f32le',                 // Raw PCM float32 little-endian
      '-ar', String(audioBuffer.sampleRate),
      '-ac', String(audioBuffer.numberOfChannels),
      '-i', '/input/audio.raw'       // Audio input
    );
  }

  // Video codec settings
  args.push(...buildVideoArgs(settings));

  // Audio codec settings
  if (audioBuffer && settings.container !== 'gif' && settings.codec !== 'gif') {
    args.push(...buildAudioArgs(settings));
  } else {
    args.push('-an'); // No audio
  }

  // Explicitly set output frame count/duration (critical for rawvideo input)
  if (frameCount) {
    args.push('-frames:v', String(frameCount));
  }
  if (duration) {
    args.push('-t', String(duration.toFixed(6)));
  }

  // Output file
  args.push(`/output/output.${settings.container}`);

  return args;
}

/**
 * Build audio codec arguments based on container
 * NOTE: ASYNCIFY build only has aac, flac, alac, pcm_s16le, pcm_s24le, pcm_f32le, ac3
 */
function buildAudioArgs(settings: FFmpegExportSettings): string[] {
  const args: string[] = [];

  // Choose audio codec based on container
  switch (settings.container) {
    case 'mov':
      // AAC for MOV (widely compatible)
      args.push('-c:a', 'aac');
      args.push('-b:a', '256k');
      break;

    case 'mkv':
      // FLAC for MKV (lossless, well supported)
      args.push('-c:a', 'flac');
      break;

    case 'avi':
      // PCM for AVI (libmp3lame not available)
      args.push('-c:a', 'pcm_s16le');
      break;

    case 'mxf':
      // PCM for MXF (professional standard)
      args.push('-c:a', 'pcm_s16le');
      break;

    default:
      args.push('-c:a', 'aac');
      args.push('-b:a', '256k');
  }

  return args;
}

/**
 * Build video codec-specific arguments
 * NOTE: ASYNCIFY build only has prores_ks, dnxhd, ffv1, utvideo, mjpeg
 */
function buildVideoArgs(settings: FFmpegExportSettings): string[] {
  const args: string[] = [];

  switch (settings.codec) {
    case 'prores':
      args.push('-c:v', 'prores_ks');
      args.push('-profile:v', getProResProfileNumber(settings.proresProfile || 'hq'));
      args.push('-pix_fmt', settings.proresProfile?.includes('4444') ? 'yuva444p10le' : 'yuv422p10le');
      args.push('-vendor', 'apl0');
      break;

    case 'dnxhd':
      args.push('-c:v', 'dnxhd');
      args.push('-profile:v', settings.dnxhrProfile || 'dnxhr_hq');
      if (settings.dnxhrProfile === 'dnxhr_444') {
        args.push('-pix_fmt', 'yuv444p10le');
      } else if (settings.dnxhrProfile === 'dnxhr_hqx') {
        args.push('-pix_fmt', 'yuv422p10le');
      } else {
        args.push('-pix_fmt', 'yuv422p');
      }
      break;

    case 'ffv1':
      args.push('-c:v', 'ffv1');
      args.push('-level', '3');
      args.push('-coder', '1');
      args.push('-context', '1');
      args.push('-slicecrc', '1');
      args.push('-pix_fmt', settings.pixelFormat || 'yuv444p10le');
      break;

    case 'utvideo':
      args.push('-c:v', 'utvideo');
      args.push('-pix_fmt', 'rgba');
      break;

    case 'mjpeg':
      args.push('-c:v', 'mjpeg');
      args.push('-q:v', String(settings.quality ?? 2));
      args.push('-pix_fmt', 'yuvj422p');
      break;

    case 'gif':
      args.push('-filter_complex', buildGifFilter(settings));
      args.push('-c:v', 'gif');
      args.push('-loop', String(getGifRepeatCount(settings.gifLoop, settings.gifLoopCount)));
      if (settings.gifOptimize !== false) {
        args.push('-gifflags', '+transdiff');
      }
      break;

    default:
      // Fallback to mjpeg as it's most widely compatible
      log.warn(`Unknown codec "${settings.codec}", falling back to mjpeg`);
      args.push('-c:v', 'mjpeg');
      args.push('-q:v', '2');
      args.push('-pix_fmt', 'yuvj422p');
  }

  return args;
}

function buildGifFilter(settings: FFmpegExportSettings): string {
  const colors = clampGifColors(settings.gifColors);
  const alphaThreshold = clampGifAlphaThreshold(settings.gifAlphaThreshold);
  const dither = settings.gifDither ?? 'sierra2_4a';
  const paletteMode = settings.gifPaletteMode ?? 'global';
  const useTransparency = settings.gifTransparency !== false;
  const statsMode = paletteMode === 'per-frame'
    ? 'single'
    : settings.gifOptimize === false
      ? 'full'
      : 'diff';
  const reserveTransparent = useTransparency && alphaThreshold < 255 ? 1 : 0;
  const bayerScale = dither === 'bayer' ? `:bayer_scale=${clampGifBayerScale(settings.gifBayerScale)}` : '';
  const sourceFormat = useTransparency ? 'format=rgba' : 'format=rgb24';
  const palettegen = `palettegen=max_colors=${colors}:stats_mode=${statsMode}:reserve_transparent=${reserveTransparent}`;
  const alphaOption = useTransparency ? `:alpha_threshold=${alphaThreshold}` : '';
  const paletteuse = `paletteuse=dither=${dither}${alphaOption}${bayerScale}${settings.gifOptimize === false ? '' : ':diff_mode=rectangle'}`;

  return `[0:v]${sourceFormat},split[gif_palette_src][gif_pixels];[gif_palette_src]${palettegen}[gif_palette];[gif_pixels][gif_palette]${paletteuse}`;
}

/**
 * Get ProRes profile number for FFmpeg
 */
function getProResProfileNumber(profile: ProResProfile): string {
  const profiles: Record<ProResProfile, string> = {
    proxy: '0',
    lt: '1',
    standard: '2',
    hq: '3',
    '4444': '4',
    '4444xq': '5',
  };
  return profiles[profile] || '3';
}

/**
 * Convert AudioBuffer to interleaved PCM Float32 data
 */
export function audioBufferToPCM(audioBuffer: AudioBuffer): Float32Array {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const interleaved = new Float32Array(length * channels);

  // Get channel data
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  // Interleave samples
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      interleaved[i * channels + ch] = channelData[ch][i];
    }
  }

  return interleaved;
}
