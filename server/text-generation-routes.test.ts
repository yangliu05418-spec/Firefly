import express from "express";
import type { AddressInfo } from "node:net";
import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ touch: vi.fn(), admission: 1 }));
vi.mock("./config.js", () => ({ config: { openrouterApiKeys: ["test-only-key"], openrouterBaseUrl: "https://provider.test/v1", origin: "https://firefly.test" } }));
vi.mock("./auth.js", () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => { if (!req.header("x-test-user")) return res.sendStatus(401); res.locals.user = { id: req.header("x-test-user") }; next(); } }));
vi.mock("./store.js", () => ({ users: { readCreationSession: () => ({ ownerId: "owner" }), touchCreationSession: state.touch } }));
import { registerTextGenerationRoutes } from "./text-generation-routes.js";

describe("text streaming HTTP admission", () => {
  let server: ReturnType<express.Express["listen"]>;
  let origin: string;
  const release = vi.fn().mockResolvedValue(1);
  beforeEach(async () => {
    state.admission = 1; state.touch.mockClear(); release.mockClear();
    const app = express(); app.use(express.json()); registerTextGenerationRoutes(app, { eval: async () => state.admission, zrem: release } as unknown as Redis);
    server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => { vi.unstubAllGlobals(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const input = () => ({ model: "openai/gpt-5.6-sol", prompt: "  hello\n ", requestId: crypto.randomUUID(), sessionId: crypto.randomUUID() });
  const post = (user = "owner") => fetch(`${origin}/api/text-generations`, { method: "POST", headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) }, body: JSON.stringify(input()) });
  it("requires login and masks other users' sessions", async () => {
    expect((await post("")).status).toBe(401); expect((await post("other")).status).toBe(404); expect(state.touch).not.toHaveBeenCalled();
  });
  it("rejects duplicate admission and concurrency overflow before the provider", async () => {
    state.admission = 0; expect((await post()).status).toBe(409);
    state.admission = -1; expect((await post()).status).toBe(429); expect(state.touch).not.toHaveBeenCalled();
  });
  it("streams raw single-turn input with no automatic second provider request", async () => {
    const original = globalThis.fetch;
    const provider = vi.fn(async (_url: string, _options: RequestInit) => new Response('data: {"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", (url: string, options: RequestInit) => url.startsWith("https://provider.test") ? provider(url, options) : original(url, options));
    const response = await post(); expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(await response.text()).toContain('"type":"done"');
    expect(provider).toHaveBeenCalledTimes(1);
    const body = JSON.parse((provider.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.messages).toEqual([{ role: "user", content: "  hello\n " }]);
    expect(release).toHaveBeenCalled();
  });
  it("aborts upstream and releases admission when the browser stops", async () => {
    const original = globalThis.fetch;
    let upstream: AbortSignal | undefined;
    const provider = vi.fn((_url: string, options: RequestInit) => {
      upstream = options.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => upstream!.addEventListener("abort", () => reject(upstream!.reason), { once: true }));
    });
    vi.stubGlobal("fetch", (url: string, options: RequestInit) => url.startsWith("https://provider.test") ? provider(url, options) : original(url, options));
    const response = await post();
    await response.body!.cancel();
    await vi.waitFor(() => expect(upstream?.aborted).toBe(true));
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(provider).toHaveBeenCalledOnce();
  });
});
