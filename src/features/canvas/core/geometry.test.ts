import { describe, expect, it } from "vitest";
import { findContainingGroupId, findGroupDropTarget, fitNodeSize, getConnectionTargetAnchor, nodeBounds, nodeSizeFromRatio, normalizeConnection, snapNodesIntoGroup } from "./geometry";
import type { CanvasNode } from "../canvas-types";

const n = (id: string, x: number, y: number, w = 100, h = 60, type: CanvasNode["type"] = "text", metadata: CanvasNode["metadata"] = {}): CanvasNode => ({ id, type, title: id, position: { x, y }, width: w, height: h, metadata });

const group = (id: string, x: number, y: number, w = 300, h = 200): CanvasNode => n(id, x, y, w, h, "group");

describe("geometry.nodeBounds", () => {
  it("computes the union bounds of nodes", () => {
    expect(nodeBounds([n("a", 10, 20, 100, 60), n("b", -5, 200, 50, 40)])).toEqual({ left: -5, top: 20, right: 110, bottom: 240 });
  });
});

describe("geometry.findGroupDropTarget", () => {
  it("returns the top-most group whose bounds contain a moving node center", () => {
    const outer = group("outer", 0, 0, 400, 400);
    const inner = group("inner", 50, 50, 200, 200);
    const moved = n("m1", 100, 100);
    expect(findGroupDropTarget(new Set(["m1"]), [outer, inner, moved])?.id).toBe("inner");
  });

  it("rejects dragging a group itself or empty selections", () => {
    const g = group("g1", 0, 0);
    expect(findGroupDropTarget(new Set(["g1"]), [g])).toBeNull();
    expect(findGroupDropTarget(new Set([]), [g, n("a", 10, 10)])).toBeNull();
  });

  it("ignores nodes outside every group", () => {
    const g = group("g1", 0, 0);
    const moved = n("m1", 500, 500);
    expect(findGroupDropTarget(new Set(["m1"]), [g, moved])).toBeNull();
  });
});

describe("geometry.snapNodesIntoGroup", () => {
  const moving = [n("m1", 0, 0, 100, 60), n("m2", 110, 0, 100, 60)];
  it("shifts right when nodes overflow the left edge", () => {
    const result = snapNodesIntoGroup(new Set(["m1", "m2"]), moving, group("g", 400, 100, 300, 200));
    expect(result[0].position.x).toBe(424);
    expect(result[0].metadata.groupId).toBe("g");
  });
  it("shifts right when nodes overflow the left edge (uniform offset for all moved nodes)", () => {
    const result = snapNodesIntoGroup(new Set(["m1", "m2"]), moving, group("g", 100, 100, 300, 200));
    expect(result[0].position.x).toBe(124);
    expect(result[1].position.x).toBe(234);
  });
  it("keeps position when already inside", () => {
    const result = snapNodesIntoGroup(new Set(["m1", "m2"]), moving, group("g", -50, -50, 500, 300));
    expect(result[0].position.x).toBe(0);
  });
  it("left-aligns oversized groups instead of squeezing", () => {
    const result = snapNodesIntoGroup(new Set(["m1", "m2"]), moving, group("g", 400, 100, 60, 200));
    expect(result[0].position.x).toBe(424);
  });
  it("does not move nodes outside the selection", () => {
    const result = snapNodesIntoGroup(new Set(["m1"]), moving, group("g", 400, 100, 300, 200));
    expect(result[0].position.x).toBe(424);
    expect(result[1].position.x).toBe(110);
    expect(result[1].metadata.groupId).toBeUndefined();
  });
});

describe("geometry.findContainingGroupId", () => {
  it("returns the top-most group by node center", () => {
    const outer = group("outer", 0, 0, 400, 400);
    const inner = group("inner", 50, 50, 200, 200);
    expect(findContainingGroupId(n("a", 100, 100), [outer, inner])).toBe("inner");
    expect(findContainingGroupId(n("a", 100, 100), [outer])).toBe("outer");
    expect(findContainingGroupId(n("a", 900, 900), [outer, inner])).toBeUndefined();
  });
});

describe("geometry.normalizeConnection", () => {
  const a = n("a", 0, 0);
  const b = n("b", 200, 0);
  it("normalizes direction from first to second", () => {
    expect(normalizeConnection("a", "b", [a, b])).toEqual({ fromNodeId: "a", toNodeId: "b" });
  });
  it("rejects self connections and missing nodes", () => {
    expect(normalizeConnection("a", "a", [a, b])).toBeNull();
    expect(normalizeConnection("a", "missing", [a, b])).toBeNull();
  });
  it("rejects group nodes", () => {
    const g = group("g", 0, 0);
    expect(normalizeConnection("a", "g", [a, g])).toBeNull();
    expect(normalizeConnection("g", "a", [g, a])).toBeNull();
  });
});

describe("geometry.anchors and sizes", () => {
  it("anchors on the candidate side opposite to the dragged handle (source drag hits left edge, target drag hits right edge)", () => {
    const node = n("a", 10, 20, 100, 60);
    expect(getConnectionTargetAnchor(node, { nodeId: "a", handleType: "source" })).toEqual({ x: 10, y: 50 });
    expect(getConnectionTargetAnchor(node, { nodeId: "a", handleType: "target" })).toEqual({ x: 110, y: 50 });
  });
  it("fitNodeSize preserves ratio within bounds", () => {
    expect(fitNodeSize(2000, 1000, 640, 640)).toEqual({ width: 640, height: 320 });
    expect(fitNodeSize(100, 100, 640, 640)).toEqual({ width: 100, height: 100 });
  });
  it("nodeSizeFromRatio parses and rejects extreme ratios", () => {
    expect(nodeSizeFromRatio("16:9", 640, 360)).toEqual({ width: 640, height: 360 });
    expect(nodeSizeFromRatio("1x1", 640, 360)).toEqual({ width: 360, height: 360 });
    expect(nodeSizeFromRatio("9:1", 640, 360)).toEqual({ width: 640, height: 360 });
    expect(nodeSizeFromRatio("junk", 640, 360)).toBeNull();
  });
});
