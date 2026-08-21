import { parsePromptReferences, promptAssetMarker } from "./prompt-references";
import type { UploadAsset } from "./types";

export const promptNodeText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.assetId) return promptAssetMarker(node.dataset.assetId);
  if (node.tagName === "BR") return "\n";
  const content = Array.from(node.childNodes).map(promptNodeText).join("");
  return content + (["DIV", "P"].includes(node.tagName) ? "\n" : "");
};

export const createPromptAssetToken = (asset: UploadAsset | undefined, id: string) => {
  const token = document.createElement("span");
  token.className = "prompt-asset-token";
  token.contentEditable = "false";
  token.dataset.assetId = id;
  token.title = asset?.name ?? "正在恢复素材";
  if (asset?.preview) {
    const image = document.createElement("img");
    image.src = asset.preview;
    image.alt = "";
    token.append(image);
  }
  const label = document.createElement("span");
  label.textContent = asset?.name ?? "正在恢复素材";
  token.append(label);
  return token;
};

export const renderPromptValue = (editor: HTMLDivElement, value: string, assets: UploadAsset[]) => {
  const fragment = document.createDocumentFragment();
  for (const part of parsePromptReferences(value)) {
    if (part.type === "text") fragment.append(document.createTextNode(part.value));
    else fragment.append(createPromptAssetToken(assets.find((asset) => asset.id === part.id), part.id));
  }
  editor.replaceChildren(fragment);
};
