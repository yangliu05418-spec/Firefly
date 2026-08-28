export class VideoSyncWebCodecsSeekState {
  private preciseSeekTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private latestPreciseTargets: Record<string, number> = {};
  private lastFastSeekTargets: Record<string, number> = {};
  private lastFastSeekAt: Record<string, number> = {};
  private lastPreciseSeekAt: Record<string, number> = {};

  reset(): void {
    this.clearAllPreciseSeekTimers();
    this.latestPreciseTargets = {};
    this.lastFastSeekTargets = {};
    this.lastFastSeekAt = {};
    this.lastPreciseSeekAt = {};
  }

  clearAllPreciseSeekTimers(): void {
    for (const timer of Object.values(this.preciseSeekTimers)) {
      clearTimeout(timer);
    }
    this.preciseSeekTimers = {};
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

  setLatestPreciseTarget(clipId: string, target: number): void {
    this.latestPreciseTargets[clipId] = target;
  }

  getLatestPreciseTarget(clipId: string): number | undefined {
    return this.latestPreciseTargets[clipId];
  }

  setFastSeek(providerKey: string, target: number, now: number): void {
    this.lastFastSeekTargets[providerKey] = target;
    this.lastFastSeekAt[providerKey] = now;
  }

  getLastFastSeekTarget(providerKey: string): number | undefined {
    return this.lastFastSeekTargets[providerKey];
  }

  getLastFastSeekAt(providerKey: string): number | undefined {
    return this.lastFastSeekAt[providerKey];
  }

  clearFastSeek(providerKey: string): void {
    delete this.lastFastSeekTargets[providerKey];
    delete this.lastFastSeekAt[providerKey];
  }

  setLastPreciseSeekAt(providerKey: string, now: number): void {
    this.lastPreciseSeekAt[providerKey] = now;
  }

  getLastPreciseSeekAt(providerKey: string): number | undefined {
    return this.lastPreciseSeekAt[providerKey];
  }

  clearClip(providerKey: string): void {
    this.clearPreciseSeekTimer(providerKey);
    delete this.latestPreciseTargets[providerKey];
    this.clearFastSeek(providerKey);
    delete this.lastPreciseSeekAt[providerKey];
  }
}
