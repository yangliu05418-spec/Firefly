// src/engine/ffmpeg/bridge/ffmpegLogParsing.ts
// Result-side parsing for the FFmpeg bridge: stderr/stdout progress-line
// parsing and container MIME-type mapping. Pure string/number mapping only.

import type { FFmpegProgress } from '../types';

/**
 * Parse an FFmpeg stats line into a progress snapshot.
 * FFmpeg outputs: "frame=  123 fps= 45 q=2.0 size=   1234kB time=00:00:04.10 ..."
 * Returns null when the line carries no frame progress or totalFrames is unknown.
 */
export function parseEncodeProgressLine(message: string, totalFrames: number): FFmpegProgress | null {
  const frameMatch = message.match(/frame=\s*(\d+)/);
  if (!frameMatch || totalFrames <= 0) {
    return null;
  }

  const fpsMatch = message.match(/fps=\s*([\d.]+)/);
  const sizeMatch = message.match(/size=\s*(\d+)/);
  const timeMatch = message.match(/time=(\d+):(\d+):([\d.]+)/);

  const frame = parseInt(frameMatch[1]);
  const percent = (frame / totalFrames) * 100;
  const fps = fpsMatch ? parseFloat(fpsMatch[1]) : 0;
  const size = sizeMatch ? parseInt(sizeMatch[1]) * 1024 : 0;

  let time = frame / 30; // Default estimate
  if (timeMatch) {
    const hours = parseInt(timeMatch[1]);
    const minutes = parseInt(timeMatch[2]);
    const seconds = parseFloat(timeMatch[3]);
    time = hours * 3600 + minutes * 60 + seconds;
  }

  return {
    frame,
    fps,
    time,
    speed: fps / 30, // Approximate speed multiplier
    bitrate: 0,
    size,
    percent,
    eta: fps > 0 ? (totalFrames - frame) / fps : 0,
  };
}

/**
 * Get MIME type for container format
 */
export function containerMimeType(container: string): string {
  const types: Record<string, string> = {
    mov: 'video/quicktime',
    mp4: 'video/mp4',
    mkv: 'video/x-matroska',
    webm: 'video/webm',
    avi: 'video/x-msvideo',
    mxf: 'application/mxf',
    gif: 'image/gif',
  };
  return types[container] || 'video/mp4';
}
