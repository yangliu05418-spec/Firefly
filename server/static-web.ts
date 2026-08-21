import path from "node:path";
import type { RequestHandler } from "express";

/** The worker bootstrap must always be revalidated even though hashed app assets are immutable. */
export const createServiceWorkerHandler = (webDir: string): RequestHandler => (_req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Service-Worker-Allowed", "/");
  res.sendFile(path.join(webDir, "firefly-media-sw.js"));
};
