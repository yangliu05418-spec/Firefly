import { assetMetadataCache, createAssetMetadataCache, loadAssetsCacheFirst } from "./asset-metadata-cache";
import type { LibraryAsset, UploadAsset } from "./types";

const isReadyAsset = (asset: LibraryAsset) => asset.Status === "Active";

export const toPromptLibraryAsset = (asset: LibraryAsset): UploadAsset => ({
  id: asset.Id,
  assetId: asset.Id,
  name: asset.Name || asset.Id,
  type: asset.AssetType.toLowerCase() as UploadAsset["type"],
  size: 0,
  role: asset.AssetType === "Image" ? "reference_image" : asset.AssetType === "Video" ? "reference_video" : "reference_audio",
  progress: 100,
  preview: asset.URL,
});

export async function loadPromptLibraryCacheFirst(options: {
  userId: string;
  loadFresh: () => Promise<LibraryAsset[]>;
  onCached?: (assets: UploadAsset[]) => void;
  cache?: ReturnType<typeof createAssetMetadataCache>;
}) {
  const result = await loadAssetsCacheFirst({
    userId: options.userId,
    loadFresh: options.loadFresh,
    selectCached: (assets) => assets.filter(isReadyAsset),
    onCached: (assets) => options.onCached?.(assets.map(toPromptLibraryAsset)),
    cache: options.cache ?? assetMetadataCache,
  });
  return {
    ...result,
    assets: result.assets.filter(isReadyAsset).map(toPromptLibraryAsset),
  };
}
