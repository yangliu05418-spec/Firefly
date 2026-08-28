import * as MP4BoxModule from 'mp4box';
import type { MP4ArrayBuffer, MP4VideoTrack, Sample } from '../../engine/webCodecsTypes';

export interface ProxyFrameCacheLog {
  warn(message: string, data?: unknown): void;
}

const MP4Box = MP4BoxModule as unknown as {
  createFile: typeof MP4BoxModule.createFile;
  DataStream: {
    new (buffer?: unknown, byteOffset?: number, endianness?: number): {
      buffer: ArrayBuffer;
      position?: number;
    };
    BIG_ENDIAN: number;
  };
};

interface CodecConfigurationBox {
  write: (stream: { buffer: ArrayBuffer; position?: number }) => void;
}

interface MP4TrackDetails {
  mdia?: {
    minf?: {
      stbl?: {
        stsd?: {
          entries?: Array<{
            avcC?: CodecConfigurationBox;
            hvcC?: CodecConfigurationBox;
            vpcC?: CodecConfigurationBox;
            av1C?: CodecConfigurationBox;
          }>;
        };
      };
    };
  };
}

interface MP4File {
  onReady: (info: { videoTracks: MP4VideoTrack[] }) => void;
  onSamples: (trackId: number, ref: unknown, samples: Sample[]) => void;
  onError: (error: string) => void;
  appendBuffer: (buffer: MP4ArrayBuffer) => number;
  start: () => void;
  flush: () => void;
  setExtractionOptions: (trackId: number, user: unknown, options: { nbSamples: number }) => void;
  getTrackById: (id: number) => MP4TrackDetails | undefined;
}

export interface ProxyVideoSourceState {
  mediaFileId: string;
  storageKey: string;
  samples: Sample[];
  codecConfig: VideoDecoderConfig;
  width: number;
  height: number;
}

function getFirstPresentationCts(samples: Sample[]): number {
  let firstPresentationCts = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    if (Number.isFinite(sample.cts) && sample.cts < firstPresentationCts) {
      firstPresentationCts = sample.cts;
    }
  }
  return Number.isFinite(firstPresentationCts) ? firstPresentationCts : 0;
}

function getNormalizedSampleTimestampUs(sample: Sample, firstPresentationCts: number): number {
  const normalizedCts = Math.max(0, sample.cts - firstPresentationCts);
  return (normalizedCts / sample.timescale) * 1_000_000;
}

function extractCodecDescription(trak: MP4TrackDetails | undefined): Uint8Array | undefined {
  const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  if (!entry) return undefined;

  const configBox = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
  if (!configBox) return undefined;

  const stream = new MP4Box.DataStream(undefined, 0, MP4Box.DataStream.BIG_ENDIAN);
  configBox.write(stream);
  const totalWritten = stream.position || stream.buffer.byteLength;
  if (totalWritten <= 8) return undefined;
  return new Uint8Array(stream.buffer.slice(8, totalWritten));
}

export async function parseProxyVideoFile(mediaFileId: string, storageKey: string, file: File, logger: ProxyFrameCacheLog): Promise<ProxyVideoSourceState | null> {
  const buffer = await file.arrayBuffer() as MP4ArrayBuffer;
  buffer.fileStart = 0;

  return new Promise((resolve) => {
    const mp4File = MP4Box.createFile() as unknown as MP4File;
    const samples: Sample[] = [];
    let codecConfig: VideoDecoderConfig | null = null;
    let width = 0;
    let height = 0;
    let resolved = false;

    const finish = async () => {
      if (resolved) return;
      if (!codecConfig || samples.length === 0) {
        resolved = true;
        resolve(null);
        return;
      }

      try {
        if ('VideoDecoder' in window) {
          const support = await VideoDecoder.isConfigSupported(codecConfig);
          if (!support.supported) {
            logger.warn('Proxy video decoder config is not supported', { mediaFileId, codec: codecConfig.codec });
            resolved = true;
            resolve(null);
            return;
          }
        }
      } catch (error) {
        logger.warn('Proxy video decoder support check failed', error);
      }

      resolved = true;
      resolve({
        mediaFileId,
        storageKey,
        samples,
        codecConfig,
        width,
        height,
      });
    };

    const timeout = window.setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logger.warn('Proxy video parse timed out', { mediaFileId, storageKey });
        resolve(null);
      }
    }, 10000);

    mp4File.onReady = (info) => {
      const videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        window.clearTimeout(timeout);
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
        return;
      }

      const trak = mp4File.getTrackById(videoTrack.id);
      const description = extractCodecDescription(trak);
      codecConfig = {
        codec: videoTrack.codec,
        codedWidth: videoTrack.video.width,
        codedHeight: videoTrack.video.height,
        hardwareAcceleration: 'prefer-hardware',
        ...(description && { description }),
      };
      width = videoTrack.video.width;
      height = videoTrack.video.height;

      mp4File.setExtractionOptions(videoTrack.id, null, { nbSamples: Infinity });
      mp4File.start();
    };

    mp4File.onSamples = (_trackId, _ref, newSamples) => {
      samples.push(...newSamples);
    };

    mp4File.onError = (error) => {
      logger.warn('Proxy video MP4Box error', error);
      window.clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    };

    try {
      mp4File.appendBuffer(buffer);
      mp4File.flush();
      window.setTimeout(() => {
        window.clearTimeout(timeout);
        void finish();
      }, 0);
    } catch (error) {
      window.clearTimeout(timeout);
      logger.warn('Proxy video parse failed', error);
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }
  });
}

export async function decodeProxyVideoFrameFromSource(
  source: ProxyVideoSourceState,
  frameIndex: number,
  logger: ProxyFrameCacheLog,
): Promise<VideoFrame | null> {
  const sampleIndex = Math.max(0, Math.min(source.samples.length - 1, frameIndex));
  const sample = source.samples[sampleIndex];
  const firstPresentationCts = getFirstPresentationCts(source.samples);
  let decodedFrame: VideoFrame | null = null;
  let decodeError: unknown = null;
  const closeDecodedFrame = () => {
    const frame = decodedFrame as VideoFrame | null;
    if (frame) {
      frame.close();
      decodedFrame = null;
    }
  };

  const decoder = new VideoDecoder({
    output: (frame) => {
      if (decodedFrame) decodedFrame.close();
      decodedFrame = frame;
    },
    error: (error) => {
      decodeError = error;
    },
  });

  try {
    decoder.configure(source.codecConfig);
    decoder.decode(new EncodedVideoChunk({
      type: 'key',
      timestamp: getNormalizedSampleTimestampUs(sample, firstPresentationCts),
      duration: sample.timescale > 0 ? (sample.duration / sample.timescale) * 1_000_000 : undefined,
      data: sample.data,
    }));
    await decoder.flush();
    if (decodeError) {
      logger.warn('Proxy video frame decode failed', decodeError);
      closeDecodedFrame();
      return null;
    }
    return decodedFrame;
  } catch (error) {
    logger.warn('Proxy video frame decode failed', error);
    closeDecodedFrame();
    return null;
  } finally {
    try {
      if (decoder.state !== 'closed') decoder.close();
    } catch { /* ignore */ }
  }
}
