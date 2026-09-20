import { z } from "zod";
import { TEXT_MODEL_IDS } from "./text-model-catalog.js";
import { sseData } from "./text-sse.js";

export const textRequestSchema = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(),
  model: z.enum(TEXT_MODEL_IDS),
  // Do not trim, rewrite, add system instructions or impose a fabricated character limit.
  prompt: z.string().refine((value) => value.trim().length > 0, "请输入内容"),
}).strict();
export const textRequestBody = (model: string, prompt: string) => ({ model, stream: true, messages: [{ role: "user", content: prompt }] });
export class TextGenerationError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code); }
}
export function textFailure(error: unknown) {
  const code = error instanceof TextGenerationError ? error.code : "TEXT_NETWORK_ERROR";
  const messages: Record<string, string> = {
    TEXT_AUTH_FAILED: "模型服务密钥不可用，请联系管理员。", TEXT_CREDITS_EXHAUSTED: "模型服务余额不足，请联系管理员。",
    TEXT_MODEL_UNAVAILABLE: "当前模型不可用或未获授权，请选择其他模型。", TEXT_RATE_LIMITED: "模型服务繁忙，请稍后再试。",
    TEXT_INVALID_REQUEST: "模型未接受此输入，请检查内容或更换模型。", TEXT_CONTENT_FILTERED: "内容未通过模型审核，请调整输入。",
    TEXT_PROVIDER_ERROR: "模型服务中断，已收到的内容仍保留，请按需重新发送。",
    TEXT_INCOMPLETE: "连接在输出完成前中断，已收到的内容仍保留。",
    TEXT_TIMEOUT: "模型响应超时，已收到的内容仍保留，可重新发送或更换模型。",
    TEXT_NETWORK_ERROR: "暂时无法连接模型服务，请稍后重试。",
  };
  return { code, error: messages[code] ?? messages.TEXT_PROVIDER_ERROR };
}
export function textHttpError(status: number) {
  return new TextGenerationError(status === 401 ? "TEXT_AUTH_FAILED" : status === 402 ? "TEXT_CREDITS_EXHAUSTED" : status === 403 || status === 404 ? "TEXT_MODEL_UNAVAILABLE" : status === 429 ? "TEXT_RATE_LIMITED" : status === 400 || status === 413 ? "TEXT_INVALID_REQUEST" : "TEXT_PROVIDER_ERROR", status);
}
export type TextEvent = { type: "delta"; text: string } | { type: "done"; finishReason: string | null };
export async function consumeTextResponse(response: Response, emit: (event: TextEvent) => Promise<void>) {
  if (!response.ok) { await response.body?.cancel(); throw textHttpError(response.status); }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new TextGenerationError("TEXT_PROVIDER_ERROR");
  let finishReason: string | null = null;
  let hasText = false;
  for await (const data of sseData(response.body)) {
    if (data === "[DONE]") {
      if (!hasText) throw new TextGenerationError("TEXT_INCOMPLETE");
      await emit({ type: "done", finishReason });
      return;
    }
    const parsed = z.object({ error: z.unknown().optional(), choices: z.array(z.object({ delta: z.object({ content: z.string().nullable().optional() }).passthrough().optional(), finish_reason: z.string().nullable().optional() }).passthrough()).optional() }).passthrough().safeParse(JSON.parse(data));
    if (!parsed.success || parsed.data.error) throw new TextGenerationError("TEXT_PROVIDER_ERROR");
    const choice = parsed.data.choices?.[0];
    if (choice?.finish_reason === "error") throw new TextGenerationError("TEXT_PROVIDER_ERROR");
    if (choice?.finish_reason === "content_filter") throw new TextGenerationError("TEXT_CONTENT_FILTERED");
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (choice?.delta?.content) { hasText = true; await emit({ type: "delta", text: choice.delta.content }); }
  }
  throw new TextGenerationError("TEXT_INCOMPLETE");
}
