export interface DependencyHealthProbe {
  configured: boolean;
  reachable: boolean;
}

export interface DependencyHealthSnapshot {
  configured: boolean;
  effectiveReachable: boolean;
  lastProbeReachable: boolean;
  checkedAt?: string;
  lastSuccessfulAt?: string;
  consecutiveFailures: number;
}

interface DependencyHealthGateOptions {
  configured: boolean;
  failureThreshold: number;
  successGraceMs: number;
}

export class DependencyHealthGate {
  private configured: boolean;
  private lastProbeReachable = false;
  private checkedAt?: number;
  private lastSuccessfulAt?: number;
  private consecutiveFailures = 0;

  constructor(private readonly options: DependencyHealthGateOptions) {
    this.configured = options.configured;
  }

  record(probe: DependencyHealthProbe, at = Date.now()) {
    this.configured = probe.configured;
    this.lastProbeReachable = probe.reachable;
    this.checkedAt = at;
    if (probe.configured && probe.reachable) {
      this.lastSuccessfulAt = at;
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures += 1;
    }
  }

  snapshot(at = Date.now()): DependencyHealthSnapshot {
    const recentSuccess = this.lastSuccessfulAt !== undefined && at - this.lastSuccessfulAt <= this.options.successGraceMs;
    const belowFailureThreshold = this.consecutiveFailures < this.options.failureThreshold;
    const effectiveReachable = this.configured && (this.lastProbeReachable || (recentSuccess && belowFailureThreshold));
    return {
      configured: this.configured,
      effectiveReachable,
      lastProbeReachable: this.lastProbeReachable,
      checkedAt: this.checkedAt === undefined ? undefined : new Date(this.checkedAt).toISOString(),
      lastSuccessfulAt: this.lastSuccessfulAt === undefined ? undefined : new Date(this.lastSuccessfulAt).toISOString(),
      consecutiveFailures: this.consecutiveFailures
    };
  }
}
