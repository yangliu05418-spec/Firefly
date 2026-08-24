import type { CreationMode, GenerationCapacity } from "../../types";

type SubmissionReadinessInput = {
  engine: "video" | "image";
  mode: CreationMode;
  prompt: string;
  providerPromptCharacters: number;
  providerPromptLimit: number;
  editorPromptCharacters: number;
  editorPromptLimit: number;
  assetCount: number;
  hasVideoAsset: boolean;
  hasFirstFrame: boolean;
  hasLastFrame: boolean;
  uploadsReady: boolean;
  imageReady: boolean;
  loading: boolean;
  confirmationPending: boolean;
  capacity?: GenerationCapacity | null;
};

/**
 * One source of truth for both the disabled state and the explanation shown to
 * the user. The server remains authoritative because another browser tab can
 * consume a slot between this check and admission.
 */
export const submissionBlockReason = (input: SubmissionReadinessInput) => {
  if (input.loading) return "正在提交当前任务";
  if (input.confirmationPending) return "正在确认上一项是否已进入队列";
  if (input.engine === "video" && input.capacity && input.capacity.available <= 0) {
    return `已达 ${input.capacity.limit} 项并行上限，完成一项后可继续`;
  }
  if (!input.uploadsReady) return "素材仍在上传，请稍候";
  if (input.editorPromptCharacters > input.editorPromptLimit) return `编辑内容超过 ${input.editorPromptLimit} 个字符，请精简后提交`;
  if (input.providerPromptCharacters > input.providerPromptLimit) return `提示词展开素材引用后超过 ${input.providerPromptLimit} 个字符，请精简后提交`;
  if (input.engine === "image") return input.imageReady ? "" : "输入提示词并选择可用模型后即可生成";
  if (input.mode === "text") return input.prompt.trim() ? "" : "输入提示词后即可生成";
  if (input.mode === "first_frame") return input.assetCount === 1 && input.hasFirstFrame ? "" : "请添加一张首帧图片";
  if (input.mode === "first_last") return input.assetCount === 2 && input.hasFirstFrame && input.hasLastFrame ? "" : "请添加首帧和尾帧图片";
  if (input.mode === "omni") return input.assetCount > 0 ? "" : "全能参考至少需要一个参考素材";
  return input.prompt.trim() && input.hasVideoAsset ? "" : "请添加视频素材并输入编辑要求";
};
