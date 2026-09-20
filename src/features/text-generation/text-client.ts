import { notifySignedOut } from "../../api";
import { sseData } from "../../../server/text-sse";

export async function streamText(input: { requestId: string; sessionId: string; model: string; prompt: string }, signal: AbortSignal, onDelta: (text: string) => void) {
  const deadline = AbortSignal.timeout(630_000);
  try { return await consumeStream(input, AbortSignal.any([signal, deadline]), onDelta); }
  catch (error) {
    if (deadline.aborted && !signal.aborted) throw new Error("本次输出等待超时，已收到的内容仍保留。请按需重新发送。");
    throw error;
  }
}

async function consumeStream(input: { requestId: string; sessionId: string; model: string; prompt: string }, signal: AbortSignal, onDelta: (text: string) => void) {
  const response = await fetch("/api/text-generations", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
  if (response.status === 401) notifySignedOut();
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "暂时无法发送，请稍后重试。");
  }
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) throw new Error("响应格式异常，请稍后重试。");
  for await (const data of sseData(response.body)) {
    const event: unknown = JSON.parse(data);
    if (!event || typeof event !== "object" || !("type" in event)) throw new Error("响应格式异常，已收到的内容仍保留。");
    if (event.type === "delta" && "text" in event && typeof event.text === "string") onDelta(event.text);
    else if (event.type === "done" && "finishReason" in event && (event.finishReason === null || typeof event.finishReason === "string")) return event.finishReason;
    else if (event.type === "error" && "error" in event && typeof event.error === "string") throw new Error(event.error);
    else throw new Error("响应格式异常，已收到的内容仍保留。");
  }
  throw new Error("连接已中断，已收到的内容仍保留。请按需重新发送。");
}
