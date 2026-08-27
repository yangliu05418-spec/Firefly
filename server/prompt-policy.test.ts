import { describe, expect, it } from "vitest";
import { assertPromptLength, IMAGE_PROVIDER_PROMPT_MAX_CHARS, promptCharacterCount, PromptTooLongError } from "./prompt-policy.js";

describe("prompt policy", () => {
  it("counts Unicode code points consistently", () => {
    expect(promptCharacterCount("中文🎬a")).toBe(4);
  });

  it("accepts the boundary and reports structured overflow details", () => {
    expect(() => assertPromptLength("🎬".repeat(IMAGE_PROVIDER_PROMPT_MAX_CHARS), "prompt", IMAGE_PROVIDER_PROMPT_MAX_CHARS)).not.toThrow();
    try {
      assertPromptLength("🎬".repeat(IMAGE_PROVIDER_PROMPT_MAX_CHARS + 1), "prompt", IMAGE_PROVIDER_PROMPT_MAX_CHARS);
      throw new Error("expected overflow");
    } catch (error) {
      expect(error).toBeInstanceOf(PromptTooLongError);
      expect(error).toMatchObject({ code: "PROMPT_TOO_LONG", field: "prompt", actual: 2_001, limit: 2_000 });
    }
  });
});
