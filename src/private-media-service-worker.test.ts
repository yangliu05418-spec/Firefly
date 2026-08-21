import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { PRIVATE_MEDIA_CACHE_PREFIX } from "./private-media-cache";

type Handler = (event: Record<string, unknown>) => void;

describe("private media service worker scope", () => {
  it("bypasses cache before authentication and isolates cache names after account changes", async () => {
    const handlers = new Map<string, Handler>();
    const opened: string[] = [];
    const network = vi.fn(async () => new Response("image", { status: 200 }));
    const cache = { match: vi.fn(async () => undefined), put: vi.fn(async () => undefined), keys: vi.fn(async () => []) };
    const source = fs.readFileSync(new URL("../public/firefly-media-sw.js", import.meta.url), "utf8");
    const scope = {
      URL,
      Request,
      Promise,
      fetch: network,
      caches: {
        open: vi.fn(async (name: string) => { opened.push(name); return cache; }),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      },
      self: {
        location: { origin: "https://firefly.test" },
        clients: { claim: vi.fn(async () => undefined) },
        skipWaiting: vi.fn(),
        addEventListener: (name: string, handler: Handler) => handlers.set(name, handler),
      },
    };
    vm.runInNewContext(source, scope);
    const request = { method: "GET", destination: "image", url: "https://firefly.test/api/assets/asset-1/source?variant=thumbnail" };
    const dispatchFetch = async () => {
      let response: Promise<Response> | undefined;
      handlers.get("fetch")?.({ request, respondWith: (value: Promise<Response>) => { response = value; } });
      await response;
    };
    const setScope = (userId: string) => handlers.get("message")?.({ data: { type: "SET_PRIVATE_MEDIA_CACHE_SCOPE", userId }, ports: [{ postMessage: vi.fn() }] });

    await dispatchFetch();
    expect(network).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);

    setScope("user-a");
    await dispatchFetch();
    setScope("user-b");
    await dispatchFetch();

    expect(opened).toEqual([`${PRIVATE_MEDIA_CACHE_PREFIX}user-a`, `${PRIVATE_MEDIA_CACHE_PREFIX}user-b`]);

    handlers.get("message")?.({ data: { type: "CLEAR_PRIVATE_MEDIA_CACHE_SCOPE" }, ports: [] });
    await dispatchFetch();
    expect(network).toHaveBeenCalledTimes(4);
    expect(opened).toHaveLength(2);
  });
});
