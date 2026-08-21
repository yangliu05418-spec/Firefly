import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createServiceWorkerHandler } from "./static-web.js";

const temporaryDirectories: string[] = [];
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("service worker delivery", () => {
  it("requires revalidation instead of inheriting the immutable asset policy", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "firefly-static-"));
    temporaryDirectories.push(directory);
    await fs.writeFile(path.join(directory, "firefly-media-sw.js"), "self.skipWaiting();");
    const app = express();
    app.get("/firefly-media-sw.js", createServiceWorkerHandler(directory));
    app.use(express.static(directory, { maxAge: "1y", immutable: true }));
    const server = app.listen(0, "127.0.0.1");
    try {
      await new Promise<void>((resolve) => server.once("listening", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("test server did not expose a port");
      const response = await fetch(`http://127.0.0.1:${address.port}/firefly-media-sw.js`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(response.headers.get("service-worker-allowed")).toBe("/");
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
});
