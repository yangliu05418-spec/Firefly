import { config } from "./config.js";
import { AUTO_REFERENCE_GROUP_TYPE, callAssetApi } from "./asset-api.js";

const video = await fetch("https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks?page_size=1", { headers: { Authorization: `Bearer ${config.apiKey}` } });
console.log(`VIDEO_API ${video.status} ${video.ok ? "ok" : "failed"}`);
try {
  const result = await callAssetApi<{ Items?: unknown[] }>("ListAssetGroups", { Filter: { GroupType: AUTO_REFERENCE_GROUP_TYPE }, PageNumber: 1, PageSize: 1 });
  console.log(`ASSET_API ok ${result.Items?.length ?? 0}`);
} catch (error) {
  console.log(`ASSET_API failed ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
}
