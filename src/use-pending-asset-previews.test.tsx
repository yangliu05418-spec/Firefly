// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryAsset } from "./types";
import { usePendingAssetPreviews } from "./use-pending-asset-previews";

const cache = vi.hoisted(() => ({
  read: vi.fn<() => Promise<Blob | undefined>>(),
  remove: vi.fn<() => Promise<void>>(),
  store: vi.fn<() => Promise<void>>(),
}));

vi.mock("./pending-asset-preview-cache", () => ({
  readPendingAssetPreview: cache.read,
  removePendingAssetPreview: cache.remove,
  storePendingAssetPreview: cache.store,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const asset = (Status: LibraryAsset["Status"]): LibraryAsset => ({
  Id: "asset-1", Name: "frame.png", AssetType: "Image", Status,
  URL: Status === "Active" ? "/api/assets/asset-1/source?variant=thumbnail" : undefined,
  GroupId: "group-1", Category: "material",
});

function Harness({ current, onReady }: { current: LibraryAsset; onReady?: (remember: (id: string, blob: Blob) => void) => void }) {
  const previews = usePendingAssetPreviews("user-1", [current]);
  useEffect(() => onReady?.(previews.remember), [onReady, previews.remember]);
  return <output>{previews.get(current.Id) ?? "none"}</output>;
}

describe("pending asset preview hook", () => {
  let container: HTMLDivElement;
  let nextUrl = 0;
  const revoke = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    nextUrl = 0;
    cache.read.mockReset().mockResolvedValue(undefined);
    cache.remove.mockReset().mockResolvedValue(undefined);
    cache.store.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:test-${++nextUrl}`) });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revoke });
    revoke.mockReset();
  });

  afterEach(() => { container.remove(); });

  it("shows a local upload immediately and releases it when the remote asset is active", async () => {
    const root = createRoot(container);
    let remember: ((id: string, blob: Blob) => void) | undefined;
    await act(async () => { root.render(<Harness current={asset("Processing")} onReady={(callback) => { remember = callback; }} />); });
    await act(async () => { remember?.("asset-1", new Blob(["preview"], { type: "image/webp" })); });
    expect(container.textContent).toBe("blob:test-1");
    expect(cache.store).toHaveBeenCalledWith("user-1", "asset-1", expect.any(Blob));

    await act(async () => { root.render(<Harness current={asset("Active")} />); });
    expect(container.textContent).toBe("none");
    expect(cache.remove).toHaveBeenCalledWith("user-1", "asset-1");
    expect(revoke).toHaveBeenCalledWith("blob:test-1");
    await act(async () => root.unmount());
  });

  it("restores a pending preview after a refresh", async () => {
    cache.read.mockResolvedValue(new Blob(["cached"], { type: "image/webp" }));
    const root = createRoot(container);
    await act(async () => { root.render(<Harness current={asset("Processing")} />); await Promise.resolve(); });
    expect(container.textContent).toBe("blob:test-1");
    await act(async () => root.unmount());
    expect(revoke).toHaveBeenCalledWith("blob:test-1");
  });
});
