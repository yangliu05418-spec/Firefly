import type { UploadAsset } from "./types";

const markerPattern = /\[\[firefly-(?:asset|ref):([^\]]+)\]\]/g;

export type PromptReferencePart = { type: "text"; value: string } | { type: "asset"; id: string };

export const parsePromptReferences = (prompt: string): PromptReferencePart[] => {
  const parts: PromptReferencePart[] = [];
  let cursor = 0;
  for (const match of prompt.matchAll(markerPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: "text", value: prompt.slice(cursor, index) });
    parts.push({ type: "asset", id: match[1] });
    cursor = index + match[0].length;
  }
  if (cursor < prompt.length) parts.push({ type: "text", value: prompt.slice(cursor) });
  return parts;
};

export const referenceBindingId = (asset: UploadAsset) => asset.bindingId ?? asset.id;
export const promptAssetMarker = (id: string) => `[[firefly-ref:${id}]]`;

export const promptAssetLabel = (asset: UploadAsset, assets: UploadAsset[]) => {
  const ordinal = assets.filter((item) => item.type === asset.type).findIndex((item) => referenceBindingId(item) === referenceBindingId(asset)) + 1;
  const type = asset.type === "image" ? "Image" : asset.type === "video" ? "Video" : "Audio";
  return `${type} ${Math.max(1, ordinal)}`;
};

export const materializePromptReferences = (prompt: string, assets: UploadAsset[]) => prompt
  .replace(markerPattern, (_match, id: string) => {
    const asset = assets.find((item) => referenceBindingId(item) === id || item.id === id);
    return asset ? promptAssetLabel(asset, assets) : "";
  })
  .replace(/[ \t]{2,}/g, " ")
  .trim();

