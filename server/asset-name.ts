import crypto from "node:crypto";

/** Keep the user-facing prefix while making one upload uniquely reconcilable at the provider. */
export const providerAssetName = (name: string, uploadId?: string) => {
  const suffix = uploadId ? `--ff-${crypto.createHash("sha256").update(uploadId).digest("hex").slice(0, 16)}` : "";
  return `${Array.from(name.normalize("NFKC")).slice(0, 64 - suffix.length).join("")}${suffix}`;
};
