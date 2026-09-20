/** Pure SSE framing shared by both hops; handles UTF-8 splits, CRLF, comments and multiline data. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(pending))) {
        const frame = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
        if (data) yield data;
      }
      // Bound incomplete protocol frames, not user prompts or overall output.
      if (pending.length > 1024 * 1024) throw new Error("SSE_FRAME_TOO_LARGE");
      if (done) break;
    }
    if (pending.trim() && !pending.trim().startsWith(":")) throw new Error("SSE_TRUNCATED_FRAME");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
