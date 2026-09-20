import { describe, expect, it } from "vitest";
import { TEXT_MODEL_IDS, textModelCatalog } from "./text-model-catalog.js";
import { consumeTextResponse, textFailure, textRequestBody, textRequestSchema, TextGenerationError } from "./text-generation.js";
import { sseData } from "./text-sse.js";

const streamed = (text: string) => new Response(new ReadableStream<Uint8Array>({ start(controller) { const bytes = new TextEncoder().encode(text); for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
describe("single-turn text generation", () => {
  it("contains exactly the 28 requested model IDs and 11 author groups", () => {
    expect(TEXT_MODEL_IDS).toHaveLength(28);
    expect(new Set(TEXT_MODEL_IDS).size).toBe(28);
    expect(new Set(textModelCatalog().map((item) => item.provider)).size).toBe(11);
  });
  it("preserves the raw prompt without system, history, transforms or invented limits", () => {
    const prompt = `  原始输入\n${"字🙂".repeat(25_000)}\n `;
    expect(textRequestBody("openai/gpt-6-astra", prompt)).toEqual({ model: "openai/gpt-6-astra", stream: true, messages: [{ role: "user", content: prompt }] });
    expect(textRequestSchema.parse({ prompt, model: "openai/gpt-6-astra", requestId: crypto.randomUUID(), sessionId: crypto.randomUUID() }).prompt).toBe(prompt);
  });
  it("rejects unknown models and client-supplied system/history/owner fields", () => {
    const input = { prompt: "hello", model: TEXT_MODEL_IDS[0], requestId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
    for (const extra of [{ model: "other/model" }, { system: "override" }, { messages: [] }, { ownerId: "other" }, { prompt: " \n " }]) expect(textRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it("handles split UTF-8, CRLF, comments and usage frames", async () => {
    const events: unknown[] = [];
    await consumeTextResponse(streamed(': keepalive\r\n\r\ndata: {"choices":[{"delta":{"content":"你好🙂"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{}}\n\ndata: [DONE]\n\n'), async (event) => { events.push(event); });
    expect(events).toEqual([{ type: "delta", text: "你好🙂" }, { type: "done", finishReason: "stop" }]);
  });
  it("supports multiline data fields", async () => {
    const data: string[] = [];
    for await (const frame of sseData(streamed('data: {"a":\ndata: 1}\n\n').body!)) data.push(frame);
    expect(JSON.parse(data[0])).toEqual({ a: 1 });
  });
  it("fails closed on mid-stream errors without exposing upstream detail", async () => {
    await expect(consumeTextResponse(streamed('data: {"error":{"message":"secret detail"}}\n\n'), async () => undefined)).rejects.toThrow("TEXT_PROVIDER_ERROR");
    expect(textFailure(new TextGenerationError("TEXT_PROVIDER_ERROR")).error).not.toContain("secret");
  });
  it("never marks a truncated stream or empty output as complete", async () => {
    for (const data of ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', 'data: [DONE]\n\n']) await expect(consumeTextResponse(streamed(data), async () => undefined)).rejects.toThrow("TEXT_INCOMPLETE");
  });
  it.each([[401, "TEXT_AUTH_FAILED"], [402, "TEXT_CREDITS_EXHAUSTED"], [403, "TEXT_MODEL_UNAVAILABLE"], [429, "TEXT_RATE_LIMITED"], [503, "TEXT_PROVIDER_ERROR"]])("classifies HTTP %s without leaking response text", async (status, code) => {
    await expect(consumeTextResponse(new Response("sensitive provider body", { status: Number(status) }), async () => undefined)).rejects.toThrow(String(code));
  });
});
