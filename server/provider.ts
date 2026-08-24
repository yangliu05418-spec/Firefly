import { z } from "zod";
import { config } from "./config.js";
import { getModel } from "./capabilities.js";
import { containsInternalPromptMarker } from "./creation-snapshots.js";
import { assertPromptLength, EDITOR_PROMPT_STORAGE_MAX_CHARS, VIDEO_PROVIDER_PROMPT_MAX_CHARS } from "./prompt-policy.js";

export const GenerationSchema = z.object({
  prompt: z.string().trim().default(""),
  editorPrompt: z.string().optional(),
  model: z.string(),
  mode: z.enum(["omni", "first_frame", "first_last", "edit", "extend", "text"]),
  ratio: z.string(),
  resolution: z.string(),
  duration: z.number().int(),
  generateAudio: z.boolean().default(true),
  seed: z.number().int().min(-1).max(2147483647).default(-1),
  cameraFixed: z.boolean().default(false),
  watermark: z.boolean().default(false),
  outputFormat: z.enum(["mp4", "mov"]).default("mp4"),
  assets: z.array(z.object({
    id: z.string(),
    bindingId: z.string().min(1).max(200).optional(),
    type: z.enum(["image", "video", "audio"]),
    role: z.enum(["reference_image", "reference_video", "reference_audio", "first_frame", "last_frame"]),
    url: z.string().url().optional(),
    uploadId: z.string().min(20).max(100).optional(),
    assetId: z.string().regex(/^asset-/).optional(),
    canvasProjectAssetId: z.string().min(1).max(180).optional(),
    snapshotReferenceId: z.string().min(32).max(128).optional(),
    name: z.string()
  })
    .refine((asset) => Boolean(asset.url || asset.uploadId || asset.assetId || asset.canvasProjectAssetId || asset.snapshotReferenceId), "素材缺少可用地址")
    .refine((asset) => asset.type === "image"
      ? ["reference_image", "first_frame", "last_frame"].includes(asset.role)
      : asset.role === `reference_${asset.type}`, "素材类型与引用角色不一致"))
  .default([])
});
export type GenerationInput = z.infer<typeof GenerationSchema>;

export const validateGeneration = (input: unknown) => {
  const parsed = GenerationSchema.parse(input);
  assertPromptLength(parsed.prompt, "prompt", VIDEO_PROVIDER_PROMPT_MAX_CHARS);
  if (parsed.editorPrompt !== undefined) assertPromptLength(parsed.editorPrompt, "editorPrompt", EDITOR_PROMPT_STORAGE_MAX_CHARS);
  const model = getModel(parsed.model);
  if (!model) throw new Error("未找到所选模型");
  if (!model.modes.includes(parsed.mode)) throw new Error("当前模型不支持此创作模式");
  const isSeedance25 = model.id === "dreamina-seedance-2-5-260628";
  const normalized = isSeedance25
    ? {
        ...parsed,
        ratio: (["first_frame", "first_last", "edit", "extend"] as string[]).includes(parsed.mode) ? "adaptive" : parsed.ratio,
        duration: parsed.mode === "edit" ? -1 : parsed.duration,
      }
    : parsed;
  if (!model.ratios.includes(normalized.ratio)) throw new Error("当前模型不支持此画幅");
  if (!model.resolutions.includes(parsed.resolution)) throw new Error("当前模型不支持此清晰度");
  if (!model.outputFormats.includes(parsed.outputFormat)) throw new Error("当前模型不支持此输出格式");
  if (parsed.generateAudio && !model.supportsAudio) throw new Error("当前模型不支持生成音频");
  const autoDuration = isSeedance25 && normalized.mode === "edit" && normalized.duration === -1;
  if (!autoDuration && (normalized.duration < model.duration[0] || normalized.duration > model.duration[1])) throw new Error(`时长需在 ${model.duration[0]}–${model.duration[1]} 秒之间`);
  const counts = { image: 0, video: 0, audio: 0 };
  parsed.assets.forEach((asset) => counts[asset.type]++);
  if (counts.image > model.imageLimit || counts.video > model.videoLimit || counts.audio > model.audioLimit) throw new Error("参考素材数量超过当前模型限制");
  const referenceRoles = new Set(["reference_image", "reference_video", "reference_audio"]);
  const hasOnlyReferenceRoles = parsed.assets.every((asset) => referenceRoles.has(asset.role));
  if (parsed.mode === "text") {
    if (!parsed.prompt) throw new Error("文本生成需要提示词");
    if (parsed.assets.length) throw new Error("文本生成不接受参考素材");
  }
  if (parsed.mode === "first_frame") {
    if (parsed.assets.length !== 1 || parsed.assets[0]?.type !== "image" || parsed.assets[0]?.role !== "first_frame") throw new Error("首帧模式只接受一张首帧图片");
  }
  if (parsed.mode === "first_last") {
    const first = parsed.assets.filter((asset) => asset.type === "image" && asset.role === "first_frame");
    const last = parsed.assets.filter((asset) => asset.type === "image" && asset.role === "last_frame");
    if (parsed.assets.length !== 2 || first.length !== 1 || last.length !== 1) throw new Error("首尾帧模式需要且只接受一张首帧和一张尾帧图片");
  }
  if (parsed.mode === "omni") {
    if (!parsed.assets.length || !hasOnlyReferenceRoles) throw new Error("全能参考模式需要至少一个参考素材");
    if (!model.audioOnly && !counts.image && !counts.video) throw new Error("当前模型不支持仅使用音频生成");
  }
  if (parsed.mode === "edit" || parsed.mode === "extend") {
    if (!parsed.prompt) throw new Error(`${parsed.mode === "edit" ? "视频编辑" : "视频续写"}需要明确的提示词`);
    if (!counts.video || !hasOnlyReferenceRoles) throw new Error(`${parsed.mode === "edit" ? "视频编辑" : "视频续写"}需要至少一个参考视频`);
  }
  return normalized;
};

