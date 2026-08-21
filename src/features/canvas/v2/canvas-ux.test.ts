import { describe, expect, it } from "vitest";
import type { CanvasNodeV2 } from "../canvas-v2-types";
import { hasCanvasConnection, incomingCanvasReferences, placeCanvasMenu, withoutEphemeralCanvasElements } from "./canvas-ux";

describe("placeCanvasMenu", () => {
  it("anchors a right-side menu beside the clicked plus and vertically centers it", () => {
    expect(placeCanvasMenu(
      { left: 400, right: 424, top: 260, bottom: 284 },
      { width: 224, height: 248 },
      { width: 1280, height: 800 },
      "right",
    )).toEqual({ left: 434, top: 148, placement: "right" });
  });

  it("flips at the viewport edge and clamps tall menus inside the viewport", () => {
    expect(placeCanvasMenu(
      { left: 1190, right: 1214, top: 30, bottom: 54 },
      { width: 224, height: 620 },
      { width: 1280, height: 640 },
      "right",
    )).toEqual({ left: 956, top: 12, placement: "left" });
  });
});

describe("incomingCanvasReferences", () => {
  const node = (id: string, title: string, type: CanvasNodeV2["type"]): CanvasNodeV2 => ({
    id, title, type, position: { x: 0, y: 0 }, width: 300, height: 220, data: {},
  });

  it("reports real incoming nodes in connection order and de-duplicates duplicate edges", () => {
    const nodes = [node("script", "雨夜对白", "text"), node("hero", "女主参考", "character"), node("shot", "镜头草图", "image")];
    expect(incomingCanvasReferences("shot", nodes, [
      { source: "script", target: "shot" },
      { source: "script", target: "shot" },
      { source: "hero", target: "shot" },
      { source: "missing", target: "shot" },
    ])).toEqual([
      { sourceId: "script", title: "雨夜对白", type: "text" },
      { sourceId: "hero", title: "女主参考", type: "character" },
    ]);
  });

  it("recognizes an existing source-target relation", () => {
    expect(hasCanvasConnection([{ source: "a", target: "b" }], "a", "b")).toBe(true);
    expect(hasCanvasConnection([{ source: "a", target: "b" }], "b", "a")).toBe(false);
  });

  it("keeps optimistic browser-only results out of persisted documents until upload finishes", () => {
    const result = withoutEphemeralCanvasElements(
      [{ id: "source" }, { id: "local-result" }, { id: "saved-result" }],
      [{ source: "source", target: "local-result" }, { source: "source", target: "saved-result" }],
      new Set(["local-result"]),
    );
    expect(result).toEqual({
      nodes: [{ id: "source" }, { id: "saved-result" }],
      connections: [{ source: "source", target: "saved-result" }],
    });
  });
});
