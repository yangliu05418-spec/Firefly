import { parsePromptReferences, promptAssetMarker, referenceBindingId } from "./prompt-references";
import type { UploadAsset } from "./types";

const PROMPT_CARET_BOUNDARY = "\u200B";

export const promptNodeText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replaceAll(PROMPT_CARET_BOUNDARY, "");
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
    else fragment.append(
      createPromptAssetToken(assets.find((asset) => referenceBindingId(asset) === part.id || asset.id === part.id), part.id),
      document.createTextNode(PROMPT_CARET_BOUNDARY),
    );
  }
  editor.replaceChildren(fragment);
};

export const refreshPromptAssetTokens = (editor: HTMLDivElement, assets: UploadAsset[]) => {
  editor.querySelectorAll<HTMLElement>("[data-asset-id]").forEach((token) => {
    const asset = assets.find((candidate) => referenceBindingId(candidate) === token.dataset.assetId || candidate.id === token.dataset.assetId);
    const name = asset?.name ?? "正在恢复素材";
    token.title = name;
    let image = token.querySelector<HTMLImageElement>("img");
    if (asset?.preview) {
      if (!image) {
        image = document.createElement("img");
        image.alt = "";
        token.prepend(image);
      }
      if (image.getAttribute("src") !== asset.preview) image.src = asset.preview;
    } else image?.remove();
    const label = token.querySelector<HTMLElement>("span");
    if (label) label.textContent = name;
  });
};

export const focusPromptEditorAtEnd = (editor: HTMLDivElement) => {
  if (!editor.childNodes.length) editor.append(document.createTextNode(PROMPT_CARET_BOUNDARY));
  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
};
