import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../api", () => ({ notifySignedOut: vi.fn() }));
import { streamText } from "./text-client";
import { notifySignedOut } from "../../api";
const input = { requestId: "request", sessionId: "session", model: "openai/gpt-5.6-sol", prompt: "  原文😀\n " };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("text browser transport", () => {
  it("preserves raw input, streams deltas and never sends history", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('data: {"type":"delta","text":"你好"}\n\ndata: {"type":"done","finishReason":"stop"}\n\n', { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetcher); const output = vi.fn();
    expect(await streamText(input, new AbortController().signal, output)).toBe("stop");
    expect(output).toHaveBeenCalledWith("你好");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains partial output but rejects a midstream error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('data: {"type":"delta","text":"部分内容"}\n\ndata: {"type":"error","error":"服务暂时不可用"}\n\n', { headers: { "content-type": "text/event-stream" } })));
    const output = vi.fn();
    await expect(streamText(input, new AbortController().signal, output)).rejects.toThrow("服务暂时不可用");
    expect(output).toHaveBeenCalledWith("部分内容");
  });
  it("rejects truncated streams instead of marking success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('data: {"type":"delta","text":"部分内容"}\n\n', { headers: { "content-type": "text/event-stream" } })));
    await expect(streamText(input, new AbortController().signal, vi.fn())).rejects.toThrow("连接已中断");
  });
  it("expires the session on 401 without retrying", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"error":"请重新登录"}', { status: 401 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(streamText(input, new AbortController().signal, vi.fn())).rejects.toThrow("请重新登录");
    expect(notifySignedOut).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
  });
});
