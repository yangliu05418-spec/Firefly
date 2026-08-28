import { Logger } from '../../services/logger';
import { vfPipelineMonitor } from '../../services/vfPipelineMonitor';
import { hasVideoFrameCallback, seekHtmlVideoElementAsync } from './htmlVideoSeek';

const log = Logger.create('WebCodecsPlayer');

type MediaStreamTrackProcessorConstructor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>;
};

type WebCodecsWindow = Window & typeof globalThis & {
  MediaStreamTrackProcessor?: MediaStreamTrackProcessorConstructor;
};

interface HtmlVideoFrameSourceCallbacks {
  closeCurrentFrame: () => void;
  getIsPlaying: () => boolean;
  onFrame: (frame: VideoFrame) => void;
  onReady: (width: number, height: number) => void;
  setCurrentFrame: (frame: VideoFrame) => void;
  setDimensions: (width: number, height: number) => void;
  setFrameRate: (frameRate: number) => void;
  setIsPlaying: (isPlaying: boolean) => void;
  setReady: (ready: boolean) => void;
}

export class HtmlVideoFrameSource {
  private readonly callbacks: HtmlVideoFrameSourceCallbacks;
  private streamReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private streamActive = false;
  private videoElement: HTMLVideoElement | null = null;
  private videoFrameCallbackId: number | null = null;
  private animationId: number | null = null;
  private isAttachedToExternal = false;
  private pendingSeekHandler: (() => void) | null = null;
  private boundOnPlay: (() => void) | null = null;
  private boundOnPause: (() => void) | null = null;
  private boundOnSeeked: (() => void) | null = null;

  constructor(callbacks: HtmlVideoFrameSourceCallbacks) {
    this.callbacks = callbacks;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.videoElement;
  }

  hasVideoElement(): boolean {
    return this.videoElement !== null;
  }

