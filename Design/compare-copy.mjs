// Compare file inventories between template repo and standalone landing copy.
import { readdirSync } from "node:fs";
import path from "node:path";

function list(dir, excl) {
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (excl.has(e.name)) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p.slice(dir.length).split(path.sep).join("/"));
    }
  })(dir);
  return out.sort();
}

const EXCL = new Set([
  "node_modules", ".next", ".git", ".claude", ".cline", ".codex", ".cursor",
  ".gemini", ".kiro", ".opencode", ".roo", ".windsurf", ".playwright-mcp",
  ".amazonq", ".augment", ".continue", ".github",
]);
const SKIP_TOP = [
  ".aider.conf.yml", ".clinerules", ".windsurfrules", "AGENTS.md",
  "CONTRIBUTING.md", "Dockerfile", "Dockerfile.dev", ".dockerignore",
];

const src = list("ai-website-cloner-template", EXCL);
const dst = list("ciridae-landing", EXCL);
const dstSet = new Set(dst);
const missing = src.filter(
  (f) => !dstSet.has(f) && !SKIP_TOP.some((x) => f.split("/")[0] === x),
);
const extra = dst.filter((f) => !src.includes(f));

console.log("template files:", src.length, "| landing files:", dst.length);
console.log("missing in landing:", missing.length);
missing.slice(0, 30).forEach((f) => console.log("  MISSING:", f));
console.log("extra in landing (expected: new CLAUDE.md):", extra.length);
extra.forEach((f) => console.log("  EXTRA:", f));
