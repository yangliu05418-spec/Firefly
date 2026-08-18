import { describe, expect, it } from "vitest";
import { applyDragPositions, buildDragSession, dragOffset, isDragThresholdExceeded, resolveDragDrop } from "./interactions";
import type { CanvasNode } from "../canvas-types";

const n = (id: string, x: number, y: number, w = 100, h = 60, type: CanvasNode["type"] = "text", metadata: CanvasNode["metadata"] = {}): CanvasNode => ({ id, type, title: id, position: { x, y }, width: w, height: h, metadata });

describe("interactions.buildDragSession", () => {
  it("includes group children in the drag set", () => {
    const group = n("g1", 0, 0, 300, 200, "group");
    const child = n("c1", 50, 50, 100, 60, "text", { groupId: "g1" });
    const other = n("o1", 500, 500);
    const session = buildDragSession(new Set(["g1"]), [group, child, other], 10, 10)!;
    expect([...session.dragIds].sort()).toEqual(["c1", "g1"]);
    expect(session.initialPositions.get("c1")).toEqual({ x: 50, y: 50 });
    expect(session.initialPositions.has("o1")).toBe(false);
  });

  it("returns null for empty selections", () => {
    expect(buildDragSession(new Set(), [], 0, 0)).toBeNull();
  });

  it("copies initial positions (no aliasing)", () => {
    const a = n("a", 1, 2);
    const session = buildDragSession(new Set(["a"]), [a], 0, 0)!;
    session.initialPositions.set("a", { x: 99, y: 99 });
    expect(a.position).toEqual({ x: 1, y: 2 });
  });
});

describe("interactions.drag threshold and offset", () => {
  it("uses a 3px threshold", () => {
    const session = buildDragSession(new Set(["a"]), [n("a", 0, 0)], 0, 0)!;
    expect(isDragThresholdExceeded(session, 2, 2)).toBe(false);
    expect(isDragThresholdExceeded(session, 4, 0)).toBe(true);
  });

  it("converts client delta to world delta by scale", () => {
    const session = buildDragSession(new Set(["a"]), [n("a", 0, 0)], 10, 10)!;
    expect(dragOffset(session, 20, 30, 2)).toEqual({ dx: 5, dy: 10 });
  });
});

describe("interactions.applyDragPositions and resolveDragDrop", () => {
  it("applies the offset only to dragged nodes", () => {
    const a = n("a", 10, 10);
    const b = n("b", 100, 100);
    const session = buildDragSession(new Set(["a"]), [a, b], 0, 0)!;
    const moved = applyDragPositions([a, b], session.initialPositions, 5, -5);
    expect(moved[0].position).toEqual({ x: 15, y: 5 });
    expect(moved[1].position).toEqual({ x: 100, y: 100 });
  });

  it("snaps into a group on release and records membership", () => {
    const group = n("g1", 0, 0, 300, 200, "group");
    const a = n("a", 40, 30);
    const session = buildDragSession(new Set(["a"]), [group, a], 0, 0)!;
    // 拖入分组内（中心 90,60 在组内）
    const result = resolveDragDrop([group, a], new Set(["a"]), session.initialPositions, 0, 0);
    expect(result.dropTargetGroupId).toBe("g1");
    expect(result.nodes.find((node) => node.id === "a")!.metadata.groupId).toBe("g1");
  });

  it("updates containing group when dragged between groups", () => {
    const g1 = n("g1", 0, 0, 200, 200, "group");
    const g2 = n("g2", 300, 0, 200, 200, "group");
    const a = n("a", 50, 50, 100, 60, "text", { groupId: "g1" });
    const session = buildDragSession(new Set(["a"]), [g1, g2, a], 0, 0)!;
    // 把 a 拖到 g2 中心（初始 50,50 → +300,+50 → 350,100 中心 400,130 在 g2 内）
    const result = resolveDragDrop([g1, g2, a], new Set(["a"]), session.initialPositions, 300, 50);
    const movedA = result.nodes.find((node) => node.id === "a")!;
    expect(movedA.metadata.groupId).toBe("g2");
    expect(movedA.position).toEqual({ x: 350, y: 100 });
  });

  it("clears group membership when dragged outside all groups", () => {
    const g1 = n("g1", 0, 0, 200, 200, "group");
    const a = n("a", 50, 50, 100, 60, "text", { groupId: "g1" });
    const session = buildDragSession(new Set(["a"]), [g1, a], 0, 0)!;
    const result = resolveDragDrop([g1, a], new Set(["a"]), session.initialPositions, 600, 600);
    const movedA = result.nodes.find((node) => node.id === "a")!;
    expect(movedA.metadata.groupId).toBeUndefined();
    expect(result.dropTargetGroupId).toBeNull();
  });
});
