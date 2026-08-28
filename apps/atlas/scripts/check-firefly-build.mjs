import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/', import.meta.url));
const assetsDir = fileURLToPath(new URL('../dist/assets/', import.meta.url));

if (!existsSync(distDir) || !existsSync(assetsDir)) {
  throw new Error('Atlas Firefly build output is missing. Run the Firefly build first.');
}

const forbiddenAssetPatterns = [
  /AdminPage/i,
  /audioIntelligence\.worker/i,
  /Billing/i,
  /clipTranscriber/i,
  /CreditClaim/i,
  /faceAnalysisWorker/i,
  /FlashBoard/i,
  /NativeHelper/i,
  /ort-wasm/i,
  /sam2Worker/i,
  /sceneCutAnalysisWorker/i,
  /stemSeparationWorker/i,
  /transcriptionWorker/i,
];

const assets = readdirSync(assetsDir);
const forbiddenAssets = assets.filter((name) => forbiddenAssetPatterns.some((pattern) => pattern.test(name)));
if (forbiddenAssets.length > 0) {
  throw new Error(`Firefly Atlas contains disabled local-AI assets: ${forbiddenAssets.join(', ')}`);
}

const requiredRuntimeAssets = [
  /^FireflyEmbeddedEditor-.*\.js$/,
  /^projectLifecycle-.*\.js$/,
  /^timelineClipCanvas\.worker-.*\.js$/,
  /^ExportPanel-.*\.js$/,
];
for (const pattern of requiredRuntimeAssets) {
  if (!assets.some((name) => pattern.test(name))) {
    throw new Error(`Firefly Atlas runtime asset is missing: ${pattern}`);
  }
}

const html = readFileSync(join(distDir, 'index.html'), 'utf8');
if (!html.includes('/studio/atlas/')) {
  throw new Error('Atlas index was not built for the /studio/atlas/ base path.');
}

console.log(JSON.stringify({
  assetCount: assets.length,
  disabledLocalAiAssets: 0,
  basePath: '/studio/atlas/',
}, null, 2));
