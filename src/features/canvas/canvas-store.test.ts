import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "./canvas-store";
import { defaultCanvasDocument } from "./canvas-types";
import type { CanvasNode } from "./canvas-types";

const n = (id: string, x = 0, y = 0, metadata: CanvasNode["metadata"] = {}): CanvasNode => ({ id, type: "text", title: id, position: { x, y }, width: 100, height: 60, metadata });

describe("canvas store", () => {
  beforeEach(() => {
    useCanvasStore.getState().hydrate(defaultCanvasDocument());
  });

  it("hydrates a document and resets transient state", () => {
    const doc = { ...defaultCanvasDocument(), nodes: [n("a", 10, 10)] };
    useCanvasStore.getState().setSelection(["a"]);
    useCanvasStore.getState().hydrate(doc);
    expect(useCanvasStore.getState().document.nodes).toHaveLength(1);
    expect(useCanvasStore.getState().selection).toEqual([]);
    expect(useCanvasStore.getState().tool).toBe("select");
  });

  it("updates viewport and size without mutating other slices", () => {
    useCanvasStore.getState().setViewport({ x: 10, y: 20, k: 2 });
    useCanvasStore.getState().setViewportSize({ width: 800, height: 600 });
    const state = useCanvasStore.getState();
    expect(state.document.viewport).toEqual({ x: 10, y: 20, k: 2 });
    expect(state.viewportSize).toEqual({ width: 800, height: 600 });
  });

  it("toggles selection and clears connections on selection change", () => {
    useCanvasStore.getState().addNode(n("a"));
    useCanvasStore.getState().addNode(n("b"));
    useCanvasStore.getState().setSelectedConnectionId("c1");
    useCanvasStore.getState().toggleNodeSelection("a", false);
    expect(useCanvasStore.getState().selection).toEqual(["a"]);
    expect(useCanvasStore.getState().selectedConnectionId).toBeNull();
    useCanvasStore.getState().toggleNodeSelection("b", true);
    expect(useCanvasStore.getState().selection).toEqual(["a", "b"]);
    useCanvasStore.getState().toggleNodeSelection("a", true);
    expect(useCanvasStore.getState().selection).toEqual(["b"]);
  });

  it("removes nodes and cascades to their connections", () => {
    useCanvasStore.getState().hydrate({
      ...defaultCanvasDocument(),
      nodes: [n("a"), n("b")],
      connections: [
        { id: "c1", fromNodeId: "a", toNodeId: "b" },
        { id: "c2", fromNodeId: "b", toNodeId: "a" },
      ],
    });
    useCanvasStore.getState().setSelection(["a"]);
    useCanvasStore.getState().removeNodes(new Set(["a"]));
    const state = useCanvasStore.getState();
    expect(state.document.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(state.document.connections).toEqual([]);
    expect(state.selection).toEqual([]);
  });

  it("moves nodes via a position map and applies snapshots immutably", () => {
    useCanvasStore.getState().hydrate({ ...defaultCanvasDocument(), nodes: [n("a"), n("b")] });
    useCanvasStore.getState().moveNodes(new Map([["a", { x: 500, y: 500 }]]));
    const nodes = useCanvasStore.getState().document.nodes;
    expect(nodes.find((node) => node.id === "a")!.position).toEqual({ x: 500, y: 500 });
    expect(nodes.find((node) => node.id === "b")!.position).toEqual({ x: 0, y: 0 });
    useCanvasStore.getState().replaceSnapshot([n("x", 1, 1)], [], "blank");
    const state = useCanvasStore.getState();
    expect(state.document.nodes.map((node) => node.id)).toEqual(["x"]);
    expect(state.document.background).toBe("blank");
    expect(state.document.connections).toEqual([]);
  });
});
