import { describe, expect, it } from "vitest";
import {
  ATLAS_AGENT_CATALOG_DIGEST,
  AtlasAgentProtocolError,
  assertSafeJson,
  normalizeAtlasAgentPlan,
  parseAtlasAgentSemanticSnapshot,
} from "./atlas-agent-contract.js";

describe("Atlas Agent atomic contract", () => {
  it("pins a strict catalog and derives risk instead of trusting the provider", () => {
    const plan = normalizeAtlasAgentPlan({
      version: 1,
      summary: "切割后删除多余片段",
      operations: [
        { sequence: 1, tool: "split_clip", args: { clipId: "clip-1", atMs: 1_500 } },
        { sequence: 2, tool: "delete_clip", args: { clipId: "clip-2" } },
      ],
    }, { runId: "run-1", baseRevision: 7 });

    expect(plan.catalogDigest).toBe(ATLAS_AGENT_CATALOG_DIGEST);
    expect(plan.operations[0]).toMatchObject({ risk: "low", requiresConfirmation: false, operationKey: "run-1:1" });
    expect(plan.operations[1]).toMatchObject({ risk: "destructive", requiresConfirmation: true, operationKey: "run-1:2" });
    expect(plan.planDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects additional tool arguments and non-contiguous sequences", () => {
    expect(() => normalizeAtlasAgentPlan({
      version: 1, summary: "切割", operations: [{ sequence: 1, tool: "split_clip", args: { clipId: "clip-1", atMs: 500, hidden: true } }],
    }, { runId: "run-1", baseRevision: 0 })).toThrowError(AtlasAgentProtocolError);
    expect(() => normalizeAtlasAgentPlan({
      version: 1, summary: "切割", operations: [{ sequence: 2, tool: "split_clip", args: { clipId: "clip-1", atMs: 500 } }],
    }, { runId: "run-1", baseRevision: 0 })).toThrowError(/序号/);
  });

  it("rejects request_export in the middle or more than once", () => {
    expect(() => normalizeAtlasAgentPlan({
      version: 1, summary: "先导出再编辑", operations: [
        { sequence: 1, tool: "request_export", args: { preset: "mp4_h264_aac_1080p30" } },
        { sequence: 2, tool: "split_clip", args: { clipId: "clip-1", atMs: 500 } },
      ],
    }, { runId: "run-middle-export", baseRevision: 0 })).toThrowError(/最后一步/);
    expect(() => normalizeAtlasAgentPlan({
      version: 1, summary: "重复导出", operations: [
        { sequence: 1, tool: "request_export", args: { preset: "mp4_h264_aac_1080p30" } },
        { sequence: 2, tool: "request_export", args: { preset: "mp4_h264_aac_1080p30" } },
      ],
    }, { runId: "run-duplicate-export", baseRevision: 0 })).toThrowError(/一次导出/);
  });

  it("rejects prototype pollution, accessors and non-finite numbers", () => {
    expect(() => assertSafeJson(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrowError(/不安全字段/);
    expect(() => assertSafeJson({ value: Number.NaN })).toThrowError(/非有限/);
    const withAccessor: Record<string, unknown> = {};
    Object.defineProperty(withAccessor, "value", { enumerable: true, get: () => 1 });
    expect(() => assertSafeJson(withAccessor)).toThrowError(/访问器/);
    const withHidden: Record<string, unknown> = {};
    Object.defineProperty(withHidden, "value", { enumerable: false, value: 1 });
    expect(() => assertSafeJson(withHidden)).toThrowError(/不可序列化/);
  });

  it("accepts a bounded URL-free semantic snapshot and rejects dangling assets", () => {
    const snapshot = {
      version: 1 as const, revision: 3, durationMs: 10_000,
      tracks: [{ id: "track-1", kind: "video" as const, muted: false, locked: false, clipIds: ["clip-1"] }],
      clips: [{ id: "clip-1", trackId: "track-1", assetId: "asset-1", kind: "video" as const, startMs: 0, durationMs: 10_000 }],
      assets: [{ id: "asset-1", kind: "video" as const, name: "成片", durationMs: 10_000 }],
      selection: { clipIds: ["clip-1"], trackIds: [] },
    };
    expect(parseAtlasAgentSemanticSnapshot(snapshot).revision).toBe(3);
    expect(() => parseAtlasAgentSemanticSnapshot({ ...snapshot, assets: [] })).toThrowError(/语义快照/);
    expect(() => parseAtlasAgentSemanticSnapshot({ ...snapshot, signedUrl: "https://example.com/signed" })).toThrowError(/语义快照/);
  });
});
