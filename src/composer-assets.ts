import type { CreationMode, ModelCapability, UploadAsset } from "./types";

const referenceRole = (type: UploadAsset["type"]): UploadAsset["role"] => type === "image" ? "reference_image" : type === "video" ? "reference_video" : "reference_audio";

/** Keep compatible references when the user changes generation mode instead of clearing everything. */
export const reconcileComposerAssets = (assets: UploadAsset[], engine: "video" | "image", mode: CreationMode, model?: ModelCapability) => {
  if (engine === "image") return assets.filter((asset) => asset.type === "image").slice(0, 4).map((asset) => ({ ...asset, role: "reference_image" as const }));
  if (!model || mode === "text") return [];
  if (mode === "first_frame") {
    const image = assets.find((asset) => asset.type === "image");
    return image ? [{ ...image, role: "first_frame" as const }] : [];
  }
  if (mode === "first_last") return assets.filter((asset) => asset.type === "image").slice(0, 2).map((asset, index) => ({ ...asset, role: index ? "last_frame" as const : "first_frame" as const }));
  const used = { image: 0, video: 0, audio: 0 };
  return assets.filter((asset) => {
    const limit = asset.type === "image" ? model.imageLimit : asset.type === "video" ? model.videoLimit : model.audioLimit;
    if (used[asset.type] >= limit) return false;
    used[asset.type] += 1;
    return true;
  }).map((asset) => ({ ...asset, role: referenceRole(asset.type) }));
};
