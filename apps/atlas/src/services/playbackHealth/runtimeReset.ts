import {
  canUseSharedPreviewRuntimeSession,
  getPreviewRuntimeSource,
  getRuntimeFrameProvider,
  getScrubRuntimeSource,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';
import type { RuntimeFrameProvider } from '../mediaRuntime/types';

type SharedPreviewClip = Parameters<typeof canUseSharedPreviewRuntimeSession>[0];
type SharedPreviewClipList = Parameters<typeof canUseSharedPreviewRuntimeSession>[1];
type RuntimePlaybackSource = Parameters<typeof getPreviewRuntimeSource>[0];
type RuntimeResetClip = SharedPreviewClip & {
  source?: (RuntimePlaybackSource & {
    webCodecsPlayer?: RuntimeFrameProvider | null;
  }) | null;
};

export function resetRuntimeProvider(
  provider: RuntimeFrameProvider | null | undefined,
  targetTime: number,
  onResetError: (error: unknown) => void
): boolean {
  if (!provider?.isFullMode?.()) {
    return false;
  }

  try {
    provider.pause();
    provider.seek(targetTime);
    provider.advanceToTime?.(targetTime);
    return true;
  } catch (error) {
    onResetError(error);
    return false;
  }
}

export function resetWebCodecsProvidersForClip(
  ctx: { clipsAtTime: SharedPreviewClipList },
  clip: RuntimeResetClip,
  targetTime: number,
  onResetError: (error: unknown) => void
): number {
  const source = clip.source;
  if (!source) {
    return 0;
  }

  const providers = new Set<RuntimeFrameProvider>();
  const allowShared = canUseSharedPreviewRuntimeSession(clip, ctx.clipsAtTime);
  const previewSource = getPreviewRuntimeSource(source, clip.trackId, allowShared);
  const scrubSource = getScrubRuntimeSource(source, clip.trackId, allowShared);

  updateRuntimePlaybackTime(previewSource, targetTime);
  updateRuntimePlaybackTime(scrubSource, targetTime);

  const previewProvider = getRuntimeFrameProvider(previewSource);
  const scrubProvider = getRuntimeFrameProvider(scrubSource);
  if (previewProvider) providers.add(previewProvider);
  if (scrubProvider) providers.add(scrubProvider);
  if (source.webCodecsPlayer) providers.add(source.webCodecsPlayer);

  let resetCount = 0;
  for (const provider of providers) {
    if (resetRuntimeProvider(provider, targetTime, onResetError)) {
      resetCount++;
    }
  }
  return resetCount;
}
