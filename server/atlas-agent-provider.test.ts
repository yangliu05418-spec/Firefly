import { describe, expect, it, vi } from "vitest";
import { OpenRouterKeyPool } from "./openrouter.js";
import { AtlasAgentProviderError, OpenRouterAtlasAgentProvider } from "./atlas-agent-provider.js";

const snapshot = {
  version: 1 as const, revision: 0, durationMs: 1_000,
  tracks: [{ id: "track-1", kind: "video" as const, muted: false, locked: false, clipIds: ["clip-1"] }],
  clips: [{ id: "clip-1", trackId: "track-1", kind: "video" as const, startMs: 0, durationMs: 1_000 }],
  assets: [], selection: { clipIds: ["clip-1"], trackIds: [] },
};

describe("OpenRouter Atlas Agent provider", () => {
  it("uses the existing key pool and requests strict structured output", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect((body.response_format as { type: string }).type).toBe("json_schema");
      expect(JSON.stringify(body)).not.toContain("https://signed.example");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        version: 1, summary: "切割", operations: [{ sequence: 1, tool: "split_clip", args: { clipId: "clip-1", atMs: 500 } }],
      }) } }] }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "provider-request-1" } });
    });
    const provider = new OpenRouterAtlasAgentProvider({
      model: "test/model", timeoutMs: 1_000, baseUrl: "https://openrouter.example/api/v1", origin: "https://firefly.example",
      keyPool: new OpenRouterKeyPool(["secret-key"]), fetchImpl: fetchMock as typeof fetch,
    });

    const result = await provider.createPlan({ instruction: "从中间切开", snapshot, maxToolCalls: 8 });

    expect(result.requestId).toBe("provider-request-1");
    expect(result.plan).toMatchObject({ version: 1, operations: [{ tool: "split_clip" }] });
    const request = fetchMock.mock.calls[0]?.[1];
    expect((request?.headers as Record<string, string>).Authorization).toBe("Bearer secret-key");
  });

  it("does not retry deterministic provider rejections", async () => {
    const fetchMock = vi.fn(async () => new Response("invalid", { status: 400 }));
    const provider = new OpenRouterAtlasAgentProvider({
      keyPool: new OpenRouterKeyPool(["key-a", "key-b"]), fetchImpl: fetchMock as typeof fetch, baseUrl: "https://openrouter.example", timeoutMs: 1_000,
    });
    await expect(provider.createPlan({ instruction: "剪辑", snapshot, maxToolCalls: 8 }))
      .rejects.toMatchObject({ code: "AGENT_PROVIDER_REJECTED", retryable: false } satisfies Partial<AtlasAgentProviderError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
