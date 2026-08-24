export const VIDEO_PROVIDER_PROMPT_MAX_CHARS = 5_000;
export const IMAGE_PROVIDER_PROMPT_MAX_CHARS = 2_000;
export const EDITOR_PROMPT_STORAGE_MAX_CHARS = 20_000;

/** JavaScript string.length counts UTF-16 units; providers and the UI use Unicode code points. */
export const promptCharacterCount = (value: string) => Array.from(value).length;

export class PromptTooLongError extends Error {
  readonly code = "PROMPT_TOO_LONG";
  readonly status = 400;

  constructor(readonly field: "prompt" | "editorPrompt", readonly actual: number, readonly limit: number) {
    super(field === "prompt" ? `提示词最多支持 ${limit} 个字符` : `编辑内容最多支持 ${limit} 个字符`);
    this.name = "PromptTooLongError";
  }
}

export const assertPromptLength = (value: string, field: "prompt" | "editorPrompt", limit: number) => {
  const actual = promptCharacterCount(value);
  if (actual > limit) throw new PromptTooLongError(field, actual, limit);
};
