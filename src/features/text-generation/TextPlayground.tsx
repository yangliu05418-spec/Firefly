import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, LoaderCircle, RotateCcw, Send, Square, Type } from "lucide-react";
import { api } from "../../api";
import { textModelCatalog, type TextModel } from "../../../server/text-model-catalog";
import { TextModelPicker } from "./TextModelPicker";
import { readTextDraft, saveTextDraft, type TextDraft, type TextRecord } from "./text-cache";
import { streamText } from "./text-client";
import "./text-playground.css";

export function TextPlayground({ userId, sessionId, chooseMedia, onSubmitted }: { userId: string; sessionId: string; chooseMedia: (engine: "video" | "image") => void; onSubmitted: (prompt: string) => void }) {
  const [models, setModels] = useState<TextModel[]>(textModelCatalog());
  const [model, setModel] = useState("openai/gpt-5.6-sol");
  const [prompt, setPrompt] = useState("");
  const [records, setRecords] = useState<TextRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState("");
  const [cacheWarning, setCacheWarning] = useState("");
  const [copied, setCopied] = useState("");
  const request = useRef<AbortController | null>(null);
  const latest = useRef<TextDraft>({ prompt, model, records });
  const ready = useRef(false);
  const active = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const tail = useRef<HTMLDivElement>(null);
  const followOutput = useRef(true);
  latest.current = { prompt, model, records };
  const persist = (value: TextDraft) => saveTextDraft(userId, sessionId, value).catch(() => { if (active.current) setCacheWarning("本机存储不可用，请在离开前复制需要保留的内容。"); });
  useEffect(() => {
    active.current = true;
    void readTextDraft(userId, sessionId).then((draft) => {
      if (!active.current) return;
      if (draft) { setPrompt(draft.prompt); setModel(textModelCatalog().some((item) => item.id === draft.model) ? draft.model : "openai/gpt-5.6-sol"); setRecords(draft.records.map((record) => record.status === "streaming" ? { ...record, status: "stopped", error: "上次输出已中断，已收到的内容仍保留。" } : record)); }
    }).catch(() => { if (active.current) setCacheWarning("本机记录暂时无法恢复，你仍可使用文本生成。"); }).finally(() => { if (active.current) { ready.current = true; setHydrated(true); } });
    const flush = () => { if (ready.current) void persist(latest.current); };
    window.addEventListener("pagehide", flush);
    return () => { active.current = false; request.current?.abort(); window.removeEventListener("pagehide", flush); if (ready.current) void persist({ ...latest.current, records: latest.current.records.map((record) => record.status === "streaming" ? { ...record, status: "stopped" } : record) }); };
  }, [userId, sessionId]);
  useEffect(() => { let live = true; void api.get<{ items: TextModel[]; configured: boolean }>("/api/text-models").then((catalog) => { if (live) { setModels(catalog.items); if (!catalog.configured) setError("文本模型服务尚未配置，请联系管理员。"); } }).catch(() => undefined); return () => { live = false; }; }, []);
  useEffect(() => { if (!hydrated || busy) return; const timer = window.setTimeout(() => void persist(latest.current), 200); return () => clearTimeout(timer); }, [prompt, model, records, hydrated, busy]);
  useEffect(() => { if (!hydrated || !busy) return; const timer = window.setInterval(() => void persist(latest.current), 750); return () => clearInterval(timer); }, [hydrated, busy]);
  useEffect(() => { if (followOutput.current) tail.current?.scrollIntoView({ block: "nearest" }); }, [records]);
  const submit = async () => {
    if (request.current || !hydrated || !prompt.trim() || !sessionId) return;
    const controller = new AbortController(); request.current = controller;
    const record: TextRecord = { id: crypto.randomUUID(), model, prompt, text: "", status: "streaming", createdAt: Date.now() };
    setError(""); setBusy(true); followOutput.current = true; setRecords((current) => [...current, record]);
    let text = "";
    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    const update = (patch: Partial<TextRecord>) => { if (active.current) setRecords((current) => current.map((item) => item.id === record.id ? { ...item, ...patch } : item)); };
    try {
      onSubmitted(prompt);
      const finishReason = await streamText({ requestId: record.id, sessionId, model, prompt }, controller.signal, (delta) => {
        text += delta;
        if (!renderTimer) renderTimer = setTimeout(() => { renderTimer = undefined; update({ text }); }, 40);
      });
      update({ text, status: "completed", finishReason });
    } catch (cause) { update({ text, status: controller.signal.aborted ? "stopped" : "failed", error: controller.signal.aborted ? undefined : cause instanceof Error ? cause.message : "请求中断，已收到的内容仍保留。" }); }
    finally { clearTimeout(renderTimer); request.current = null; if (active.current) setBusy(false); }
  };
  const copy = async (record: TextRecord) => { try { await navigator.clipboard.writeText(record.text); setCopied(record.id); } catch { setError("复制失败，请选择输出文字后手动复制。"); } };
  return <div className="text-playground">
    <div className="text-playground__results" onScroll={(event) => { const element = event.currentTarget; followOutput.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
      {!records.length && <div className="text-playground__welcome"><Type /><h1>把想法写下来</h1><p>选择模型，输入内容。每次发送都是独立请求。</p></div>}
      {records.map((record) => <article className="text-result" key={record.id} aria-label="文本生成结果"><header><span>{models.find((item) => item.id === record.model)?.name ?? record.model}</span><small>{record.status === "streaming" ? "正在输出" : record.status === "stopped" ? "已停止" : record.status === "failed" ? "未完成" : "已完成"}</small></header><details><summary>查看本次输入</summary><pre>{record.prompt}</pre></details><div className="text-result__content">{record.text || (record.status === "streaming" ? <span role="status"><LoaderCircle className="spin" /> 等待模型响应…</span> : "本次未收到文本输出。")}</div>{record.error && <p role="alert" className="text-result__error">{record.error}</p>}{record.finishReason === "length" && <p className="text-result__error">本次输出达到模型返回上限，内容可能未结束。</p>}<footer><button disabled={!record.text} onClick={() => void copy(record)}><Copy />{copied === record.id ? "已复制" : "复制输出"}</button><button disabled={busy} onClick={() => { setPrompt(record.prompt); setModel(record.model); input.current?.focus(); }}><RotateCcw />重新编辑</button></footer></article>)}<div ref={tail} />
    </div>
    <section className="text-playground__composer" aria-label="文本生成输入"><textarea ref={input} rows={4} aria-label="文本提示词" placeholder="输入你想发送给模型的内容…" value={prompt} disabled={!hydrated} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); } }} />
      <div className="text-playground__controls"><label className="text-playground__type"><Type /><select aria-label="选择创作类型" value="text" onChange={(event) => chooseMedia(event.target.value as "video" | "image")}><option value="video">视频生成</option><option value="image">图片生成</option><option value="text">文本生成</option></select></label><button className="text-playground__model" onClick={() => setPicker(true)}><span>{models.find((item) => item.id === model)?.name ?? model}</span><ChevronDown /></button>{busy ? <button className="text-playground__send" onClick={() => request.current?.abort()} aria-label="停止文本生成"><Square />停止</button> : <button className="text-playground__send" onClick={() => void submit()} disabled={!hydrated || !prompt.trim() || !sessionId} aria-label="生成文本"><Send />发送</button>}</div>
      <p className="text-playground__hint">不附带历史上下文或系统提示词 · 记录仅保存在当前浏览器 · Ctrl / ⌘ + Enter 发送</p>{busy && <p className="text-playground__hint">离开此页面会停止接收输出；部分供应商可能继续处理已发送的请求。</p>}{error && <p role="alert" className="text-result__error">{error}</p>}{cacheWarning && <p role="status" className="text-result__error">{cacheWarning}</p>}
    </section>
    {picker && <TextModelPicker models={models} selected={model} choose={setModel} close={() => setPicker(false)} />}
  </div>;
}
