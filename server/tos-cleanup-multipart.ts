import { config } from "./config.js";
import { tos, tosConfigured } from "./tos.js";

const main = async () => {
  if (!tosConfigured()) throw new Error("TOS 配置不完整，拒绝清理 Multipart");
  const prefix = process.env.TOS_CLEANUP_PREFIX ?? "";
  if (!prefix.startsWith("previews/") && !prefix.startsWith("posters/")) throw new Error("仅允许清理预览或海报前缀的未完成 Multipart");
  let cleaned = 0;
  let skipped = 0;
  const errors: { key: string; code: string; requestId?: string }[] = [];
  const response = await tos.listMultipartUploads({ bucket: config.tosBucket, maxUploads: 1000 });
  for (const upload of (response.data.Uploads ?? []).filter((item) => item.Key.startsWith(prefix))) {
      try {
        await tos.abortMultipartUpload({ bucket: config.tosBucket, key: upload.Key, uploadId: upload.UploadId });
        cleaned += 1;
      } catch (error) {
        const code = String((error as { code?: string }).code ?? "unknown");
        if (["NoSuchUpload", "UploadStatusNotUploading", "UploadStatusMismatch"].includes(code)) skipped += 1;
        else errors.push({ key: upload.Key, code, requestId: (error as { requestId?: string }).requestId });
      }
  }
  if (response.data.IsTruncated) throw new Error("未完成 Multipart 超过 1000 条，拒绝不完整清理");
  console.info(JSON.stringify({ type: "tos_incomplete_multipart_cleaned", prefix, cleaned, skipped, errors }));
};

try { await main(); }
catch (error) {
  const details = error as { code?: string; statusCode?: number; message?: string; requestId?: string };
  console.error(JSON.stringify({ type: "tos_incomplete_multipart_cleanup_failed", code: details.code ?? "unknown", statusCode: details.statusCode, message: details.message ?? String(error), requestId: details.requestId }));
  process.exitCode = 1;
}
