// Pure shared contract: also imported by the browser, without server credentials.
export const TEXT_MODEL_IDS = [
  "openai/gpt-6-astra", "openai/gpt-5.6-sol", "openai/gpt-5.6-luna", "openai/gpt-5.6-terra", "openai/gpt-5.5",
  "anthropic/claude-fable-5.1", "anthropic/claude-fable-5", "anthropic/claude-opus-5", "anthropic/claude-opus-4.8", "anthropic/claude-opus-4.7", "anthropic/claude-opus-4.6", "anthropic/claude-opus-4.5",
  "anthropic/claude-sonnet-5", "anthropic/claude-sonnet-4.6", "anthropic/claude-sonnet-4.5",
  "google/gemini-3.8-flash", "google/gemini-3.7-flash", "google/gemini-3.6-flash",
  "x-ai/grok-4.6", "x-ai/grok-4.5", "qwen/qwen3.8-max-0902", "tencent/hy4-preview", "z-ai/glm-5.3-flash",
  "bytedance-seed/seed-2-1-turbo", "stepfun/step-3.7-flash", "minimax/minimax-m3", "xiaomi/mimo-v2.5-pro", "xiaomi/mimo-v2.5",
] as const;
export const TEXT_PROVIDERS: Record<string, string> = {
  openai: "OpenAI", anthropic: "Anthropic", google: "Google", "x-ai": "xAI", qwen: "通义千问", tencent: "腾讯混元",
  "z-ai": "智谱", "bytedance-seed": "字节 Seed", stepfun: "阶跃星辰", minimax: "MiniMax", xiaomi: "小米",
};
export type TextModel = { id: string; name: string; provider: string; providerName: string; available: boolean };
export const textModelCatalog = (available?: Set<string>): TextModel[] => TEXT_MODEL_IDS.map((id) => {
  const [provider, slug] = id.split("/");
  return { id, name: slug.replaceAll("-", " ").replace(/\b(gpt|glm|hy4)\b/gi, (word) => word.toUpperCase()).replace(/\b[a-z]/g, (word) => word.toUpperCase()), provider, providerName: TEXT_PROVIDERS[provider], available: available?.has(id) ?? true };
});
