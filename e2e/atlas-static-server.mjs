import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 4174;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../apps/atlas/dist");
const atlasPrefix = "/studio/atlas";
const atlasCsp = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https://*.bytepluses.com.cn";

const mimeByExtension = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webp", "image/webp"],
]);

function setAtlasHeaders(response) {
  response.setHeader("Content-Security-Policy", atlasCsp);
  response.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Origin-Agent-Cluster", "?1");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

async function existingFile(candidate) {
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  try {
    await access(resolved);
    return (await stat(resolved)).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

async function serve(request, response) {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/__ready") {
    response.writeHead(204).end();
    return;
  }
  if (url.pathname !== atlasPrefix && !url.pathname.startsWith(`${atlasPrefix}/`)) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }

  setAtlasHeaders(response);
  const relativePath = decodeURIComponent(url.pathname.slice(atlasPrefix.length)).replace(/^\/+/, "");
  const asset = relativePath && relativePath !== "index.html"
    ? await existingFile(path.join(root, relativePath))
    : null;
  const file = asset ?? path.join(root, "index.html");
  response.setHeader("Cache-Control", asset ? "public, max-age=31536000, immutable" : "no-cache");
  response.setHeader("Content-Type", mimeByExtension.get(path.extname(file).toLowerCase()) ?? "application/octet-stream");
  const fileStat = await stat(file);
  response.setHeader("Content-Length", fileStat.size);
  if (request.method === "HEAD") {
    response.writeHead(200).end();
    return;
  }
  response.writeHead(200);
  createReadStream(file).pipe(response);
}

const server = http.createServer((request, response) => {
  void serve(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Internal server error");
  });
});

server.listen(port, host, () => console.info(`Atlas E2E server listening on http://${host}:${port}${atlasPrefix}/`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
