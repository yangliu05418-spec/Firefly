import type { UploadAsset } from "./types";

const markerPattern = /\[\[firefly-asset:([^\]]+)\]\]/g;

export const promptAssetMarker = (id: string) => `[[firefly-asset:${id}]]`;

export const promptAssetLabel = (asset: UploadAsset, assets: UploadAsset[]) => {
  const ordinal = assets.filter((item) => item.type === asset.type).findIndex((item) => item.id === asset.id) + 1;
  const type = asset.type === "image" ? "Image" : asset.type === "video" ? "Video" : "Audio";
  return `${type} ${Math.max(1, ordinal)}`;
};

export const materializePromptReferences = (prompt: string, assets: UploadAsset[]) => prompt
  .replace(markerPattern, (_match, id: string) => {
    const asset = assets.find((item) => item.id === id);
    return asset ? promptAssetLabel(asset, assets) : "";
  })
  .replace(/[ \t]{2,}/g, " ")
  .trim();

