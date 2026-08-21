import { useCallback, useEffect, useReducer, useRef } from "react";
import { readPendingAssetPreview, removePendingAssetPreview, storePendingAssetPreview } from "./pending-asset-preview-cache";
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
  const assetStates = assets.map((asset) => `${asset.Id}:${asset.Status}`).join("|");

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
    void (async () => {
      let changed = false;
      for (const asset of assets) {
        if (asset.AssetType !== "Image" || asset.Status === "Active" || urls.current.has(asset.Id)) continue;
        const blob = await readPendingAssetPreview(userId, asset.Id);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        if (cancelled || !mounted.current || urls.current.has(asset.Id)) { URL.revokeObjectURL(url); continue; }
        urls.current.set(asset.Id, url);
        changed = true;
      }
      if (changed && mounted.current) render();
    })();
    return () => { cancelled = true; };
  }, [userId, assetStates]);

  useEffect(() => {
    let changed = false;
    const active = new Set(assets.filter((asset) => asset.Status === "Active").map((asset) => asset.Id));
    for (const [id, url] of urls.current) {
      if (!active.has(id)) continue;
      URL.revokeObjectURL(url);
      urls.current.delete(id);
      changed = true;
      void removePendingAssetPreview(userId, id);
    }
    if (changed) render();
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
