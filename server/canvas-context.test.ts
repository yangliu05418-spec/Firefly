import { describe, expect, it } from "vitest";
import { DEFAULT_CANVAS_DOCUMENT, type CanvasNodeV2 } from "./canvas-document.js";
import { resolveCanvasContext } from "./canvas-context.js";

const node = (id: string, type: CanvasNodeV2["type"], data: CanvasNodeV2["data"] = {}): CanvasNodeV2 => ({
  id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 220, data,
});

describe("resolveCanvasContext", () => {
  it("uses the saved incoming relations as the generation truth in stable order", () => {
    const document = {
      ...DEFAULT_CANVAS_DOCUMENT,
      nodes: [
        node("text-a", "text", { markdown: "  第一段  " }),
        node("asset-a", "image", { projectAssetId: "asset-1" }),
        node("text-b", "text", { markdown: "第二段" }),
        node("target", "video"),
      ],
      connections: [
        { id: "e1", source: "text-a", target: "target", sourceHandle: "right" as const, targetHandle: "left" as const, relation: "context" as const },
        { id: "duplicate", source: "text-a", target: "target", sourceHandle: "right" as const, targetHandle: "left" as const, relation: "context" as const },
        { id: "e2", source: "asset-a", target: "target", sourceHandle: "right" as const, targetHandle: "left" as const, relation: "context" as const },
        { id: "e3", source: "text-b", target: "target", sourceHandle: "right" as const, targetHandle: "left" as const, relation: "context" as const },
      ],
    };
    expect(resolveCanvasContext(document, "target")).toMatchObject({
      text: "第一段\n\n第二段",
      assetIds: ["asset-1"],
      sources: [{ id: "text-a" }, { id: "asset-a" }, { id: "text-b" }],
    });
  });

  it("returns null for a missing target", () => {
    expect(resolveCanvasContext(DEFAULT_CANVAS_DOCUMENT, "missing")).toBeNull();
  });
});
