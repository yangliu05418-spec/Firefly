import { describe, expect, it } from "vitest";
import {
  canvasNodeForPersistence,
  defaultCanvasDocumentV2,
  recoverInterruptedCanvasNode,
  toCanvasDocumentV2,
  type CanvasNodeV2,
} from "./canvas-v2-types";

const mediaNode = (data: CanvasNodeV2["data"]): CanvasNodeV2 => ({
  id: "node-1",
  type: "image",
  title: "reference.png",
  position: { x: 0, y: 0 },
  width: 320,
  height: 300,
  data,
});

describe("Canvas V2 interrupted browser upload recovery", () => {
  it("does not persist a local upload spinner that cannot resume after navigation", () => {
    expect(canvasNodeForPersistence(mediaNode({ status: "running", mimeType: "image/png" }))).toMatchObject({
      data: { status: "idle", mimeType: "image/png" },
    });
  });

  it("turns an orphaned spinner from an older document into an actionable failure", () => {
    const document = { ...defaultCanvasDocumentV2(), nodes: [mediaNode({ status: "running" })] };
    expect(toCanvasDocumentV2(document).nodes[0]?.data).toMatchObject({
      status: "failed",
      error: "上次本地素材保存未完成，请重新选择素材",
    });
  });

  it("preserves resumable provider jobs and durable project-asset copies", () => {
    const providerJob = mediaNode({ status: "running", jobId: "job-1" });
    const projectCopy = mediaNode({ status: "running", projectAssetId: "asset-1" });
    expect(recoverInterruptedCanvasNode(providerJob)).toBe(providerJob);
    expect(recoverInterruptedCanvasNode(projectCopy)).toBe(projectCopy);
    expect(canvasNodeForPersistence(providerJob)).toBe(providerJob);
    expect(canvasNodeForPersistence(projectCopy)).toBe(projectCopy);
  });
});
