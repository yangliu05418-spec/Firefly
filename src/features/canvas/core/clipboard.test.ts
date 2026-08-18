import { describe, expect, it } from "vitest";
import { copySelection, pasteClipboard } from "./clipboard";
import type { CanvasNode } from "../canvas-types";

const n = (id: string, x: number, y: number, metadata: CanvasNode["metadata"] = {}): CanvasNode => ({ id, type: "text", title: id, position: { x, y }, width: 100, height: 60, metadata });

describe("clipboard", () => {
  it("copySelection keeps only intra-selection connections", () => {
    const nodes = [n("a", 0, 0), n("b", 200, 0), n("c", 400, 0)];
    const connections = [
      { id: "c1", fromNodeId: "a", toNodeId: "b" },
      { id: "c2", fromNodeId: "a", toNodeId: "c" },
      { id: "c3", fromNodeId: "b", toNodeId: "c" },
    ];
    const clipboard = copySelection(nodes, connections, new Set(["a", "b"]))!;
    expect(clipboard.nodes.map((node) => node.id).sort()).toEqual(["a", "b"]);
    expect(clipboard.connections).toEqual([{ id: "c1", fromNodeId: "a", toNodeId: "b" }]);
    expect(clipboard.nodes[0].position).not.toBe(nodes[0].position);
  });

  it("returns null for empty selections", () => {
    expect(copySelection([n("a", 0, 0)], [], new Set())).toBeNull();
  });

  it("pasteClipboard remaps node ids, group ids, and connection endpoints", () => {
    const groupNode = n("g1", 0, 0, { status: "idle" });
    groupNode.type = "group";
    const child = n("a", 50, 50, { groupId: "g1" });
    const other = n("b", 300, 50);
    const clipboard = {
      nodes: [groupNode, child, other],
      connections: [{ id: "c1", fromNodeId: "a", toNodeId: "b" }],
    };
    const { nodes, connections } = pasteClipboard(clipboard, { x: 500, y: 500 });
    const pastedGroup = nodes.find((node) => node.type === "group")!;
    const pastedChild = nodes.find((node) => node.type !== "group" && node.metadata.groupId === pastedGroup.id)!;
    const pastedOther = nodes.find((node) => node.title === "b Copy")!;
    expect(nodes).toHaveLength(3);
    expect(pastedChild).toBeDefined();
    expect(connections[0].fromNodeId).toBe(pastedChild.id);
    expect(connections[0].toNodeId).toBe(pastedOther.id);
    expect(connections[0].id).not.toBe("c1");
  });

  it("pasteClipboard centers the pasted content at the anchor", () => {
    const clipboard = {
      nodes: [
        { ...n("a", 0, 0), width: 100, height: 60 },
        { ...n("b", 100, 60), width: 100, height: 60 },
      ],
      connections: [],
    };
    const { nodes } = pasteClipboard(clipboard, { x: 1000, y: 1000 });
    const centerX = (nodes[0].position.x + nodes[1].position.x + nodes[1].width) / 2;
    const centerY = (nodes[0].position.y + nodes[1].position.y + nodes[1].height) / 2;
    expect(centerX).toBeCloseTo(1000);
    expect(centerY).toBeCloseTo(1000);
  });

  it("appends Copy suffix idempotently", () => {
    const { nodes } = pasteClipboard({ nodes: [n("a", 0, 0)], connections: [] }, { x: 0, y: 0 });
    expect(nodes[0].title).toBe("a Copy");
    const { nodes: again } = pasteClipboard({ nodes: [n("a", 0, 0)], connections: [] }, { x: 0, y: 0 });
    expect(again[0].title).toBe("a Copy");
  });
});