  async attachWithStream(video: HTMLVideoElement): Promise<void> {
    if (!('MediaStreamTrackProcessor' in window)) {
      throw new Error('MediaStreamTrackProcessor not supported');
    }

    this.isAttachedToExternal = true;
    this.videoElement = video;
    this.callbacks.setDimensions(video.videoWidth, video.videoHeight);

    // Capture stream from video
    // Note: captureStream is not in the standard HTMLVideoElement type but exists in browsers
    const stream = (video as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
    const videoTrack = stream.getVideoTracks()[0];

    if (!videoTrack) {
      throw new Error('No video track in stream');
    }

    // Create processor to get VideoFrames
    const Processor = (window as WebCodecsWindow).MediaStreamTrackProcessor;
    if (!Processor) {
      throw new Error('MediaStreamTrackProcessor not supported');
    }
    const processor = new Processor({ track: videoTrack });
    this.streamReader = processor.readable.getReader();

    this.callbacks.setReady(true);
    log.info(`Stream attached: ${video.videoWidth}x${video.videoHeight}`);

    // Start reading frames
    this.startStreamCapture();

    this.callbacks.onReady(video.videoWidth, video.videoHeight);
  }

  attachToVideoElement(video: HTMLVideoElement): void {
    this.isAttachedToExternal = true;
    this.videoElement = video;
    this.callbacks.setDimensions(video.videoWidth, video.videoHeight);
    this.callbacks.setReady(true);

    log.info(`Simple mode attached to existing video: ${video.videoWidth}x${video.videoHeight}`);

    // Listen to video element events - Timeline controls the video, we just capture frames
    this.boundOnPlay = () => {
      if (this.callbacks.getIsPlaying()) return; // Already playing
      log.debug('Video play event - starting frame capture');
      this.callbacks.setIsPlaying(true);
      this.startSimpleFrameCapture();
    };
    this.boundOnPause = () => {
      if (!this.callbacks.getIsPlaying()) return; // Already paused
      log.debug('Video pause event');
      this.callbacks.setIsPlaying(false);
      this.stopSimpleFrameCapture();
      // Capture the paused frame
      this.captureCurrentFrame();
    };
    this.boundOnSeeked = () => {
      vfPipelineMonitor.record('vf_seek_done', {
        currentTime: Math.round(video.currentTime * 1000) / 1000,
        readyState: video.readyState,
      });
      // Only capture on seek if not playing (playing captures continuously)
      if (!this.callbacks.getIsPlaying()) {
        this.captureCurrentFrame();
      }
    };
    // No timeupdate listener - requestVideoFrameCallback is more efficient

    video.addEventListener('play', this.boundOnPlay);
    video.addEventListener('pause', this.boundOnPause);
    video.addEventListener('seeked', this.boundOnSeeked);

    // Capture initial frame
    if (video.readyState >= 2) {
      this.captureCurrentFrame();
    }

    // If video is already playing, start capture
    if (!video.paused) {
      this.callbacks.setIsPlaying(true);
      this.startSimpleFrameCapture();
    }
  }

  async loadFile(file: File, loop: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.src = URL.createObjectURL(file);
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.loop = loop;

      const timeout = setTimeout(() => {
        reject(new Error('Video load timeout'));
      }, 10000);

      video.onloadedmetadata = () => {
        this.videoElement = video;
        this.callbacks.setDimensions(video.videoWidth, video.videoHeight);

        // Estimate frame rate (assume 30fps if unknown)
        this.callbacks.setFrameRate(30);

        log.debug(`Video loaded: ${video.videoWidth}x${video.videoHeight}`);
      };

      video.oncanplay = () => {
        clearTimeout(timeout);
        this.callbacks.setReady(true);

        // Create initial frame
        this.captureCurrentFrame();

        log.info(`Simple mode READY: ${video.videoWidth}x${video.videoHeight}`);
        this.callbacks.onReady(video.videoWidth, video.videoHeight);
        resolve();
      };

      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load video'));
      };

      video.load();
    });
  }

  captureCurrentFrame(): void {
    if (!this.videoElement || this.videoElement.readyState < 2) return;

    // Close previous frame
    this.callbacks.closeCurrentFrame();

    // Create new VideoFrame from video element
    try {
      const frame = new VideoFrame(this.videoElement, {
        timestamp: this.videoElement.currentTime * 1_000_000,
      });
      this.callbacks.setCurrentFrame(frame);
      vfPipelineMonitor.record('vf_capture', {
        videoTime: Math.round(this.videoElement.currentTime * 1000) / 1000,
        readyState: this.videoElement.readyState,
      });
      this.callbacks.onFrame(frame);
    } catch (e) {
      vfPipelineMonitor.record('vf_drop', {
        readyState: this.videoElement?.readyState ?? -1,
        reason: 'capture_error',
      });
    }
  }

  play(): void {
    if (!this.videoElement) return;
    // If attached to external video, don't control it - just ensure frame capture is running
    // Timeline controls the video element, we get notified via events
    if (!this.isAttachedToExternal) {
      this.videoElement.play().catch(() => {});
    }
    this.startSimpleFrameCapture();
  }

  pause(): void {
    if (!this.videoElement) return;
    // If attached to external video, don't control it - Timeline controls it
    if (!this.isAttachedToExternal) {
      this.videoElement.pause();
    }
    this.stopSimpleFrameCapture();
  }

  stopToStart(): void {
    if (!this.videoElement || this.isAttachedToExternal) return;
    this.videoElement.currentTime = 0;
  }

  seek(timeSeconds: number): void {
    if (!this.videoElement) return;

    // Remove previous pending seek listener to avoid accumulation during rapid scrubbing
    if (this.pendingSeekHandler) {
      this.videoElement.removeEventListener('seeked', this.pendingSeekHandler);
    }

    this.videoElement.currentTime = timeSeconds;
    // Capture frame immediately and after seek completes
    this.captureCurrentFrame();

    // Also capture when seeked event fires
    const onSeeked = () => {
      this.captureCurrentFrame();
      this.videoElement?.removeEventListener('seeked', onSeeked);
      this.pendingSeekHandler = null;
    };
    this.pendingSeekHandler = onSeeked;
    this.videoElement.addEventListener('seeked', onSeeked);
  }

  fastSeek(timeSeconds: number): void {
    if (!this.videoElement) return;

    const vid = this.videoElement;
    const fastSeek = (vid as { fastSeek?: (timeSeconds: number) => void }).fastSeek;
    if (typeof fastSeek === 'function') {
      fastSeek.call(vid, timeSeconds);
      vfPipelineMonitor.record('vf_seek_fast', {
        target: Math.round(timeSeconds * 1000) / 1000,
      });
    } else {
      vid.currentTime = timeSeconds;
      vfPipelineMonitor.record('vf_seek_precise', {
        target: Math.round(timeSeconds * 1000) / 1000,
      });
    }
    this.captureCurrentFrame();
  }

  async seekAsync(timeSeconds: number): Promise<void> {
    if (!this.videoElement) return;

    return seekHtmlVideoElementAsync(
      this.videoElement,
      timeSeconds,
      () => this.captureCurrentFrame()
    );
  }

  destroy(): void {
    this.stopStreamCapture();

    if (this.videoElement) {
      // Clean up pending seek listener
      if (this.pendingSeekHandler) {
        this.videoElement.removeEventListener('seeked', this.pendingSeekHandler);
        this.pendingSeekHandler = null;
      }
      // Remove event listeners if attached to external video
      if (this.isAttachedToExternal) {
        if (this.boundOnPlay) this.videoElement.removeEventListener('play', this.boundOnPlay);
        if (this.boundOnPause) this.videoElement.removeEventListener('pause', this.boundOnPause);
        if (this.boundOnSeeked) this.videoElement.removeEventListener('seeked', this.boundOnSeeked);
        this.boundOnPlay = null;
        this.boundOnPause = null;
        this.boundOnSeeked = null;
        // Don't clear src or pause - Timeline owns the video element
      } else {
        this.videoElement.pause();
        this.videoElement.src = '';
      }
      this.videoElement = null;
    }

    this.isAttachedToExternal = false;
  }

  private async startStreamCapture(): Promise<void> {
    if (!this.streamReader || this.streamActive) return;

    this.streamActive = true;
    log.debug('Starting stream frame capture');

    try {
      while (this.streamActive) {
        const { value: frame, done } = await this.streamReader.read();

        if (done) {
          log.debug('Stream ended');
          break;
        }

        if (frame) {
          // Close previous frame
          this.callbacks.closeCurrentFrame();
          this.callbacks.setCurrentFrame(frame);
          this.callbacks.onFrame(frame);
        }
      }
    } catch (e) {
      log.warn('Error reading frames from stream', e);
    }

    this.streamActive = false;
  }

  private stopStreamCapture(): void {
    this.streamActive = false;
    if (this.streamReader) {
      this.streamReader.cancel().catch(() => {});
      this.streamReader = null;
    }
  }

  // Simple mode frame capture using requestVideoFrameCallback
  private startSimpleFrameCapture(): void {
    if (!this.videoElement || !('requestVideoFrameCallback' in this.videoElement)) {
      // Fallback to requestAnimationFrame
      this.startSimpleFrameCaptureRAF();
      return;
    }

    const captureFrame = () => {
      if (!this.callbacks.getIsPlaying() || !this.videoElement) return;

      this.captureCurrentFrame();

      this.videoFrameCallbackId = this.videoElement.requestVideoFrameCallback(captureFrame);
    };

    this.videoFrameCallbackId = this.videoElement.requestVideoFrameCallback(captureFrame);
  }

  private startSimpleFrameCaptureRAF(): void {
    const captureFrame = () => {
      if (!this.callbacks.getIsPlaying()) return;

      this.captureCurrentFrame();

      this.animationId = requestAnimationFrame(captureFrame);
    };

    this.animationId = requestAnimationFrame(captureFrame);
  }

  private stopSimpleFrameCapture(): void {
    if (this.videoFrameCallbackId !== null && this.videoElement && hasVideoFrameCallback(this.videoElement)) {
      this.videoElement.cancelVideoFrameCallback(this.videoFrameCallbackId);
      this.videoFrameCallbackId = null;
    }
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}
