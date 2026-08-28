import crypto from "node:crypto";
import { config } from "./config.js";
import { listAllUploadedParts, tos, tosConfigured } from "./tos.js";

if (!tosConfigured()) throw new Error("TOS 配置不完整，无法执行 Multipart 续传权限探测");

const key = `health/multipart-resume-canary/${crypto.randomUUID()}`;
let uploadId = "";
try {
  const created = await tos.createMultipartUpload({
    bucket: config.tosBucket,
    key,
    contentType: "application/octet-stream",
    forbidOverwrite: true,
  });
  uploadId = created.data.UploadId;
  const listed = await listAllUploadedParts(key, uploadId);
  console.info(JSON.stringify({
    ok: true,
    type: "tos_multipart_resume_canary",
    at: new Date().toISOString(),
    listParts: true,
    partCount: listed.length,
  }));
} catch (error) {
  const failure = error as { code?: string; statusCode?: number; requestId?: string };
  console.error(JSON.stringify({
    ok: false,
    type: "tos_multipart_resume_canary",
    at: new Date().toISOString(),
    listParts: false,
    code: failure.code ?? "TOS_RESUME_CANARY_FAILED",
    statusCode: failure.statusCode,
    requestId: failure.requestId,
  }));
  process.exitCode = 1;
} finally {
  if (uploadId) await tos.abortMultipartUpload({ bucket: config.tosBucket, key, uploadId }).catch(() => undefined);
}
