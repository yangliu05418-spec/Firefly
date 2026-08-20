import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { CanvasProjectAsset } from "./db.js";
import { createCanvasProjectMediaHandler } from "./canvas-project-assets.js";

const now = Date.now();
const asset = (status: CanvasProjectAsset["status"], ownerId = "owner-1"): CanvasProjectAsset => ({ id: "project-asset-1", ownerId, canvasId: "canvas-1", kind: "video", sourceType: "generation", sourceId: "task-1", title: "镜头", contentType: "video/mp4", size: 42, status, createdAt: now, updatedAt: now });

describe("GET /api/canvas-project-assets/:id/media", () => {
  const servers: ReturnType<express.Express["listen"]>[] = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))));
  const request = async (stored: CanvasProjectAsset | null, userId = "owner-1", canvasOwner = "owner-1", download = false) => {
    const app = express();
    app.use((_req, res, next) => { res.locals.user = { id: userId }; next(); });
    app.get("/api/canvas-project-assets/:id/media", createCanvasProjectMediaHandler({
      readAsset: () => stored,
      canAccessCanvas: (_canvasId, requester) => requester === canvasOwner,
      signedUrl: (_asset, attachment) => `https://tos.example/video.mp4?download=${attachment ? 1 : 0}`,
      cacheControl: "private, max-age=60",
    }));
    const server = app.listen(0, "127.0.0.1"); servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}/api/canvas-project-assets/project-asset-1/media${download ? "?download=1" : ""}`, { redirect: "manual" });
  };

  it("redirects owned ready previews and downloads independently", async () => {
    expect((await request(asset("ready"))).headers.get("location")).toContain("download=0");
    expect((await request(asset("ready"), "owner-1", "owner-1", true)).headers.get("location")).toContain("download=1");
  });

  it("hides missing, cross-user and cross-canvas assets", async () => {
    expect((await request(null)).status).toBe(404);
    expect((await request(asset("ready", "owner-2"))).status).toBe(404);
    expect((await request(asset("ready"), "owner-1", "owner-2")).status).toBe(404);
  });

  it("distinguishes copying and failed owned assets without exposing them cross-user", async () => {
    expect((await request(asset("copying"))).status).toBe(425);
    expect((await request(asset("failed"))).status).toBe(409);
    expect((await request(asset("copying"), "owner-2")).status).toBe(404);
  });
});
