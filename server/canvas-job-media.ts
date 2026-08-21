import crypto from "node:crypto";

const digest = (jobId: string) => crypto.createHash("sha256").update(jobId).digest("hex").slice(0, 32);

export const canvasGeneratedMediaId = (jobId: string) => `gen-canvas-${digest(jobId)}`;
export const canvasGeneratedAssetId = (jobId: string) => `canvas-project-asset-${digest(jobId)}`;
