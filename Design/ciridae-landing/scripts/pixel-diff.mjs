// QA helper: pixel-diff two screenshots (original vs clone).
// Usage: node scripts/pixel-diff.mjs <orig.png> <clone.png> [diff.png]
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const [, , origPath, clonePath, diffPath] = process.argv;

const orig = PNG.sync.read(readFileSync(origPath));
const clone = PNG.sync.read(readFileSync(clonePath));

const width = Math.min(orig.width, clone.width);
const height = Math.min(orig.height, clone.height);

const diff = new PNG({ width, height });
const mismatched = pixelmatch(
  orig.data,
  clone.data,
  diff.data,
  width,
  height,
  { threshold: 0.1 },
);

const total = width * height;
console.log(
  JSON.stringify({
    orig: `${orig.width}x${orig.height}`,
    clone: `${clone.width}x${clone.height}`,
    compared: `${width}x${height}`,
    mismatchedPixels: mismatched,
    mismatchPercent: Number(((mismatched / total) * 100).toFixed(2)),
  }),
);

if (diffPath) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(diffPath, PNG.sync.write(diff));
}
