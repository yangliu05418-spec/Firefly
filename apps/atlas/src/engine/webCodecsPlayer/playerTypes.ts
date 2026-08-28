export interface WebCodecsPlayerOptions {
  loop?: boolean;
  onDecodedFrame?: (frame: VideoFrame) => void;
  onFrame?: (frame: VideoFrame) => void;
  onReady?: (width: number, height: number) => void;
  onError?: (error: Error) => void;
  // Use simple VideoFrame extraction from HTMLVideoElement instead of MP4Box demuxing
  useSimpleMode?: boolean;
  // Use MediaStreamTrackProcessor for VideoFrame extraction (best performance)
  useStreamMode?: boolean;
  hardwareAcceleration?: VideoDecoderConfig['hardwareAcceleration'];
}

export type SeekPreviewMode = 'strict' | 'interactive' | 'interactive-preroll';

export type PendingSeekKind = 'seek' | 'advance';

export type PendingSeekEndReason =
  | 'resolved'
  | 'cancelled'
  | 'replaced'
  | 'cleared'
  | 'fallback';
