import type { AssetCategory } from "./types";

export const assetCategoryLabels: Record<AssetCategory, string> = {
  character: "角色",
  scene: "场景",
  prop: "道具",
  material: "素材",
};

export const assetCategories = Object.keys(assetCategoryLabels) as AssetCategory[];
