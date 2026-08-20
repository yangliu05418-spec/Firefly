import { describe, expect, it } from "vitest";
import { DependencyHealthGate } from "./dependency-health.js";

describe("DependencyHealthGate", () => {
  it("requires an initial successful probe", () => {
    const gate = new DependencyHealthGate({ configured: true, failureThreshold: 3, successGraceMs: 300_000 });

    expect(gate.snapshot(1_000).effectiveReachable).toBe(false);
    gate.record({ configured: true, reachable: false }, 2_000);
    expect(gate.snapshot(2_000).effectiveReachable).toBe(false);
    gate.record({ configured: true, reachable: true }, 3_000);
    expect(gate.snapshot(3_000).effectiveReachable).toBe(true);
  });

  it("absorbs two transient failures after a successful probe", () => {
    const gate = new DependencyHealthGate({ configured: true, failureThreshold: 3, successGraceMs: 300_000 });
    gate.record({ configured: true, reachable: true }, 1_000);

    gate.record({ configured: true, reachable: false }, 61_000);
    expect(gate.snapshot(61_000)).toMatchObject({ effectiveReachable: true, lastProbeReachable: false, consecutiveFailures: 1 });
    gate.record({ configured: true, reachable: false }, 121_000);
    expect(gate.snapshot(121_000)).toMatchObject({ effectiveReachable: true, lastProbeReachable: false, consecutiveFailures: 2 });
  });

  it("becomes unavailable after the configured failure threshold", () => {
    const gate = new DependencyHealthGate({ configured: true, failureThreshold: 3, successGraceMs: 300_000 });
    gate.record({ configured: true, reachable: true }, 1_000);
    gate.record({ configured: true, reachable: false }, 61_000);
    gate.record({ configured: true, reachable: false }, 121_000);
    gate.record({ configured: true, reachable: false }, 181_000);

    expect(gate.snapshot(181_000)).toMatchObject({ effectiveReachable: false, consecutiveFailures: 3 });
  });

  it("expires a stale success and resets on recovery", () => {
    const gate = new DependencyHealthGate({ configured: true, failureThreshold: 3, successGraceMs: 300_000 });
    gate.record({ configured: true, reachable: true }, 1_000);
    gate.record({ configured: true, reachable: false }, 61_000);

    expect(gate.snapshot(301_001).effectiveReachable).toBe(false);
    gate.record({ configured: true, reachable: true }, 302_000);
    expect(gate.snapshot(302_000)).toMatchObject({ effectiveReachable: true, consecutiveFailures: 0 });
  });

  it("never reports an unconfigured dependency as ready", () => {
    const gate = new DependencyHealthGate({ configured: false, failureThreshold: 3, successGraceMs: 300_000 });
    gate.record({ configured: false, reachable: true }, 1_000);

    expect(gate.snapshot(1_000).effectiveReachable).toBe(false);
  });
});
