import { describe, expect, it } from "vitest";
import { boxRectFromPoints, isDragMoved, nodeIntersectsBox, selectNodesInBox, toggleNodeSelection } from "./selection";
import type { CanvasNode } from "../canvas-types";

const n = (id: string, x: number, y: number, w = 100, h = 60): CanvasNode => ({ id, type: "text", title: id, position: { x, y }, width: w, height: h, metadata: {} });

describe("selection", () => {
  it("detects AABB intersection including edge touching", () => {
    const node = n("a", 0, 0, 100, 60);
    expect(nodeIntersectsBox(node, { x: 50, y: 30, width: 10, height: 10 })).toBe(true);
    expect(nodeIntersectsBox(node, { x: 100, y: 0, width: 10, height: 10 })).toBe(false);
    expect(nodeIntersectsBox(node, { x: 0, y: 60, width: 10, height: 10 })).toBe(false);
    expect(nodeIntersectsBox(node, { x: 99, y: 59, width: 2, height: 2 })).toBe(true);
  });

  it("box selection works with negative drag directions", () => {
    const nodes = [n("a", 0, 0), n("b", 200, 200)];
    const rect = boxRectFromPoints(150, 150, 50, 50);
    expect(rect).toEqual({ x: 50, y: 50, width: 100, height: 100 });
    expect(selectNodesInBox(nodes, rect, false, [])).toEqual(new Set(["a"]));
  });

  it("additive box selection preserves the initial selection", () => {
    const nodes = [n("a", 0, 0), n("b", 200, 200), n("c", 400, 400)];
    expect(selectNodesInBox(nodes, { x: -10, y: -10, width: 300, height: 300 }, true, ["c"])).toEqual(new Set(["c", "a", "b"]));
    expect(selectNodesInBox(nodes, { x: -10, y: -10, width: 300, height: 300 }, false, ["c"])).toEqual(new Set(["a", "b"]));
  });

  it("toggleNodeSelection toggles in additive mode and replaces in plain mode", () => {
    expect(toggleNodeSelection(new Set(["a"]), "b", true)).toEqual(new Set(["a", "b"]));
    expect(toggleNodeSelection(new Set(["a", "b"]), "a", true)).toEqual(new Set(["b"]));
    expect(toggleNodeSelection(new Set(["a", "b"]), "c", false)).toEqual(new Set(["c"]));
    expect(toggleNodeSelection(new Set(["a", "b"]), "a", false)).toEqual(new Set(["a", "b"]));
  });

  it("isDragMoved uses a 3px threshold", () => {
    expect(isDragMoved(0, 0, 2, 2)).toBe(false);
    expect(isDragMoved(0, 0, 4, 0)).toBe(true);
    expect(isDragMoved(0, 0, 0, -4)).toBe(true);
    expect(isDragMoved(0, 0, 3, 0)).toBe(false);
  });
});
