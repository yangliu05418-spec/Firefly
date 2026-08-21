import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { CanvasAsset } from "./db.js";
import { createCanvasMediaHandler } from "./canvas-media-route.js";

const now = Date.now();
const asset = (status: CanvasAsset["status"], ownerId = "owner-1"): CanvasAsset => ({
  id: "asset-1", ownerId, canvasId: "canvas-1", objectKey: "canvas/asset-1/image.png",
  fileName: "image.png", contentType: "image/png", size: 100, etag: "etag", status,
  createdAt: now, updatedAt: now
});

describe("GET /api/canvas-media/:assetId", () => {
  const servers: ReturnType<express.Express["listen"]>[] = [];
  afterEach(async () => Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())))));

  const request = async (stored: CanvasAsset | null, userId = "owner-1") => {
    const app = express();
    app.use((_req, res, next) => { res.locals.user = { id: userId }; next(); });
    app.get("/api/canvas-media/:assetId", createCanvasMediaHandler({
      readCanvasAsset: (id) => id === "asset-1" ? stored : null,
      signedObjectUrl: (key) => `https://tos.example/${key}?signed=yes`,
      cacheControl: "private, max-age=60"
    }));
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    return fetch(`http://127.0.0.1:${port}/api/canvas-media/asset-1`, { redirect: "manual" });
  };

  it("redirects a ready asset owned by the current user", async () => {
    const response = await request(asset("ready"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://tos.example/canvas/asset-1/image.png?signed=yes");
    expect(response.headers.get("cache-control")).toBe("private, max-age=60");
  });

  it("supports asynchronous stable URL resolution", async () => {
    const app = express();
    app.use((_req, res, next) => { res.locals.user = { id: "owner-1" }; next(); });
    app.get("/api/canvas-media/:assetId", createCanvasMediaHandler({
      readCanvasAsset: () => asset("ready"),
      signedObjectUrl: async () => "https://tos.example/stable-image.png",
      cacheControl: "private, max-age=60"
    }));
    const server = app.listen(0, "127.0.0.1");
    servers.push(server);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/canvas-media/asset-1`, { redirect: "manual" });
    expect(response.headers.get("location")).toBe("https://tos.example/stable-image.png");
  });

  it("returns 404 for a missing or cross-user asset", async () => {
    expect((await request(null)).status).toBe(404);
    expect((await request(asset("ready", "owner-2"))).status).toBe(404);
  });

  it.each(["copying", "failed"] as const)("returns 425 while an asset is %s", async (status) => {
    expect((await request(asset(status))).status).toBe(425);
  });
});
