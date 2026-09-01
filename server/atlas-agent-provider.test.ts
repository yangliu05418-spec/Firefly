import { describe, expect, it, vi } from "vitest";
import { OpenRouterKeyPool } from "./openrouter.js";
import { AtlasAgentProviderError, OpenRouterAtlasAgentProvider } from "./atlas-agent-provider.js";
import { atlasAgentCatalogForPhase } from "./atlas-agent-contract.js";

const snapshot = {
  version: 1 as const, revision: 0, durationMs: 1_000,
  tracks: [{ id: "track-1", kind: "video" as const, muted: false, locked: false, clipIds: ["clip-1"] }],
  clips: [{ id: "clip-1", trackId: "track-1", kind: "video" as const, startMs: 0, durationMs: 1_000 }],
  assets: [], selection: { clipIds: ["clip-1"], trackIds: [] },
};

describe("OpenRouter Atlas Agent provider", () => {
  it("uses the existing key pool and a bounded tool discovery loop", async () => {
    let round = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.response_format).toBeUndefined();
      expect(body.tool_choice).toBe("required");
      expect(body.provider).toEqual({ require_parameters: true });
      expect(JSON.stringify(body)).not.toContain("https://signed.example");
      round += 1;
      const call = round === 1
        ? { id: "call-1", type: "function", function: { name: "get_tool_contracts", arguments: JSON.stringify({ names: ["splitClip"] }) } }
        : { id: "call-2", type: "function", function: { name: "submit_plan", arguments: JSON.stringify({ version: 1, summary: "切割", operations: [{ sequence: 1, tool: "splitClip", args: { clipId: "clip-1", splitTime: 0.5 } }] }) } };
      return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [call] } }] }), { status: 200, headers: { "content-type": "application/json", "x-request-id": `provider-request-${round}` } });
    });
    const provider = new OpenRouterAtlasAgentProvider({
      model: "test/model", timeoutMs: 1_000, baseUrl: "https://openrouter.example/api/v1", origin: "https://firefly.example",
      keyPool: new OpenRouterKeyPool(["secret-key"]), fetchImpl: fetchMock as typeof fetch,
    });

    const catalog = atlasAgentCatalogForPhase("core");
    const result = await provider.createPlan({ instruction: "从中间切开", snapshot, maxToolCalls: 8, phase: "core", catalogVersion: catalog.version, catalogDigest: catalog.digest });

    expect(result.requestId).toBe("provider-request-2");
    expect(result.plan).toMatchObject({ version: 1, operations: [{ tool: "splitClip" }] });
    expect(result.rounds).toBe(2);
    expect(result.catalogInspections).toBe(1);
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

  it("offers exactly one bounded repair round for an invalid submitted plan", async () => {
    let round = 0;
    const requestBodies: string[] = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(String(init?.body ?? ""));
      round += 1;
      const argumentsValue = round === 1
        ? { version: 1, summary: "切割", operations: [{ sequence: 1, tool: "splitClip", args: { clipId: "clip-1" } }] }
        : { version: 1, summary: "切割", operations: [{ sequence: 1, tool: "splitClip", args: { clipId: "clip-1", splitTime: 0.5 } }] };
      return new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{
        id: `call-${round}`, type: "function", function: { name: "submit_plan", arguments: JSON.stringify(argumentsValue) },
      }] } }] }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const provider = new OpenRouterAtlasAgentProvider({
      model: "test/model", timeoutMs: 1_000, maxRounds: 3, baseUrl: "https://openrouter.example/api/v1",
      keyPool: new OpenRouterKeyPool(["secret-key"]), fetchImpl: fetchMock as typeof fetch,
    });

    const result = await provider.createPlan({ instruction: "从中间切开", snapshot, maxToolCalls: 8, maxRounds: 3, phase: "core" });

    expect(result).toMatchObject({ repaired: true, rounds: 2, plan: { operations: [{ tool: "splitClip" }] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String((JSON.parse(requestBodies[1]!) as { messages: Array<{ content?: string }> }).messages.at(-1)?.content)).toContain("仅修正");
  });
});
