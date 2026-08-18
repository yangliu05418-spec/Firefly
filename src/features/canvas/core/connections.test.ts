import { describe, expect, it } from "vitest";
import { activeConnectionPathD, connectionPathD, getConnectionDropTarget, getRelatedNodeIds } from "./connections";
import type { CanvasNode } from "../canvas-types";

const n = (id: string, x: number, y: number, w = 100, h = 60, type: CanvasNode["type"] = "text"): CanvasNode => ({ id, type, title: id, position: { x, y }, width: w, height: h, metadata: {} });

describe("connections", () => {
  it("connectionPathD draws a horizontal bezier from right edge to left edge", () => {
    const d = connectionPathD(n("a", 0, 0, 100, 60), n("b", 400, 0, 100, 60));
    expect(d.startsWith("M 100 30 C ")).toBe(true);
    expect(d.endsWith(", 400 30")).toBe(true);
    const distance = 400 - 100;
    expect(d).toContain("C " + (100 + distance * 0.5));
  });

  it("activeConnectionPathD snaps endpoints to the target node", () => {
    const from = n("a", 0, 0, 100, 60);
    const target = n("b", 400, 0, 100, 60);
    const d = activeConnectionPathD(from, { nodeId: "a", handleType: "source" }, { x: 800, y: 500 }, target);
    expect(d!.startsWith("M 100 30 C ")).toBe(true);
    expect(d!.endsWith(", 400 30")).toBe(true);
    expect(activeConnectionPathD(undefined, { nodeId: "a", handleType: "source" }, { x: 0, y: 0 })).toBeNull();
  });

  it("getConnectionDropTarget hits inside the node with highest priority", () => {
    const nodes = [n("a", 0, 0), n("b", 200, 0), n("c", 400, 0)];
    const target = getConnectionDropTarget({ x: 210, y: 30 }, { nodeId: "a", handleType: "source" }, nodes, 1);
    expect(target.nodeId).toBe("b");
    expect(target.isNearNode).toBe(true);
  });

  it("hits the 40px handle radius scaled by zoom", () => {
    const nodes = [n("a", 0, 0, 100, 60), n("b", 200, 0, 100, 60)];
    // b's source anchor: (300, 30); at 2x zoom radius shrinks to 20 world units
    expect(getConnectionDropTarget({ x: 310, y: 30 }, { nodeId: "a", handleType: "source" }, nodes, 2).nodeId).toBe("b");
    expect(getConnectionDropTarget({ x: 330, y: 30 }, { nodeId: "a", handleType: "source" }, nodes, 2).nodeId).toBeNull();
    // inside the 32px expanded region (168..332) the node is still a connectable target
    expect(getConnectionDropTarget({ x: 330, y: 30 }, { nodeId: "a", handleType: "source" }, nodes, 1)).toEqual({ nodeId: "b", isNearNode: true });
    // beyond the expanded region: nothing
    expect(getConnectionDropTarget({ x: 400, y: 30 }, { nodeId: "a", handleType: "source" }, nodes, 1)).toEqual({ nodeId: null, isNearNode: false });
  });

  it("excludes self and invalid targets", () => {
    const nodes = [n("a", 0, 0), n("b", 200, 0)];
    const self = getConnectionDropTarget({ x: 5, y: 5 }, { nodeId: "a", handleType: "source" }, nodes, 1);
    expect(self.nodeId).toBeNull();
    expect(self.isNearNode).toBe(true);
    const group = n("g", 0, 300, 400, 200, "group");
    expect(getConnectionDropTarget({ x: 50, y: 350 }, { nodeId: "a", handleType: "source" }, [...nodes, group], 1).nodeId).toBeNull();
  });

  it("getRelatedNodeIds collects direct neighbors", () => {
    const connections = [
      { id: "c1", fromNodeId: "a", toNodeId: "b" },
      { id: "c2", fromNodeId: "c", toNodeId: "a" },
      { id: "c3", fromNodeId: "b", toNodeId: "d" },
    ];
    expect(getRelatedNodeIds("a", connections)).toEqual(new Set(["b", "c"]));
    expect(getRelatedNodeIds("d", connections)).toEqual(new Set(["b"]));
  });
});
