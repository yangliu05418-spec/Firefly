import { useCallback, useEffect, useReducer, useRef } from "react";
import { readPendingAssetPreviews, removePendingAssetPreview, storePendingAssetPreview } from "./pending-asset-preview-cache";
import type { LibraryAsset } from "./types";

/**
 * Keeps newly uploaded images visible while provider registration finishes.
 * Blob URLs are tab-local; CacheStorage is the refresh/crash recovery layer.
 */
export function usePendingAssetPreviews(userId: string, assets: readonly LibraryAsset[]) {
  const urls = useRef(new Map<string, string>());
  const mounted = useRef(true);
  const scopedUserId = useRef(userId);
  const [, render] = useReducer((revision) => revision + 1, 0);
  const assetStates = assets.map((asset) => `${asset.Id}:${asset.Status}:${asset.URL ?? ""}`).join("|");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const url of urls.current.values()) URL.revokeObjectURL(url);
      urls.current.clear();
    };
  }, []);

  useEffect(() => {
    if (scopedUserId.current === userId) return;
    scopedUserId.current = userId;
    for (const url of urls.current.values()) URL.revokeObjectURL(url);
    urls.current.clear();
    render();
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    const preloaders = new Set<HTMLImageElement>();
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();
    const wait = (delay: number) => new Promise<void>((resolve) => {
      const timer = setTimeout(() => { retryTimers.delete(timer); resolve(); }, delay);
      retryTimers.add(timer);
    });
    const preload = (asset: LibraryAsset) => new Promise<boolean>((resolve) => {
      if (!asset.URL || typeof Image === "undefined") return resolve(false);
      const image = new Image();
      preloaders.add(image);
      const finish = (ready: boolean) => {
        image.onload = null;
        image.onerror = null;
        preloaders.delete(image);
        resolve(ready);
      };
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      image.src = asset.URL;
    });
    const warmRemotePreviews = async () => {
      let pending = assets.filter((asset) => asset.AssetType === "Image" && asset.Status === "Active" && asset.URL && urls.current.has(asset.Id));
      for (const delay of [0, 2_000, 6_000]) {
        if (!pending.length || cancelled) return;
        if (delay) await wait(delay);
        if (cancelled) return;
        let cursor = 0;
        const failed: LibraryAsset[] = [];
        const worker = async () => {
          while (!cancelled && cursor < pending.length) {
            const asset = pending[cursor++];
            const localUrl = urls.current.get(asset.Id);
            if (!localUrl) continue;
            if (!await preload(asset)) { failed.push(asset); continue; }
            if (cancelled || scopedUserId.current !== userId || urls.current.get(asset.Id) !== localUrl) continue;
            URL.revokeObjectURL(localUrl);
            urls.current.delete(asset.Id);
            void removePendingAssetPreview(userId, asset.Id);
            if (mounted.current) render();
          }
        };
        await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
        pending = failed;
      }
    };
    void (async () => {
      let changed = false;
      const candidates = assets.filter((asset) => asset.AssetType === "Image" && !urls.current.has(asset.Id));
      const restored = await readPendingAssetPreviews(userId, candidates.map((asset) => asset.Id));
      for (const asset of candidates) {
        const blob = restored.get(asset.Id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        if (cancelled || !mounted.current || urls.current.has(asset.Id)) { URL.revokeObjectURL(url); continue; }
        urls.current.set(asset.Id, url);
        changed = true;
      }
      if (changed && mounted.current) render();
      await warmRemotePreviews();
    })();
    return () => {
      cancelled = true;
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      for (const image of preloaders) {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      }
      preloaders.clear();
    };
  }, [userId, assetStates]);

  const remember = useCallback((assetId: string, blob: Blob) => {
    const previous = urls.current.get(assetId);
    if (previous) URL.revokeObjectURL(previous);
    urls.current.set(assetId, URL.createObjectURL(blob));
    if (mounted.current) render();
    void storePendingAssetPreview(userId, assetId, blob);
  }, [userId]);

  const remove = useCallback((assetId: string) => {
    const existing = urls.current.get(assetId);
    if (existing) URL.revokeObjectURL(existing);
    urls.current.delete(assetId);
    if (mounted.current) render();
    void removePendingAssetPreview(userId, assetId);
  }, [userId]);

  return { get: (assetId: string) => urls.current.get(assetId), remember, remove };
}
