// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createPromptAssetToken, promptNodeText, renderPromptValue } from "./prompt-editor-dom";
import type { UploadAsset } from "./types";

const asset: UploadAsset = { id: "image-1", uploadId: "upload-1", name: "夜景参考", type: "image", size: 20, role: "reference_image", progress: 100, phase: "ready", preview: "/api/assets/image-1/source" };

describe("prompt editor DOM restoration", () => {
  it("renders a persisted asset marker as a named thumbnail token and serializes it losslessly", () => {
    const editor = document.createElement("div");
    const value = "让 [[firefly-asset:image-1]] 中的灯光更柔和";
    renderPromptValue(editor, value, [asset]);
    const token = editor.querySelector<HTMLElement>("[data-asset-id='image-1']");
    expect(token?.title).toBe("夜景参考");
    expect(token?.querySelector("img")?.getAttribute("src")).toBe("/api/assets/image-1/source");
    expect(Array.from(editor.childNodes).map(promptNodeText).join("")).toBe(value);
  });

  it("shows a recoverable placeholder while a cached reference is being checked", () => {
    const token = createPromptAssetToken(undefined, "missing");
    expect(token.textContent).toBe("正在恢复素材");
    expect(token.dataset.assetId).toBe("missing");
  });
});
