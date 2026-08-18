import { config } from "./config.js";
import { tos, tosConfigured } from "./tos.js";
import { HttpMethodType } from "@volcengine/tos-sdk";

if (!tosConfigured()) throw new Error("TOS 配置不完整，拒绝修改 Bucket 设置");

await tos.putBucketCORS({
  bucket: config.tosBucket,
  CORSRules: [{
    AllowedOrigins: [config.origin],
    AllowedMethods: [HttpMethodType.HttpMethodGet, HttpMethodType.HttpMethodHead, HttpMethodType.HttpMethodPut],
    AllowedHeaders: ["Content-Type", "Content-MD5", "x-tos-*"],
    ExposeHeaders: ["ETag", "x-tos-request-id"],
    MaxAgeSeconds: 3600,
    ResponseVary: true
  }]
});

await tos.putBucketLifecycle({
  bucket: config.tosBucket,
  rules: [
    { ID: "firefly-input-retention", Prefix: "inputs/", Status: "Enabled", Expiration: { Days: config.tosInputRetentionDays } },
    { ID: "firefly-abort-incomplete-multipart", Prefix: "", Status: "Enabled", AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } }
  ]
});

const [cors, lifecycle] = await Promise.all([
  tos.getBucketCORS({ bucket: config.tosBucket }),
  tos.getBucketLifecycle({ bucket: config.tosBucket })
]);

console.info(JSON.stringify({ type: "tos_bucket_configured", corsRules: cors.data.CORSRules.length, lifecycleRules: lifecycle.data.Rules.length }));
