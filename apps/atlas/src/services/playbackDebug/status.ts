import type { PlaybackDebugStats } from '../playbackDebugStats';

export function derivePlaybackStatus(
  stats: Omit<PlaybackDebugStats, 'status'>
): PlaybackDebugStats['status'] {
  const noReadyFrames = stats.activeVideos > 0 && stats.worstReadyState > 0 && stats.worstReadyState < 2;
  const isWorkerPresentingPath = (path: string): boolean => (
    path === 'worker-presenting' ||
    path.startsWith('worker-presenting:') ||
    path === 'worker-only' ||
    path.startsWith('worker-only:') ||
    path === 'worker-gpu-only' ||
    path.startsWith('worker-gpu-only:')
  );
  const fallbackPreviewFrames = Object.entries(stats.previewPathCounts ?? {}).reduce(
    (count, [path, value]) =>
      path === 'proxy-frame' ||
      path === 'proxy-image-frame' ||
      path === 'proxy-image-frame-nearest' ||
      path === 'not-ready-scrub-cache' ||
      path === 'scrub-cache' ||
      path === 'gpu-cached' ||
      path === 'copied-preview' ||
      isWorkerPresentingPath(path)
        ? count + value
        : count,
    0
  );
  const workerPresentingPreviewFrames = Object.entries(stats.previewPathCounts ?? {}).reduce(
    (count, [path, value]) => isWorkerPresentingPath(path) ? count + value : count,
    0
  );
  const workerPresentingPreviewIsPrimary =
    workerPresentingPreviewFrames >= Math.max(1, Math.floor(stats.previewFrames * 0.5));
  const workerMovingTargetStaleBudget = Math.max(3, Math.floor(stats.previewFrames * 0.55));
  const hasLongWorkerPreviewFreeze = stats.longestPreviewFreezeMs >= 180;
  const stableWorkerPreviewAvailable =
    workerPresentingPreviewIsPrimary &&
    stats.previewFrames >= 3 &&
    stats.previewUpdates > 0 &&
    !hasLongWorkerPreviewFreeze &&
    stats.stalePreviewWhileTargetMoved <= workerMovingTargetStaleBudget;
  const responsivePreviewFallback =
    (stats.playingVideos === 0 || workerPresentingPreviewIsPrimary) &&
    stats.previewFrames >= 3 &&
    stats.previewUpdates > 0 &&
    fallbackPreviewFrames >= Math.max(1, Math.floor(stats.previewFrames * 0.5)) &&
    stats.previewFreezeEvents === 0 &&
    stats.stalePreviewWhileTargetMoved <= 3 &&
    stats.p95PreviewUpdateGapMs <= 100;
  const stablePreviewAvailable =
    responsivePreviewFallback || stableWorkerPreviewAvailable;
  const severeCadence =
    !stablePreviewAvailable &&
    (stats.p95FrameGapMs >= 85 || stats.maxFrameGapMs >= 140);
  const degradedCadence =
    !responsivePreviewFallback &&
    (stats.p95FrameGapMs >= 50 || stats.avgFrameGapMs >= 40);
  const slowStableWorkerPreview =
    stableWorkerPreviewAvailable && !responsivePreviewFallback;
  const hasLivePlaybackDemand =
    (stats.playingVideos ?? 0) > 0 ||
    stats.frameEvents > 0 ||
    stats.seeks > 0 ||
    stats.stalls > 0 ||
    stats.queuePressureEvents > 0 ||
    stats.seekingVideos > 0 ||
    stats.warmingUpVideos > 0;
  const coldPlayback =
    stats.coldVideos > 0 &&
    hasLivePlaybackDemand &&
    !stablePreviewAvailable;
  const healthIssuesDuringPlayback =
    stats.healthAnomalies > 0 &&
    hasLivePlaybackDemand &&
    !stablePreviewAvailable;
  const missingReadyFramesDuringPlayback =
    noReadyFrames &&
    hasLivePlaybackDemand &&
    !stablePreviewAvailable;
  const hasPreviewMotionDemand = stats.previewFrames > 0 && stats.stalePreviewWhileTargetMoved > 0;
  const previewFreezeDuringPlayback =
    stats.previewFreezeEvents > 0 &&
    stats.stalePreviewWhileTargetMoved > 0 &&
    (hasLivePlaybackDemand || hasPreviewMotionDemand);
  const severePreviewFreeze =
    previewFreezeDuringPlayback &&
    stats.longestPreviewFreezeMs >= 650;
  const previewDriftDuringPlayback =
    workerPresentingPreviewIsPrimary &&
    stats.previewFrames >= 3 &&
    stats.maxPreviewDriftMs >= 120 &&
    (hasLivePlaybackDemand || hasPreviewMotionDemand);
  const severePreviewDrift =
    previewDriftDuringPlayback &&
    stats.maxPreviewDriftMs >= 350 &&
    (
      stats.avgPreviewDriftMs >= 180 ||
      !stableWorkerPreviewAvailable
    );

  if (
    stats.stalls > 0 ||
    severeCadence ||
    severePreviewFreeze ||
    severePreviewDrift ||
    healthIssuesDuringPlayback ||
    (stats.readyStateDrops > 0 && !stablePreviewAvailable) ||
    coldPlayback ||
    (stats.collectorDrops ?? 0) > 0 ||
    missingReadyFramesDuringPlayback
  ) {
    return 'bad';
  }

  if (
    degradedCadence ||
    slowStableWorkerPreview ||
    stats.queuePressureEvents > 30 ||
    previewFreezeDuringPlayback ||
    previewDriftDuringPlayback ||
    (!responsivePreviewFallback && stats.seeks >= 3) ||
    (stats.decoderResets ?? 0) >= 3 ||
    (stats.maxPendingSeekMs ?? 0) >= 80 ||
    stats.driftCorrections > 0 ||
    (!responsivePreviewFallback && stats.seekingVideos > 0) ||
    (!responsivePreviewFallback && stats.warmingUpVideos > 0)
  ) {
    return 'warn';
  }

  return 'ok';
}
