import { describe, expect, it } from "vitest";
import { canvasCenter, clampScale, easeOutCubic, focusNodeTarget, resetViewport, screenToCanvas, setZoomScale, zoomAt, MAX_SCALE, MIN_SCALE } from "./viewport";
import type { CanvasNode } from "../canvas-types";

const viewport = { x: 120, y: -40, k: 1.5 };
const size = { width: 1200, height: 800 };

const node = (overrides: Partial<CanvasNode> = {}): CanvasNode => ({
  id: "n1", type: "text", title: "节点", position: { x: 100, y: 200 }, width: 340, height: 240,
  metadata: { content: "", status: "idle" }, ...overrides,
});

describe("viewport", () => {
  it("screenToCanvas inverts the viewport transform (round trip)", () => {
    const world = screenToCanvas(620, 360, viewport, { left: 20, top: 10 });
    expect(world.x).toBeCloseTo((620 - 20 - 120) / 1.5);
    expect(world.y).toBeCloseTo((360 - 10 + 40) / 1.5);
    const back = { x: world.x * viewport.k + viewport.x + 20, y: world.y * viewport.k + viewport.y + 10 };
    expect(back.x).toBeCloseTo(620);
    expect(back.y).toBeCloseTo(360);
  });

  it("canvasCenter is the world point under the viewport center", () => {
    const center = canvasCenter(viewport, size);
    expect(center.x).toBeCloseTo((600 - 120) / 1.5);
    expect(center.y).toBeCloseTo((400 + 40) / 1.5);
  });

  it("zoomAt keeps the world point under the cursor", () => {
    const mouse = { x: 300, y: 200 };
    const before = screenToCanvas(mouse.x, mouse.y, viewport, { left: 0, top: 0 });
    const next = zoomAt(viewport, mouse.x, mouse.y, 3);
    const after = screenToCanvas(mouse.x, mouse.y, next, { left: 0, top: 0 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(next.k).toBe(3);
  });

  it("clamps zoom to 0.05..5", () => {
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(1.2)).toBe(1.2);
  });

  it("setZoomScale zooms around the viewport center without drift", () => {
    const before = canvasCenter(viewport, size);
    const next = setZoomScale(viewport, 2, size);
    const after = canvasCenter(next, size);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("resetViewport centers the origin at 100%", () => {
    expect(resetViewport(size)).toEqual({ x: 600, y: 400, k: 1 });
  });

  it("focusNodeTarget fits the node with adaptive scale capped at 1", () => {
    const target = focusNodeTarget(node({ width: 340, height: 240 }), size);
    expect(target.k).toBeCloseTo(Math.min((1200 * 0.6) / 340, (800 * 0.6) / 240, 1));
    const worldX = node().position.x + node().width / 2;
    const worldY = node().position.y + node().height / 2;
    expect(target.x).toBeCloseTo(600 - worldX * target.k);
    expect(target.y).toBeCloseTo(400 - worldY * target.k);
  });

  it("easeOutCubic animates from 0 to 1", () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
  });
});
