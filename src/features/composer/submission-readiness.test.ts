import { describe, expect, it } from "vitest";
import { submissionBlockReason } from "./submission-readiness";

const ready = {
  engine: "video" as const,
  mode: "omni" as const,
  prompt: "让角色向前走",
  providerPromptCharacters: 7,
  editorPromptCharacters: 7,
  assetCount: 1,
  hasVideoAsset: false,
  hasFirstFrame: false,
  hasLastFrame: false,
  uploadsReady: true,
  imageReady: false,
  loading: false,
  confirmationPending: false,
};

describe("composer submission readiness", () => {
  it("allows consecutive video submissions while capacity remains", () => {
    expect(submissionBlockReason({ ...ready, capacity: { active: 1, limit: 4, available: 3 } })).toBe("");
    expect(submissionBlockReason({ ...ready, capacity: { active: 3, limit: 4, available: 1 } })).toBe("");
  });

  it("explains the authoritative per-user limit before a fifth submission", () => {
    expect(submissionBlockReason({ ...ready, capacity: { active: 4, limit: 4, available: 0 } })).toBe("已达 4 项并行上限，完成一项后可继续");
  });

  it("explains missing full-reference input instead of silently disabling send", () => {
    expect(submissionBlockReason({ ...ready, assetCount: 0 })).toBe("全能参考至少需要一个参考素材");
  });

  it("blocks duplicates while an ambiguous admission is being confirmed", () => {
    expect(submissionBlockReason({ ...ready, confirmationPending: true })).toBe("正在确认上一项是否已进入队列");
  });

  it("does not impose a Firefly character ceiling on video prompts", () => {
    expect(submissionBlockReason({ ...ready, providerPromptCharacters: 50_001, editorPromptCharacters: 50_001 })).toBe("");
  });

  it("preserves the separate image provider contract", () => {
    expect(submissionBlockReason({ ...ready, engine: "image", imageReady: true, providerPromptCharacters: 2_001, providerPromptLimit: 2_000 })).toContain("2000");
  });
});
