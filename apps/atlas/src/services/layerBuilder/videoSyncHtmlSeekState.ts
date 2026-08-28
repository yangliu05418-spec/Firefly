export class VideoSyncHtmlSeekState {
  private lastSeekAt: Record<string, number> = {};
  private rvfcHandles: Record<string, number> = {};
  private preciseSeekTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private latestTargets: Record<string, number> = {};
  private pendingTargets: Record<string, number> = {};
  private pendingStartedAt: Record<string, number> = {};
  private queuedTargets: Record<string, number> = {};
  private seekedFlushArmed = new Set<string>();

  reset(): void {
    this.clearAllPreciseSeekTimers();
    this.lastSeekAt = {};
    this.rvfcHandles = {};
    this.latestTargets = {};
    this.pendingTargets = {};
    this.pendingStartedAt = {};
    this.queuedTargets = {};
    this.seekedFlushArmed.clear();
  }

  clearAllPreciseSeekTimers(): void {
    for (const timer of Object.values(this.preciseSeekTimers)) {
      clearTimeout(timer);
    }
    this.preciseSeekTimers = {};
  }

  getLastSeekAt(clipId: string): number {
    return this.lastSeekAt[clipId] ?? 0;
  }

  setLastSeekAt(clipId: string, now: number): void {
    this.lastSeekAt[clipId] = now;
  }

  clearLastSeekAt(clipId: string): void {
    delete this.lastSeekAt[clipId];
  }

  getRvfcHandle(clipId: string): number | undefined {
    return this.rvfcHandles[clipId];
  }

  hasRvfcHandle(clipId: string): boolean {
    return this.rvfcHandles[clipId] !== undefined;
  }

  setRvfcHandle(clipId: string, handle: number): void {
    this.rvfcHandles[clipId] = handle;
  }

  deleteRvfcHandle(clipId: string): void {
    delete this.rvfcHandles[clipId];
  }

  getActiveRvfcClipIds(): string[] {
    return Object.keys(this.rvfcHandles);
  }

  hasPreciseSeekTimer(clipId: string): boolean {
    return this.preciseSeekTimers[clipId] !== undefined;
  }

  replacePreciseSeekTimer(clipId: string, timer: ReturnType<typeof setTimeout>): void {
    this.clearPreciseSeekTimer(clipId);
    this.preciseSeekTimers[clipId] = timer;
  }

  clearPreciseSeekTimer(clipId: string): void {
    const timer = this.preciseSeekTimers[clipId];
    if (timer) {
      clearTimeout(timer);
      delete this.preciseSeekTimers[clipId];
    }
  }

  getActivePreciseSeekClipIds(): string[] {
    return Object.keys(this.preciseSeekTimers);
  }

  getLatestTarget(clipId: string): number | undefined {
    return this.latestTargets[clipId];
  }

  setLatestTarget(clipId: string, target: number): void {
    this.latestTargets[clipId] = target;
  }

  clearLatestTarget(clipId: string): void {
    delete this.latestTargets[clipId];
  }

  getPendingTarget(clipId: string): number | undefined {
    return this.pendingTargets[clipId];
  }

  getPendingStartedAt(clipId: string): number | undefined {
    return this.pendingStartedAt[clipId];
  }

  setPendingTarget(clipId: string, target: number, startedAt: number): void {
    this.pendingTargets[clipId] = target;
    this.pendingStartedAt[clipId] = startedAt;
  }

  clearPendingTarget(clipId: string): void {
    delete this.pendingTargets[clipId];
    delete this.pendingStartedAt[clipId];
  }

  getQueuedTarget(clipId: string): number | undefined {
    return this.queuedTargets[clipId];
  }

  setQueuedTarget(clipId: string, target: number): void {
    this.queuedTargets[clipId] = target;
  }

  clearQueuedTarget(clipId: string): void {
    delete this.queuedTargets[clipId];
  }

  hasSeekedFlushArmed(clipId: string): boolean {
    return this.seekedFlushArmed.has(clipId);
  }

  armSeekedFlush(clipId: string): void {
    this.seekedFlushArmed.add(clipId);
  }

  clearSeekedFlush(clipId: string): void {
    this.seekedFlushArmed.delete(clipId);
  }

  clearClipTargets(clipId: string): void {
    this.clearPreciseSeekTimer(clipId);
    this.clearLatestTarget(clipId);
    this.clearPendingTarget(clipId);
    this.clearQueuedTarget(clipId);
    this.clearSeekedFlush(clipId);
  }
}
