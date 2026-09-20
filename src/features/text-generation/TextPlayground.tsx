import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, Layers3, LoaderCircle, RotateCcw, Send, Square } from "lucide-react";
import { ComposerFrame } from "../composer/ComposerFrame";
import { ComposerDock } from "../composer/ComposerDock";
import { CreationTypeControl } from "../composer/CreationTypeControl";
import { api } from "../../api";
import { textModelCatalog, type TextModel } from "../../../server/text-model-catalog";
import { TextModelPicker } from "./TextModelPicker";
import { readTextDraft, saveTextDraft, type TextDraft, type TextRecord } from "./text-cache";
import { streamText } from "./text-client";
import "./text-playground.css";

export function TextPlayground({ userId, sessionId, compact = false, chooseMedia, onSubmitted }: { userId: string; sessionId: string; compact?: boolean; chooseMedia: (engine: "video" | "image") => void; onSubmitted: (prompt: string) => void }) {
  const [models, setModels] = useState<TextModel[]>(textModelCatalog());
  const [model, setModel] = useState("openai/gpt-5.6-sol");
  const [prompt, setPrompt] = useState("");
  const [records, setRecords] = useState<TextRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
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
  const docked = compact || records.length > 0;
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
  useEffect(() => {
    const trackScroll = () => { const bottom = tail.current?.getBoundingClientRect().bottom; if (bottom != null) followOutput.current = bottom < window.innerHeight + 100; };
    window.addEventListener("scroll", trackScroll, { passive: true });
    return () => window.removeEventListener("scroll", trackScroll);
  }, []);
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
  const composer = <ComposerFrame compact={docked}>
    <div className="prompt-row prompt-row--text">
      <div className="prompt-editor-wrap">
        <textarea className="prompt-editor text-prompt-editor" ref={input} rows={3} aria-label="文本提示词" placeholder="输入你想发送给模型的内容……" value={prompt} disabled={!hydrated} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(); }
        }} />
      </div>
    </div>
    <div className="control-row">
      <CreationTypeControl value="text" open={typeOpen} setOpen={setTypeOpen} choose={(engine) => { if (engine !== "text") chooseMedia(engine); }} />
      <div className="control-wrap text-model-control"><button className="control" aria-label="选择文本模型" aria-haspopup="dialog" onClick={() => { setTypeOpen(false); setPicker(true); }}><Layers3 /><span>{models.find((item) => item.id === model)?.name ?? model}</span><ChevronDown /></button></div>
      <span className="control-spacer" />
      {busy ? <button className="send-button" onClick={() => request.current?.abort()} aria-label="停止文本生成" title="停止文本生成"><Square /></button> : <button className="send-button" onClick={() => void submit()} disabled={!hydrated || !prompt.trim() || !sessionId} aria-label="生成文本" title="Ctrl / ⌘ + Enter 发送"><Send /></button>}
    </div>
    {busy && <div className="composer-submit-hint" role="status">正在输出。离开此页面会停止接收，部分供应商可能继续处理请求。</div>}
    {error && <div role="alert" className="composer-draft-status">{error}</div>}
    {cacheWarning && <div role="status" className="composer-draft-status">{cacheWarning}</div>}
  </ComposerFrame>;
  return <>
    {docked ? <div className="conversation text-conversation">
      <div className="conversation-inner">
        {!records.length && <div className="conversation-heading"><h1>文本创作</h1><p>在下方输入内容，开始一次独立请求。</p></div>}
      {records.map((record) => <article className="task-card text-result" key={record.id} aria-label="文本生成结果"><header><span>{models.find((item) => item.id === record.model)?.name ?? record.model}</span><small>{record.status === "streaming" ? "正在输出" : record.status === "stopped" ? "已停止" : record.status === "failed" ? "未完成" : "已完成"}</small></header><details><summary>查看本次输入</summary><pre>{record.prompt}</pre></details><div className="text-result__content">{record.text || (record.status === "streaming" ? <span role="status"><LoaderCircle className="spin" /> 等待模型响应…</span> : "本次未收到文本输出。")}</div>{record.error && <p role="alert" className="text-result__error">{record.error}</p>}{record.finishReason === "length" && <p className="text-result__error">本次输出达到模型返回上限，内容可能未结束。</p>}<footer><button disabled={!record.text} onClick={() => void copy(record)}><Copy />{copied === record.id ? "已复制" : "复制输出"}</button><button disabled={busy} onClick={() => { setPrompt(record.prompt); setModel(record.model); input.current?.focus(); }}><RotateCcw />重新编辑</button></footer></article>)}<div ref={tail} />
      </div>
      <ComposerDock>{composer}<div className="creation-footnote">单轮输入 · 不附带历史上下文或系统提示词 · 记录仅保存在当前浏览器</div></ComposerDock>
    </div> : <div className="empty-workspace">{composer}<div className="creation-footnote">单轮输入 · 不附带历史上下文或系统提示词 · 记录仅保存在当前浏览器</div></div>}
    {picker && <TextModelPicker models={models} selected={model} choose={setModel} close={() => setPicker(false)} />}
  </>;
}
