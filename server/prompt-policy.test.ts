import { describe, expect, it } from "vitest";
import { assertPromptLength, promptCharacterCount, PromptTooLongError } from "./prompt-policy.js";

describe("prompt policy", () => {
  it("counts Unicode code points consistently", () => {
    expect(promptCharacterCount("中文🎬a")).toBe(4);
  });

  it("accepts the boundary and reports structured overflow details", () => {
    expect(() => assertPromptLength("🎬".repeat(5_000), "prompt", 5_000)).not.toThrow();
    try {
      assertPromptLength("🎬".repeat(5_001), "prompt", 5_000);
      throw new Error("expected overflow");
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTooLongError);
      expect(error).toMatchObject({ code: "PROMPT_TOO_LONG", field: "prompt", actual: 5_001, limit: 5_000 });
    }
  });
});
