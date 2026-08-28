import type { TimelineClip } from '../../types';
import { peekRuntimeFrameProvider } from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';
import type { NativeDecoder } from '../nativeHelper/NativeDecoder';
import { getLazyTimelineVideoElementForClip } from '../timeline/lazyMediaElements';
import { getNativeDecoderForTimelineClip } from '../timeline/nativeDecoderRuntimeRegistry';

export type VideoSyncNativeDecoder = NativeDecoder;

export interface VideoSyncMediaResolution {
  runtimeSourceId?: string;
  runtimeSessionKey?: string;
  runtimeFrameProvider: RuntimeFrameProvider | null;
  htmlVideoElement: HTMLVideoElement | null;
  nativeDecoder: VideoSyncNativeDecoder | null;
  hasRuntimeNativeDecoder: boolean;
}

export function resolveVideoSyncMedia(clip: TimelineClip): VideoSyncMediaResolution {
  const source = clip.source;
  const htmlVideoElement = getLazyTimelineVideoElementForClip(clip);
  const nativeDecoder = getNativeDecoderForTimelineClip(clip);

  return {
    runtimeSourceId: source?.runtimeSourceId,
    runtimeSessionKey: source?.runtimeSessionKey,
    runtimeFrameProvider: peekRuntimeFrameProvider(source),
    htmlVideoElement,
    nativeDecoder,
    hasRuntimeNativeDecoder: !!nativeDecoder,
  };
}
