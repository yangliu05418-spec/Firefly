/** Upload progress is independent of the response deadline: abort only after inactivity. */
export function putUploadPart(url: string, blob: Blob, signal?: AbortSignal, progress?: (bytes: number) => void): Promise<{ ok: boolean; status: number; eTag: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout>;
    let settled = false;
    let uploadedBytes = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, eTag: (xhr.getResponseHeader("etag") ?? "").replace(/^"|"$/g, "") });
    };
    const abort = () => { finish(new DOMException("已取消上传", "AbortError")); xhr.abort(); };
    const watch = () => { clearTimeout(timer); timer = setTimeout(() => { finish(new DOMException("上传连接停滞，正在尝试恢复", "TimeoutError")); xhr.abort(); }, 30_000); };
    if (signal?.aborted) { abort(); return; }
    xhr.open("PUT", url);
    xhr.upload.onprogress = (event) => { if (event.loaded > uploadedBytes) { uploadedBytes = event.loaded; watch(); } progress?.(event.loaded); };
    xhr.upload.onload = watch;
    xhr.onload = () => finish();
    xhr.onerror = () => finish(new Error("上传网络连接中断"));
    xhr.onabort = () => finish(new DOMException("已取消上传", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    watch(); xhr.send(blob);
  });
}