const endpoint = "https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks";
const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` });

export type ProviderErrorCode = "CONTENT_POLICY_REJECTED" | "PROVIDER_INVALID_PARAMETERS" | "PROVIDER_MODEL_UNAVAILABLE" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "PROVIDER_NETWORK_ERROR" | "REFERENCE_ASSET_REJECTED" | "PROVIDER_UNKNOWN_ERROR";
export type ProviderStage = "submit" | "query";

export const classifyProviderError = (message: string, status: number | "network", providerCode = "") => {
  const fingerprint = `${providerCode} ${message}`.toLowerCase();
  if (/task.?type|omni_reference_task_type|ratio.*adaptive|duration.*-1/i.test(fingerprint)) return { errorCode: "PROVIDER_INVALID_PARAMETERS" as const, publicMessage: "当前指令更像视频编辑，请切换到视频编辑模式", retryable: false };
  if (/real person|portrait|reference.*(?:reject|invalid)|asset.*(?:reject|invalid)/i.test(fingerprint)) return { errorCode: "REFERENCE_ASSET_REJECTED" as const, publicMessage: "参考素材未通过模型校验，请更换素材或完成真人资产认证", retryable: false };
  if (/content|safety|policy|moderation|risk|sensitive/i.test(fingerprint)) return { errorCode: "CONTENT_POLICY_REJECTED" as const, publicMessage: "内容未通过安全审核，请调整提示词或参考素材后重试", retryable: false };
  if (/model.*(?:not|unavailable|permission|activate|access)|not.*activated|unauthorized model/i.test(fingerprint)) return { errorCode: "PROVIDER_MODEL_UNAVAILABLE" as const, publicMessage: "当前模型暂不可用或尚未开通，请联系管理员", retryable: false };
  if (status === 429 || /rate.?limit|too many requests/i.test(fingerprint)) return { errorCode: "PROVIDER_RATE_LIMITED" as const, publicMessage: "模型服务繁忙，请稍后重试", retryable: true };
  if (status === "network") {
    const timedOut = /timeout|timed out|超时/i.test(fingerprint);
    return timedOut
      ? { errorCode: "PROVIDER_TIMEOUT" as const, publicMessage: "模型服务响应超时，请稍后重试", retryable: true }
      : { errorCode: "PROVIDER_NETWORK_ERROR" as const, publicMessage: "模型服务网络暂时异常，请稍后重试", retryable: true };
  }
  if (status >= 500) return { errorCode: "PROVIDER_UNAVAILABLE" as const, publicMessage: "模型服务暂时不可用，请稍后重试", retryable: true };
  if (status >= 400 && status < 500) return { errorCode: "PROVIDER_INVALID_PARAMETERS" as const, publicMessage: "生成参数不符合当前模型要求，请检查模式和素材", retryable: false };
  return { errorCode: "PROVIDER_UNKNOWN_ERROR" as const, publicMessage: "视频生成失败，请稍后重试", retryable: false };
};

export class ProviderRequestError extends Error {
  readonly errorCode: ProviderErrorCode;
  readonly retryable: boolean;
  readonly providerCode?: string;
  readonly requestId?: string;
  readonly stage: ProviderStage;

  constructor(message: string, readonly status: number | "network", metadata: { providerCode?: string; requestId?: string; stage?: ProviderStage } = {}) {
    const classified = classifyProviderError(message, status, metadata.providerCode);
    super(classified.publicMessage);
    this.name = "ProviderRequestError";
    this.errorCode = classified.errorCode;
    this.retryable = classified.retryable;
    this.providerCode = metadata.providerCode;
    this.requestId = metadata.requestId;
    this.stage = metadata.stage ?? "query";
  }
}

const providerFetch = async (url: string, init: RequestInit = {}) => {
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(config.providerRequestTimeoutMs) }); }
  catch (error) {
    const timedOut = (error as Error).name === "TimeoutError" || (error as Error).name === "AbortError";
    throw new ProviderRequestError(timedOut ? "provider timeout" : "provider network error", "network", { stage: init.method === "POST" ? "submit" : "query" });
  }
};

const providerError = async (response: Response) => {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    return {
      message: body?.error?.message ?? body?.message ?? `provider request failed (${response.status})`,
      code: body?.error?.code ?? body?.code,
      requestId: response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? body?.request_id,
    };
  } catch {
    return { message: text || `provider request failed (${response.status})`, requestId: response.headers.get("x-request-id") ?? response.headers.get("x-tt-logid") ?? undefined };
  }
};

const providerJson = async <T>(response: Response): Promise<T> => {
  try { return await response.json() as T; }
  catch (error) {
    throw new ProviderRequestError(error instanceof SyntaxError ? "上游模型服务响应格式异常" : "上游模型服务响应中断", "network");
  }
};

export const buildProviderPayload = (input: GenerationInput) => {
  const model = getModel(input.model);
  if (!model) throw new Error("未找到所选模型");
  if (containsInternalPromptMarker(input.prompt)) {
    console.error(JSON.stringify({ type: "provider_prompt_marker_blocked", at: new Date().toISOString(), model: input.model }));
    throw new Error("提示词包含未解析的内部素材引用");
  }
  const content: Record<string, unknown>[] = [];
  if (input.prompt) content.push({ type: "text", text: input.prompt });
  for (const asset of input.assets) {
    const url = asset.assetId ? `asset://${asset.assetId}` : asset.url;
    if (!url) throw new Error("素材尚未解析为可提交地址");
    const key = `${asset.type}_url`;
    content.push({ type: key, [key]: { url }, role: asset.role });
  }
  const payload: Record<string, unknown> = {
    model: input.model, content, ratio: input.ratio,
    resolution: input.resolution, duration: input.duration, seed: input.seed,
    watermark: input.watermark, output_format: input.outputFormat
  };
  if (input.cameraFixed && input.mode !== "text") payload.camera_fixed = true;
  if (model.supportsAudio) payload.generate_audio = input.generateAudio;
  if (model.id === "dreamina-seedance-2-5-260628" && input.mode === "omni") payload.omni_reference_task_type = "reference";
  if (model.id === "dreamina-seedance-2-5-260628" && (input.mode === "edit" || input.mode === "extend")) payload.omni_reference_task_type = input.mode;
  return payload;
};

export const createProviderTask = async (input: GenerationInput) => {
  if (!config.apiKey) throw new Error("服务器尚未配置 ARK_API_KEY");
  const response = await providerFetch(endpoint, { method: "POST", headers: headers(), body: JSON.stringify(buildProviderPayload(input)) });
  if (!response.ok) { const detail = await providerError(response); throw new ProviderRequestError(detail.message, response.status, { providerCode: detail.code, requestId: detail.requestId, stage: "submit" }); }
  return providerJson<{ id: string }>(response);
};

export type ProviderTaskResult = { status: string; content?: { video_url?: string }; error?: { message?: string; code?: string; request_id?: string } | null };

export const getProviderTask = async (id: string) => {
  const response = await providerFetch(`${endpoint}/${encodeURIComponent(id)}`, { headers: headers() });
  if (!response.ok) { const detail = await providerError(response); throw new ProviderRequestError(detail.message, response.status, { providerCode: detail.code, requestId: detail.requestId, stage: "query" }); }
  return providerJson<ProviderTaskResult>(response);
};
