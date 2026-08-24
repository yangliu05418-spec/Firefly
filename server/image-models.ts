/**
 * 图片生成模型规格（OpenRouter）。
 * Gemini 系列使用营销名称展示（用户指定格式）；其余模型使用"厂商: 名称"规范名。
 * 分辨率档位为每模型支持的短边基准（px），实际尺寸由比例推导并取 16 的倍数。
 */

export type ImageModelSpec = {
  id: string;
  name: string;
  /** 分辨率档位（短边基准 px，展示为 "1024px" 等） */
  resolutions: string[];
  defaultResolution: string;
  /** 单次最多生成数量 */
  maxCount: number;
  /** 单次最多引用图片数 */
  maxReferences: number;
  /** 最长边上限（px） */
  maxSize: number;
};

export const IMAGE_RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: "google/gemini-3.1-flash-lite-image",
    name: "Google: Nano Banana 2 Lite (Gemini 3.1 Flash Lite Image)",
    resolutions: ["1024"],
    defaultResolution: "1024",
    maxCount: 4,
    maxReferences: 4,
    maxSize: 1024,
  },
  {
    id: "google/gemini-3.1-flash-image",
    name: "Google: Nano Banana 2 (Gemini 3.1 Flash Image)",
    resolutions: ["512", "768", "1024", "1536"],
    defaultResolution: "1024",
    maxCount: 4,
    maxReferences: 4,
    maxSize: 1536,
  },
  {
    id: "google/gemini-3-pro-image",
    name: "Google: Nano Banana Pro (Gemini 3 Pro Image)",
    resolutions: ["768", "1024", "1536", "2048"],
    defaultResolution: "1024",
    maxCount: 4,
    maxReferences: 4,
    maxSize: 2048,
  },
  {
    id: "bytedance-seed/seedream-5-0-pro",
    name: "ByteDance: Seedream 5.0 Pro",
    resolutions: ["512", "768", "1024", "1536"],
    defaultResolution: "1024",
    maxCount: 4,
    maxReferences: 4,
    maxSize: 1536,
  },
  {
    id: "openai/gpt-image-2",
    name: "OpenAI: GPT Image 2",
    resolutions: ["512", "768", "1024"],
    defaultResolution: "1024",
    maxCount: 4,
    maxReferences: 4,
    maxSize: 1024,
  },
  {
    id: "x-ai/grok-imagine-image-2.0",
    name: "xAI: Grok Imagine 2.0",
    resolutions: ["512", "768", "1024", "1536"],
    defaultResolution: "1024",
    maxCount: 4,
    maxReferences: 4,
    maxSize: 1536,
  },
  {
    id: "qwen/qwen-image-3-pro",
    name: "Qwen: Qwen Image 3 Pro",
    resolutions: ["512", "768", "1024", "1536"],
    defaultResolution: "1024",
    maxCount: 4,
    maxReferences: 4,
    maxSize: 1536,
  },
];

export const DEFAULT_IMAGE_MODEL = "google/gemini-3.1-flash-lite-image";

export const imageModelById = (id: string): ImageModelSpec | undefined => IMAGE_MODELS.find((model) => model.id === id);

/** OpenRouter Images API accepts normalized resolution tiers, not arbitrary pixels. */
export const openRouterResolution = (value: string): "512" | "1K" | "2K" | "4K" => {
  const pixels = Number(value);
  if (!Number.isFinite(pixels) || pixels <= 512) return "512";
  if (pixels <= 1024) return "1K";
  if (pixels <= 2048) return "2K";
  return "4K";
};

/** 比例 + 分辨率档位 → 具体尺寸（WxH，16 的倍数，不超过模型最长边上限） */
export const computeImageSize = (ratio: string, tier: number, maxSize: number): string => {
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return tier + "x" + tier;
  let width: number;
  let height: number;
  if (w >= h) {
    width = tier;
    height = Math.round((tier * h) / w);
  } else {
    height = tier;
    width = Math.round((tier * w) / h);
  }
  const scale = Math.min(1, maxSize / Math.max(width, height));
  width = Math.max(16, Math.round((width * scale) / 16) * 16);
  height = Math.max(16, Math.round((height * scale) / 16) * 16);
  return width + "x" + height;
};
