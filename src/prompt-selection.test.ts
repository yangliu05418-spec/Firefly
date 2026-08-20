// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { clearEditorSelection } from "./prompt-selection";

describe("prompt editor selection cleanup", () => {
  it("clears a caret left inside the editor after blur", () => {
    const editor = document.createElement("div");
    const text = document.createTextNode("镜头描述");
    editor.append(text);
    document.body.append(editor);

    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    selection.addRange(range);

    expect(clearEditorSelection(editor, selection)).toBe(true);
    expect(selection.rangeCount).toBe(0);
  });

  it("preserves a selection that belongs to another component", () => {
    const editor = document.createElement("div");
    const outside = document.createTextNode("外部内容");
    document.body.append(editor, outside);

    const selection = window.getSelection()!;
    const range = document.createRange();
    range.setStart(outside, 1);
    range.collapse(true);
    selection.addRange(range);

    expect(clearEditorSelection(editor, selection)).toBe(false);
    expect(selection.rangeCount).toBe(1);
  });
});
