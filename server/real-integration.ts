import crypto from "node:crypto";
import { AssetApiError, callAssetApi } from "./asset-api.js";
import { config } from "./config.js";
import { downloadImageBuffer, generateSingleImage, openRouterPool } from "./openrouter.js";
import { deleteObject, putObjectBuffer, signedObjectUrl, tos, tosConfigured } from "./tos.js";

const target = process.argv[2];
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const stamp = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const tosRoundTrip = async () => {
  if (!tosConfigured()) throw new Error("TOS integration credentials are not configured");
  const key = `integration/${stamp}/range.png`;
  try {
    const stored = await putObjectBuffer(key, png, "image/png");
    const head = await tos.headObject({ bucket: config.tosBucket, key });
    const range = await tos.getObjectV2({ bucket: config.tosBucket, key, dataType: "buffer", range: "bytes=0-0" });
    if (range.statusCode !== 206 || range.data.content.length !== 1) throw new Error("TOS Range verification did not return one byte with HTTP 206");
    console.info(JSON.stringify({ ok: true, target: "tos", bytes: stored.size, etagPresent: Boolean(stored.etag), headStatus: head.statusCode, rangeStatus: range.statusCode }));
  } finally { await deleteObject(key).catch(() => undefined); }
};

type ProviderAsset = { Id: string; Name?: string; Status?: string };
const exactAssetByName = async (groupId: string, name: string) => {
  const result = await callAssetApi<{ Items?: ProviderAsset[] }>("ListAssets", { GroupId: groupId, Name: name, PageNumber: 1, PageSize: 100 });
  return (result.Items ?? []).find((asset) => asset.Name === name) ?? null;
};

const bytePlusAssetRoundTrip = async () => {
  if (!tosConfigured()) throw new Error("TOS integration credentials are not configured");
  const groupId = (process.env.INTEGRATION_ASSET_GROUP_ID ?? "").trim();
  if (!groupId) throw new Error("INTEGRATION_ASSET_GROUP_ID is required");
  const key = `integration/${stamp}/asset.png`;
  const name = `firefly-ci-${stamp}`;
  let assetId: string | undefined;
  try {
    await putObjectBuffer(key, png, "image/png");
    const url = signedObjectUrl(key, { expires: 3600, fileName: "asset.png" });
    try {
      assetId = (await callAssetApi<{ Id: string }>("CreateAsset", { GroupId: groupId, URL: url, AssetType: "Image", Name: name })).Id;
    } catch (error) {
      if (!(error instanceof AssetApiError) || !error.resultUnknown) throw error;
      assetId = (await exactAssetByName(groupId, name))?.Id;
      if (!assetId) throw error;
    }
    let status = "";
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const asset = await callAssetApi<ProviderAsset>("GetAsset", { Id: assetId });
      status = asset.Status ?? "";
      if (status === "Active") break;
      if (status === "Failed") throw new Error("BytePlus integration asset processing failed");
      await sleep(5000);
    }
    if (status !== "Active") throw new Error("BytePlus integration asset did not become Active within 120 seconds");
    console.info(JSON.stringify({ ok: true, target: "byteplus-asset", assetId, status }));
  } finally {
    let cleanupError: unknown;
    if (assetId) await callAssetApi("DeleteAsset", { Id: assetId }).catch((error) => { cleanupError = error; console.error(JSON.stringify({ type: "integration_cleanup_failed", target: "byteplus-asset", assetId, error: error instanceof Error ? error.message : String(error) })); });
    await deleteObject(key).catch(() => undefined);
    if (cleanupError) throw cleanupError;
  }
};

const openRouterRoundTrip = async () => {
  if (!openRouterPool().size) throw new Error("OPENROUTER_API_KEYS is required");
  const model = process.env.INTEGRATION_OPENROUTER_MODEL ?? "google/gemini-3.1-flash-lite-image";
  const url = await generateSingleImage({ model, prompt: "A single warm firefly on a matte black field. No text.", references: [], size: "512x512" });
  const image = await downloadImageBuffer(url);
  console.info(JSON.stringify({ ok: true, target: "openrouter", model, bytes: image.buffer.length, contentType: image.contentType }));
};

if (target === "tos") await tosRoundTrip();
else if (target === "byteplus-asset") await bytePlusAssetRoundTrip();
else if (target === "openrouter") await openRouterRoundTrip();
else throw new Error("target must be tos, byteplus-asset or openrouter");
