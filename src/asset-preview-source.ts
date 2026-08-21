import type { LibraryAsset } from "./types";

/** Never issue a guaranteed-to-fail protected media request before the worker marks the asset Active. */
export const assetPreviewSource = (asset: LibraryAsset, localPreview?: string) => localPreview || (asset.Status === "Active" ? asset.URL : undefined);
