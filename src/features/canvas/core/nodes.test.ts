import { describe, expect, it } from "vitest";
import { createCanvasNode, createNodeId, getNodeSpec, NODE_MIN_HEIGHT, NODE_MIN_WIDTH, NODE_SPECS } from "./nodes";

describe("nodes", () => {
  it("creates a node centered on the given position with spec size", () => {
    const node = createCanvasNode("text", { x: 500, y: 300 }, { content: "hi" });
    expect(node.position).toEqual({ x: 500 - 340 / 2, y: 300 - 240 / 2 });
    expect(node.width).toBe(340);
    expect(node.height).toBe(240);
    expect(node.metadata.content).toBe("hi");
    expect(node.metadata.status).toBe("idle");
    expect(node.id.startsWith("text-")).toBe(true);
  });

  it("generates unique prefixed ids", () => {
    expect(createNodeId("image")).toMatch(/^image-[A-Za-z0-9_-]{10}$/);
    expect(createNodeId("image")).not.toBe(createNodeId("image"));
  });

  it("provides specs for all builtin types with minimap colors", () => {
    for (const type of ["text", "image", "video", "audio", "group"] as const) {
      expect(NODE_SPECS[type].width).toBeGreaterThan(0);
      expect(NODE_SPECS[type].height).toBeGreaterThan(0);
    }
    expect(NODE_SPECS.image.minimapColor).toBe("#10b981");
    expect(NODE_SPECS.video.keepAspectRatio).toBe(true);
    expect(getNodeSpec("unknown").title).toBe("文本");
    expect(NODE_MIN_WIDTH).toBe(220);
    expect(NODE_MIN_HEIGHT).toBe(160);
  });
});
