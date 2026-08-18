// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { isEditableTarget, isImeComposing } from "./keyboard";

describe("keyboard guards", () => {
  it("detects IME composition states", () => {
    expect(isImeComposing({ isComposing: true, keyCode: 0 } as KeyboardEvent)).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 229 } as KeyboardEvent)).toBe(true);
    expect(isImeComposing({ isComposing: false, keyCode: 65, which: 65 } as KeyboardEvent)).toBe(false);
  });

  it("excludes editable targets", () => {
    const input = document.createElement("input");
    expect(isEditableTarget(input)).toBe(true);
    const textarea = document.createElement("textarea");
    expect(isEditableTarget(textarea)).toBe(true);
    const select = document.createElement("select");
    expect(isEditableTarget(select)).toBe(true);
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    expect(isEditableTarget(editable)).toBe(true);
    const nested = document.createElement("div");
    const inner = document.createElement("span");
    nested.setAttribute("contenteditable", "true");
    nested.appendChild(inner);
    expect(isEditableTarget(inner)).toBe(true);
    const video = document.createElement("video");
    video.setAttribute("data-canvas-no-zoom", "");
    expect(isEditableTarget(video)).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
