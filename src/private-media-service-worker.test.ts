import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PRIVATE_MEDIA_CACHE_PREFIX } from "./private-media-cache";

type Handler = (event: Record<string, unknown>) => void;

describe("private media service worker scope", () => {
  it("bypasses cache before authentication and keeps concurrent browser clients isolated", async () => {
    const handlers = new Map<string, Handler>();
    const opened: string[] = [];
    const recoveryScopes = new Map<string, string>();
    const network = vi.fn(async () => new Response("image", { status: 200 }));
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined), keys: vi.fn(async () => []) };
    const source = fs.readFileSync(new URL("../public/firefly-media-sw.js", import.meta.url), "utf8");
    const scope = {
      URL,
      Request,
      Promise,
      setTimeout,
      clearTimeout,
      fetch: network,
      caches: {
        open: vi.fn(async (name: string) => { opened.push(name); return cache; }),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      },
      self: {
        location: { origin: "https://firefly.test" },
        clients: {
          claim: vi.fn(async () => undefined),
          get: vi.fn(async (clientId: string) => recoveryScopes.has(clientId) ? {
            postMessage: (message: { type?: string }) => {
              if (message.type !== "REQUEST_PRIVATE_MEDIA_CACHE_SCOPE") return;
              const userId = recoveryScopes.get(clientId);
              if (userId) handlers.get("message")?.({ data: { type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId }, source: { id: clientId }, ports: [] });
            },
          } : undefined),
        },
        skipWaiting: vi.fn(),
        addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
      },
    };
    vm.runInNewContext(source, scope);
    const request = { method: "GET", destination: "image", url: "https://firefly.test/api/assets/asset-1/source?variant=thumbnail" };
    const dispatchFetch = async (clientId: string) => {
      let response: Promise<Response> | undefined;
      handlers.get("fetch")?.({ request, clientId, respondWith: (value: Promise<Response>) => { response = value; } });
      await response;
    };
    const setScope = (clientId: string, userId: string) => handlers.get("message")?.({ data: { type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId }, source: { id: clientId }, ports: [{ postMessage: vi.fn() }] });

    await dispatchFetch("anonymous-client");
    expect(network).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);

    recoveryScopes.set("restarted-client", "user-restored");
    await dispatchFetch("restarted-client");
    expect(opened).toEqual([`${PRIVATE_MEDIA_CACHE_PREFIX}user-restored`]);

    setScope("client-a", "user-a");
    await dispatchFetch("client-a");
    setScope("client-b", "user-b");
    await dispatchFetch("client-b");
    await dispatchFetch("client-a");

    expect(opened).toEqual([`${PRIVATE_MEDIA_CACHE_PREFIX}user-restored`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-a`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-b`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-a`]);

    handlers.get("message")?.({ data: { type: "CLEAR_PRIVATE_MEDIA_CACHE_SCOPE" }, source: { id: "client-b" }, ports: [] });
    await dispatchFetch("client-b");
    await dispatchFetch("client-a");
    expect(network).toHaveBeenCalledTimes(7);
    expect(opened).toEqual([`${PRIVATE_MEDIA_CACHE_PREFIX}user-restored`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-a`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-b`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-a`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-a`]);
  });
});
