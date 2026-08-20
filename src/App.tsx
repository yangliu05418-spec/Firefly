import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArrowRight, AudioLines, Check, CheckSquare2, ChevronDown, ChevronRight, Clock3, Clapperboard, Copy, Download, Film, Home, ImageIcon, Layers3, LayoutGrid, Library, LoaderCircle, LogOut, Menu, MessageSquare, PanelLeftClose, Pencil, Play, Plus, RefreshCw, Search, Send, Settings2, Sparkles, Square, Trash2, Upload, Video, WandSparkles, X } from "lucide-react";
import { api, inferUploadType, listenForSignedOut, notifySignedOut, uploadFile } from "./api";
import type { AssetCategory, CreationMode, ImageGenResponse, ImageModel, ImageResultBundle, LibraryAsset, LibraryGroup, ModelCapability, SessionUser, Task, UploadAsset } from "./types";
import { materializePromptReferences, promptAssetLabel, promptAssetMarker } from "./prompt-references";
import { clearEditorSelection } from "./prompt-selection";
import { CanvasProjectList } from "./features/canvas/CanvasProjectList";
import { CanvasWorkspaceGate as CanvasWorkspace } from "./features/canvas/CanvasWorkspaceGate";
import { CanvasInsertPicker } from "./features/canvas/CanvasInsertPicker";

const modeLabels: Record<CreationMode, string> = { omni: "全能参考", first_frame: "首帧生成", first_last: "首尾帧", edit: "视频编辑", extend: "视频续写", text: "文本生成" };
const modeNotes: Record<CreationMode, string> = { omni: "自由组合图片、视频和音频", first_frame: "锁定开场画面继续创作", first_last: "精确控制起点与落点", edit: "替换、增删或重绘画面", extend: "向前、向后或多段衔接", text: "只用提示词生成镜头" };
const modePlaceholders: Record<CreationMode, string> = {
  omni: "描述目标画面，并用 @图片1、@视频1、@音频1 说明每份参考素材的作用……",
  first_frame: "描述从首帧开始发生的动作、镜头运动与声音……",
  first_last: "描述首帧到尾帧之间的动作、转场与镜头运动……",
  edit: "明确描述要编辑的内容，例如：把 @视频1 中的猫替换为 @图片1 中的狮子……",
  extend: "明确描述续写方向，例如：向后续写 @视频1，人物推门走入雨夜街道……",
  text: "描述画面内容、主体动作、场景、风格、镜头运动与声音……"
};
const statusText: Record<Task["status"], string> = { queued: "等待调度", submitting: "正在提交", running: "正在生成", succeeded: "生成完成", failed: "生成失败" };
const taskStatusText = (task: Task) => task.status === "succeeded" && task.mediaStatus === "archiving" ? "正在归档成片" : task.status === "succeeded" && task.mediaStatus === "failed" ? "成片归档待恢复" : statusText[task.status];
const assetCategoryLabels: Record<AssetCategory, string> = { character: "角色", scene: "场景", prop: "道具", material: "素材" };
const assetCategories = Object.keys(assetCategoryLabels) as AssetCategory[];

const waitingMoments = [
  { title: "镜头正在成形", detail: "正在理解画面、运动与声音之间的关系" },
  { title: "让画面慢慢呼吸", detail: "细节会在时间里找到自己的位置" },
  { title: "正在组织光线与节奏", detail: "每一帧都在向同一个方向靠拢" },
  { title: "故事仍在暗房里显影", detail: "可以离开页面，任务会在队列中继续" },
  { title: "正在打磨镜头的质感", detail: "成片完成后会自动出现在这里" },
  { title: "最后一点耐心，也属于创作", detail: "Firefly 正在守候这段镜头完成" }
];

function FireflyGlyph({ compact = false }: { compact?: boolean }) {
  return <svg className={`firefly-glyph ${compact ? "firefly-glyph--compact" : ""}`} viewBox="0 0 1024 1024" role="img" aria-label="Firefly 萤火虫标志">
    <path d="M467 397C394 330 311 259 228 197C159 146 102 108 76 115C49 123 55 178 76 226C105 292 160 345 224 371C288 397 360 399 467 397Z" />
    <path d="M535 397C608 330 691 259 774 197C843 146 900 108 926 115C953 123 947 178 926 226C897 292 842 345 778 371C714 397 642 399 535 397Z" />
    <path d="M458 417C383 422 312 430 250 446C198 459 168 479 171 508C174 545 199 574 236 581C281 590 322 572 354 539C388 504 419 462 458 417Z" />
    <path d="M544 417C619 422 690 430 752 446C804 459 834 479 831 508C828 545 803 574 766 581C721 590 680 572 648 539C614 504 583 462 544 417Z" />
    <path d="M501 425C466 477 438 533 422 596C405 662 405 735 422 799C437 855 466 887 501 887C536 887 565 855 580 799C597 735 597 662 580 596C564 533 536 477 501 425Z" />
  </svg>;
}

function GenerateNavGlyph() { return <svg className="rail-glyph" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.2c1.35 4.78 4.02 7.45 8.8 8.8-4.78 1.35-7.45 4.02-8.8 8.8-1.35-4.78-4.02-7.45-8.8-8.8 4.78-1.35 7.45-4.02 8.8-8.8Z" /></svg>; }
function AssetsNavGlyph() { return <svg className="rail-glyph rail-glyph--stroke" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 7.5h6l1.8 2h9.2v8.7a2.3 2.3 0 0 1-2.3 2.3H5.8a2.3 2.3 0 0 1-2.3-2.3V7.5Z" /><path d="M3.5 7.5V6.2a2 2 0 0 1 2-2h3.2l1.8 2h7a2 2 0 0 1 2 2v1.3" /></svg>; }
function CanvasNavGlyph() { return <svg className="rail-glyph rail-glyph--canvas" viewBox="0 0 24 24" aria-hidden="true"><path className="canvas-frame" d="M6 2.5v19M2.5 6h12M2.5 18h11.5M17 2.5v7" /><path d="M17 3.2c.45 1.8 1.5 2.85 3.3 3.3-1.8.45-2.85 1.5-3.3 3.3-.45-1.8-1.5-2.85-3.3-3.3 1.8-.45 2.85-1.5 3.3-3.3ZM17.8 14.2c.55 2.1 1.8 3.35 3.9 3.9-2.1.55-3.35 1.8-3.9 3.9-.55-2.1-1.8-3.35-3.9-3.9 2.1-.55 3.35-1.8 3.9-3.9Z" /></svg>; }
function AtlasNavGlyph() { return <svg className="rail-glyph rail-glyph--atlas" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 0 100 100H70L50 49 42 64H22L50 0Z" /><path d="M10 80h58l12 20H0l10-20Z" /></svg>; }

function FireflyMark({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? "brand--compact" : ""}`}><span className="brand__glyph"><FireflyGlyph compact={compact} /></span><span>Firefly</span></div>;
}

function Landing({ enter }: { enter: () => void }) {
  return <main className="cinema-landing">
    <section className="cinema-hero" aria-labelledby="landing-quote">
      <video className="cinema-hero__film" autoPlay muted loop playsInline preload="metadata" poster="/ciridae/video-placeholder.webp?v=20260814b">
        <source src="/ciridae/hero_web.mp4?v=20260814b" type="video/mp4" />
      </video>
      <div className="cinema-hero__veil" />
      <div className="cinema-hero__brand" aria-label="Firefly">
        <FireflyGlyph />
        <span>FIREFLY</span>
      </div>
      <div className="cinema-hero__copy">
        <h1 id="landing-quote">
          <span>My fancies are fireflies, —</span>
          <span>Specks of living light</span>
          <span>twinkling in the dark.</span>
        </h1>
        <p>— Rabindranath Tagore</p>
      </div>
      <button className="cinema-hero__cta" onClick={enter}>
        <span>开始创作</span><ArrowRight size={16} />
      </button>
      <div className="cinema-hero__index" aria-hidden="true"><span>01</span><i /><span>FIREFLY · SEEDANCE STUDIO</span></div>
      <div className="cinema-hero__scroll" aria-hidden="true"><i /> SCROLL TO DISCOVER</div>
    </section>

    <section className="cinema-statement">
      <div className="cinema-statement__media"><img src="/ciridae/Hero.webp?v=20260814b" alt="星空下的湖泊与群山" /></div>
      <div className="cinema-statement__shade" />
      <div className="cinema-statement__copy">
        <span>FROM THOUGHT TO FRAME</span>
        <h2>让想象，拥有时间。</h2>
        <p>从文字、图像与声音出发，在同一个安静的创作空间里完成镜头。</p>
      </div>
    </section>

    <section className="cinema-process" aria-label="Firefly 创作能力">
      <header><span>THE WORKFLOW</span><p>清晰的输入，可靠的生成，完整的留存。</p></header>
      <div className="cinema-process__grid">
        <article>
          <img src="/ciridae/numbers-bg-new.webp?v=20260814b" alt="" />
          <div><span>01 / REFERENCE</span><h3>组织灵感</h3><p>组合官方支持的文字、图像、视频与音频参考。</p></div>
        </article>
        <article>
          <img src="/ciridae/pawel-czerwinski.webp?v=20260814b" alt="" />
          <div><span>02 / CREATE</span><h3>控制镜头</h3><p>让模型、生成模式和参数始终保持一致。</p></div>
        </article>
        <article>
          <img src="/ciridae/video-placeholder.webp?v=20260814b" alt="" />
          <div><span>03 / RETURN</span><h3>守候成片</h3><p>任务在队列中继续，完成后回到你的创作历史。</p></div>
        </article>
      </div>
    </section>

    <footer className="cinema-footer">
      <img src="/ciridae/footer-img-03.webp?v=20260814b" alt="抽象的电影感光轨" />
      <div className="cinema-footer__veil" />
      <div className="cinema-footer__mark"><FireflyGlyph /><span>FIREFLY</span></div>
      <p>SEEDANCE VIDEO STUDIO</p>
    </footer>
  </main>;
}

function AccessGate({ back }: { back: () => void }) {
  const error = new URLSearchParams(location.search).get("auth_error");
  const login = () => location.assign("/api/auth/feishu/start?returnTo=%2Fstudio");
  return <main className="access-page"><div className="ambient-grid" /><div className="access-card"><button className="back-link" onClick={back}>← 返回首页</button><FireflyMark /><h1>进入创作台</h1><p>仅向 dokuai.tv 企业成员开放，<br />首次登录会自动激活你的独立创作空间。</p><button className="primary-button feishu-login" onClick={login}>使用飞书企业账号登录 <ArrowRight size={16} /></button>{error && <div className="form-error">{error}</div>}</div></main>;
}

function Popover({ children, className = "" }: { children: React.ReactNode; className?: string }) { return <div className={`popover ${className}`} onClick={(e) => e.stopPropagation()}>{children}</div>; }

const promptNodeText = (node: Node): string => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof HTMLElement)) return "";
  if (node.dataset.assetId) return promptAssetMarker(node.dataset.assetId);
  if (node.tagName === "BR") return "\n";
  const content = Array.from(node.childNodes).map(promptNodeText).join("");
  return content + (["DIV", "P"].includes(node.tagName) ? "\n" : "");
};

function PromptEditor({ value, placeholder, assets, disabled, attach, change }: { value: string; placeholder: string; assets: UploadAsset[]; disabled: boolean; attach: (asset: UploadAsset) => UploadAsset | null; change: (value: string) => void }) {
  const editor = useRef<HTMLDivElement>(null); const mentionRange = useRef<Range | null>(null);
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [active, setActive] = useState(0); const [anchor, setAnchor] = useState({ left: 12, top: 12, above: false });
  const [library, setLibrary] = useState<UploadAsset[]>([]); const [libraryLoading, setLibraryLoading] = useState(false); const loadedLibrary = useRef(false);
  const sync = () => { if (editor.current) change(Array.from(editor.current.childNodes).map(promptNodeText).join("").replace(/\n{3,}/g, "\n\n")); };
  const candidates = useMemo(() => {
    const ready = assets.filter((asset) => asset.progress === 100);
    const merged = [...ready, ...library.filter((candidate) => !ready.some((asset) => asset.id === candidate.id))];
    const term = query.trim().toLocaleLowerCase();
    return (term ? merged.filter((asset) => asset.name.toLocaleLowerCase().includes(term) || promptAssetLabel(asset, merged).toLocaleLowerCase().includes(term)) : merged).slice(0, 30);
  }, [assets, library, query]);

  useEffect(() => { if (value === "" && editor.current?.childNodes.length) editor.current.replaceChildren(); }, [value]);
  useEffect(() => {
    if (!editor.current) return;
    const attached = new Set(assets.map((asset) => asset.id)); let removed = false;
    editor.current.querySelectorAll<HTMLElement>("[data-asset-id]").forEach((token) => { if (!attached.has(token.dataset.assetId ?? "")) { token.remove(); removed = true; } });
    if (removed) sync();
  }, [assets]);

  const loadLibrary = () => {
    if (loadedLibrary.current) return;
    loadedLibrary.current = true; setLibraryLoading(true);
    void api.get<{ Items?: LibraryAsset[] }>("/api/assets").then((result) => setLibrary((result.Items ?? []).filter((asset) => asset.Status === "Active").map((asset) => ({
      id: asset.Id, assetId: asset.Id, name: asset.Name || asset.Id, type: asset.AssetType.toLowerCase() as UploadAsset["type"], size: 0,
      role: asset.AssetType === "Image" ? "reference_image" : asset.AssetType === "Video" ? "reference_video" : "reference_audio", progress: 100, preview: asset.URL
    })))).catch(() => setLibrary([])).finally(() => setLibraryLoading(false));
  };

  const detectMention = () => {
    if (disabled) return setOpen(false);
    const selection = window.getSelection(); const node = selection?.anchorNode; const offset = selection?.anchorOffset ?? 0;
    if (!selection?.isCollapsed || !node || node.nodeType !== Node.TEXT_NODE) return setOpen(false);
    const match = (node.textContent ?? "").slice(0, offset).match(/@([^\s@]*)$/u);
    if (!match) return setOpen(false);
    const range = document.createRange(); range.setStart(node, offset - match[0].length); range.setEnd(node, offset); mentionRange.current = range.cloneRange();
    const rect = range.getBoundingClientRect(); const above = window.innerHeight - rect.bottom < 330;
    setAnchor({ left: Math.max(12, Math.min(rect.left, window.innerWidth - 332)), top: above ? rect.top - 8 : rect.bottom + 8, above });
    setQuery(match[1]); setActive(0); setOpen(true); loadLibrary();
  };

  const selectAsset = (candidate: UploadAsset) => {
    const asset = attach(candidate); const range = mentionRange.current;
    if (!asset || !range || !editor.current) return;
    const token = document.createElement("span"); token.className = "prompt-asset-token"; token.contentEditable = "false"; token.dataset.assetId = asset.id; token.title = asset.name;
    if (asset.preview) { const image = document.createElement("img"); image.src = asset.preview; image.alt = ""; token.append(image); }
    const label = document.createElement("span"); label.textContent = asset.name; token.append(label);
    range.deleteContents(); range.insertNode(token); const space = document.createTextNode("\u00a0"); token.after(space);
    const selection = window.getSelection(); const caret = document.createRange(); caret.setStartAfter(space); caret.collapse(true); selection?.removeAllRanges(); selection?.addRange(caret);
    setOpen(false); setQuery(""); mentionRange.current = null; sync(); editor.current.focus();
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + Math.max(1, candidates.length)) % Math.max(1, candidates.length)); }
    if (event.key === "Enter" && candidates[active]) { event.preventDefault(); selectAsset(candidates[active]); }
    if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
  };

  const popup = open && createPortal(<div className={`mention-pop ${anchor.above ? "mention-pop--above" : ""}`} style={{ left: anchor.left, top: anchor.top }} role="listbox" aria-label="选择参考资产" onMouseDown={(event) => event.preventDefault()}>
    <header><span>@ 选择参考资产</span><small>{query ? `搜索“${query}”` : "输入名称可筛选"}</small></header>
    <div className="mention-pop__list">{libraryLoading && !candidates.length ? <div className="mention-pop__state"><LoaderCircle className="spin" /> 正在读取资产</div> : candidates.length ? candidates.map((asset, index) => <button key={asset.id} className={index === active ? "active" : ""} role="option" aria-selected={index === active} onMouseDown={(event) => { event.preventDefault(); selectAsset(asset); }}>
      {asset.preview ? <img src={asset.preview} alt="" /> : <span className="mention-pop__media">{asset.type === "video" ? <Video /> : asset.type === "audio" ? <AudioLines /> : <Library />}</span>}
      <span><b>{asset.name}</b><small>{promptAssetLabel(asset, assets.some((item) => item.id === asset.id) ? assets : [...assets, asset])}</small></span><Check />
    </button>) : <div className="mention-pop__state">没有匹配的可用资产</div>}</div>
    <footer>↑↓ 选择　Enter 插入　Esc 关闭</footer>
  </div>, document.body);

  return <div className="prompt-editor-wrap"><div ref={editor} className="prompt-editor" contentEditable role="textbox" aria-multiline="true" aria-label="创作提示词" data-placeholder={placeholder} suppressContentEditableWarning onInput={() => { sync(); detectMention(); }} onKeyUp={(event) => !["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key) && detectMention()} onKeyDown={keyDown} onBlur={(event) => { clearEditorSelection(event.currentTarget); window.setTimeout(() => setOpen(false), 120); }} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }} />{popup}</div>;
}

function Composer({ models, compact, onCreated, onImagesGenerated }: { models: ModelCapability[]; compact: boolean; onCreated: (task: Task) => void; onImagesGenerated?: (bundle: ImageResultBundle) => void }) {
  const defaultModel = models[0];
  const [modelId, setModelId] = useState(defaultModel?.id ?? "");
  const model = models.find((item) => item.id === modelId) ?? defaultModel;
  const [mode, setMode] = useState<CreationMode>("omni");
  const [engine, setEngine] = useState<"video" | "image">("video");
  const [imageModels, setImageModels] = useState<ImageModel[]>([]);
  const [imageModelId, setImageModelId] = useState("");
  const [imageRatio, setImageRatio] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [prompt, setPrompt] = useState(""); const [ratio, setRatio] = useState("16:9"); const [resolution, setResolution] = useState("720p"); const [duration, setDuration] = useState(4);
  const [assets, setAssets] = useState<UploadAsset[]>([]); const [open, setOpen] = useState<"generation" | "model" | "mode" | "format" | "duration" | "advanced" | "library" | "image-model" | "image-format" | null>(null);
  const [generateAudio, setGenerateAudio] = useState(true); const [cameraFixed, setCameraFixed] = useState(false); const [watermark, setWatermark] = useState(false); const [seed, setSeed] = useState(-1);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const fileInput = useRef<HTMLInputElement>(null);
  const uploadControllers = useRef(new Map<string, AbortController>());
  const localPreviewUrls = useRef(new Set<string>());

  const releaseLocalPreview = (url?: string) => {
    if (url && localPreviewUrls.current.delete(url)) URL.revokeObjectURL(url);
  };
  const cancelAssetTransfer = (asset: UploadAsset) => {
    uploadControllers.current.get(asset.id)?.abort();
    uploadControllers.current.delete(asset.id);
    releaseLocalPreview(asset.preview);
  };
  const clearAttachedAssets = () => {
    assets.forEach(cancelAssetTransfer);
    setAssets([]);
  };
  const removeAttachedAsset = (id: string) => {
    const asset = assets.find((item) => item.id === id);
    if (asset) cancelAssetTransfer(asset);
    setAssets((current) => current.filter((item) => item.id !== id));
  };

  const isSeedance25 = model?.id === "dreamina-seedance-2-5-260628";
  const ratioLocked = isSeedance25 && (["first_frame", "first_last", "edit", "extend"] as CreationMode[]).includes(mode);
  const durationLocked = isSeedance25 && mode === "edit";
  const availableRatios = ratioLocked ? ["adaptive"] : (model?.ratios ?? []);
  const referenceSlots = engine === "image" ? ["参考图"] : mode === "text" ? [] : mode === "first_frame" ? ["首帧"] : mode === "first_last" ? ["首帧", "尾帧"] : mode === "edit" ? ["编辑视频", "参考内容"] : mode === "extend" ? ["续写视频", "参考内容"] : ["参考内容"];
  const fileAccept = engine === "image" || mode === "first_frame" || mode === "first_last" ? "image/*" : "image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav";
  const imageSpec = imageModels.find((item) => item.id === imageModelId) ?? imageModels[0];
  const imageReady = engine === "image" ? Boolean(prompt.trim()) && Boolean(imageSpec) : undefined;

  useEffect(() => {
    void api.get<{ Items: ImageModel[]; DefaultModel: string }>("/api/image-models").then((result) => {
      setImageModels(result.Items ?? []);
      const defaultId = result.DefaultModel ?? result.Items?.[0]?.id ?? "";
      setImageModelId(defaultId);
      const spec = result.Items?.find((item) => item.id === defaultId);
      if (spec) setImageResolution(spec.defaultResolution ?? spec.resolutions[0]);
    }).catch(() => setImageModels([]));
  }, []);
  useEffect(() => {
    if (!model) return;
    assets.forEach(cancelAssetTransfer);
    if (!model.modes.includes(mode)) { setMode(model.modes[0]); return; }
    if (!model.resolutions.includes(resolution)) setResolution(model.resolutions.includes("720p") ? "720p" : model.resolutions[0]);
    if (ratioLocked) setRatio("adaptive"); else if (ratio === "adaptive" || !model.ratios.includes(ratio)) setRatio("16:9");
    if (durationLocked) setDuration(-1); else setDuration((value) => Math.min(model.duration[1], Math.max(model.duration[0], value === -1 ? model.duration[0] : value)));
    if (!model.supportsAudio) setGenerateAudio(false);
    setAssets([]);
    setError("");
  }, [modelId, mode]);
  useEffect(() => {
    if (engine === "image") {
      const removed = assets.filter((asset) => asset.type !== "image");
      removed.forEach(cancelAssetTransfer);
      if (removed.length) setAssets((current) => current.filter((asset) => asset.type === "image"));
    }
    setError("");
  }, [engine]);
  useEffect(() => () => {
    for (const controller of uploadControllers.current.values()) controller.abort();
    uploadControllers.current.clear();
    for (const url of localPreviewUrls.current) URL.revokeObjectURL(url);
    localPreviewUrls.current.clear();
  }, []);
  useEffect(() => { const close = () => setOpen(null); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, []);
  if (!model) return null;

  const pickFiles = async (files: FileList | null) => {
    if (!files || (mode === "text" && engine === "video")) return;
    const plannedAssets = [...assets];
    const pendingUploads: { file: File; pending: UploadAsset; controller: AbortController }[] = [];
    for (const file of Array.from(files)) {
      const type = inferUploadType(file);
      if (!type) { setError(`不支持素材格式：${file.name}`); continue; }
      if (engine === "image" && type !== "image") { setError("图片生成只接受图片参考（图生图）"); continue; }
      if ((mode === "first_frame" || mode === "first_last") && type !== "image") { setError("首帧与首尾帧模式只接受图片"); continue; }
      if (mode === "first_frame" && plannedAssets.length >= 1) { setError("首帧模式只接受一张图片"); continue; }
      if (mode === "first_last" && plannedAssets.length >= 2) { setError("首尾帧模式只接受两张图片"); continue; }
      const allowed = type === "image" ? model.imageLimit : type === "video" ? model.videoLimit : model.audioLimit;
      if (!allowed || plannedAssets.filter((a) => a.type === type).length >= allowed) { setError(`当前模型最多支持 ${allowed} 个${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}参考`); continue; }
      const tempId = crypto.randomUUID();
      const role: UploadAsset["role"] = mode === "first_frame" ? "first_frame" : mode === "first_last" ? (plannedAssets.some((a) => a.role === "first_frame") ? "last_frame" : "first_frame") : type === "image" ? "reference_image" : type === "video" ? "reference_video" : "reference_audio";
      const preview = type === "image" ? URL.createObjectURL(file) : undefined;
      if (preview) localPreviewUrls.current.add(preview);
      const pending = { id: tempId, name: file.name, size: file.size, type, role, progress: 0, phase: type === "image" ? "preparing" : "uploading", preview } satisfies UploadAsset;
      plannedAssets.push(pending);
      const controller = new AbortController();
      uploadControllers.current.set(tempId, controller);
      pendingUploads.push({ file, pending, controller });
    }
    setAssets(plannedAssets);
    let cursor = 0;
    const failures: string[] = [];
    const uploadNext = async () => {
      while (cursor < pendingUploads.length) {
        const item = pendingUploads[cursor++];
        const { file, pending, controller } = item;
        const tempId = pending.id;
        const role = pending.role;
      try {
        const uploaded = await uploadFile(file, pending.type, (progress, phase) => setAssets((old) => old.map((a) => a.id === tempId ? { ...a, progress, phase } : a)), { signal: controller.signal });
        setAssets((old) => old.map((a) => a.id === tempId ? { ...a, ...uploaded, uploadId: uploaded.uploadId ?? uploaded.id, role, progress: 100, phase: "ready" } : a));
        } catch (e) {
          releaseLocalPreview(pending.preview);
          setAssets((old) => old.filter((a) => a.id !== tempId));
          if (!(e instanceof DOMException && e.name === "AbortError")) failures.push(`${file.name}：${e instanceof Error ? e.message : "上传失败"}`);
        } finally { uploadControllers.current.delete(tempId); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(3, pendingUploads.length) }, uploadNext));
    if (failures.length) setError(`${failures.length} 个素材上传失败：${failures.slice(0, 2).join("；")}${failures.length > 2 ? " 等" : ""}`);
    if (fileInput.current) fileInput.current.value = "";
  };

  const attachMentionAsset = (candidate: UploadAsset) => {
    if (candidate.status === "Processing") { setError("素材已经上传，生成引用仍在后台准备，完成后即可加入参考"); return null; }
    if (candidate.status === "Failed") { setError("素材处理失败，无法用作参考素材"); return null; }
    const existing = assets.find((asset) => asset.id === candidate.id || (candidate.assetId && asset.assetId === candidate.assetId));
    if (existing) return existing;
    const typeCount = assets.filter((asset) => asset.type === candidate.type).length;
    const allowed = candidate.type === "image" ? model.imageLimit : candidate.type === "video" ? model.videoLimit : model.audioLimit;
    if (!allowed || typeCount >= allowed) { setError(`当前模型最多支持 ${allowed} 个${candidate.type === "image" ? "图片" : candidate.type === "video" ? "视频" : "音频"}参考`); return null; }
    if (mode === "text" && engine === "video") { setError("文本生成模式不接受参考素材"); return null; }
    if (engine === "image" && candidate.type !== "image") { setError("图片生成只接受图片参考（图生图）"); return null; }
    if (mode === "first_frame" && (candidate.type !== "image" || assets.length)) { setError("首帧模式只接受一张图片"); return null; }
    if (mode === "first_last" && (candidate.type !== "image" || assets.length >= 2)) { setError("首尾帧模式只接受两张图片"); return null; }
    const role: UploadAsset["role"] = mode === "first_frame" ? "first_frame" : mode === "first_last" ? (assets.some((asset) => asset.role === "first_frame") ? "last_frame" : "first_frame") : candidate.type === "image" ? "reference_image" : candidate.type === "video" ? "reference_video" : "reference_audio";
    const attached = { ...candidate, role, progress: 100 };
    setAssets((old) => [...old, attached]); setError(""); return attached;
  };

  const submit = async () => {
    setLoading(true); setError("");
    try {
      if (engine === "image") {
        const spec = imageModels.find((item) => item.id === imageModelId) ?? imageModels[0];
        const references = assets.filter((asset) => asset.type === "image" && asset.uploadId).map((asset) => asset.uploadId!);
        const result = await api.post<ImageGenResponse>("/api/image-generation", { model: imageModelId, ratio: imageRatio, resolution: imageResolution, count: imageCount, prompt: prompt.trim(), references });
        onImagesGenerated?.({ id: crypto.randomUUID(), modelName: spec?.name ?? imageModelId, ratio: imageRatio, resolution: imageResolution, prompt: prompt.trim(), items: result.Items ?? [], createdAt: Date.now(), failed: result.Failed });
        setPrompt(""); clearAttachedAssets();
        return;
      }
      const task = await api.post<Task>("/api/generations", { prompt: materializePromptReferences(prompt, assets), model: model.id, mode, ratio, resolution, duration, generateAudio: model.supportsAudio && generateAudio, seed, cameraFixed, watermark, outputFormat: "mp4", assets: assets.map(({ preview, progress, size, ...asset }) => asset) });
      onCreated(task); setPrompt(""); clearAttachedAssets();
    } catch (e) { setError(e instanceof Error ? e.message : "无法创建任务"); } finally { setLoading(false); }
  };

  const uploadsReady = assets.every((asset) => asset.progress === 100);
  const modeReady = engine === "image" ? imageReady!
    : mode === "text" ? Boolean(prompt.trim())
    : mode === "first_frame" ? assets.length === 1 && assets[0]?.role === "first_frame"
    : mode === "first_last" ? assets.length === 2 && assets.some((asset) => asset.role === "first_frame") && assets.some((asset) => asset.role === "last_frame")
    : mode === "omni" ? assets.length > 0
    : Boolean(prompt.trim()) && assets.some((asset) => asset.type === "video");

  return <div className={`composer ${compact ? "composer--compact" : ""}`} onClick={(e) => e.stopPropagation()}>
    {!compact && <h1>今晚，想创造什么？</h1>}
    <div className="composer-shell">
      {!!assets.length && <div className="asset-strip">{assets.map((asset, index) => <div className="asset-chip" key={asset.id}>{asset.preview ? <img src={asset.preview} /> : asset.type === "video" ? <Video /> : <AudioLines />}<span><b>{asset.role === "first_frame" ? "首帧" : asset.role === "last_frame" ? "尾帧" : `${asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"} ${index + 1}`}</b><small>{asset.phase === "preparing" ? "正在检查图片" : asset.phase === "verifying" ? "上传完成 · 正在确认" : asset.progress === 100 ? `${asset.name}${asset.normalized ? " · 已自动补白" : ""}` : `上传 ${asset.progress ?? 0}%`}</small></span>{asset.progress !== 100 && <i style={{ width: `${asset.progress ?? 0}%` }} />}<button onClick={() => removeAttachedAsset(asset.id)}><X /></button></div>)}</div>}
      <div className={`prompt-row ${referenceSlots.length > 1 ? "prompt-row--dual" : ""} ${!referenceSlots.length ? "prompt-row--text" : ""}`}>
        {!!referenceSlots.length && <div className="reference-slots">{referenceSlots.map((label, index) => <button className="add-reference" key={label} onClick={() => fileInput.current?.click()} disabled={(mode === "first_frame" && assets.length >= 1) || (mode === "first_last" && assets.length > index)}><Plus /><span>{label}</span></button>)}</div>}
        <PromptEditor value={prompt} change={setPrompt} placeholder={engine === "image" ? "描述你想生成的画面；上传参考图即可进行图生图……" : modePlaceholders[mode]} assets={assets} disabled={mode === "text" && engine === "video"} attach={attachMentionAsset} />
        <input ref={fileInput} hidden type="file" multiple={mode !== "first_frame"} accept={fileAccept} onChange={(e) => pickFiles(e.target.files)} />
      </div>
      <div className="control-row">
        <div className="control-wrap"><button className="control control--accent" onClick={() => setOpen(open === "generation" ? null : "generation")}><WandSparkles /> {engine === "video" ? "视频生成" : "图片生成"} <ChevronDown /></button>{open === "generation" && <Popover className="mode-pop generation-pop"><p>选择创作类型</p><button className={engine === "video" ? "selected" : ""} aria-pressed={engine === "video"} onClick={() => { setEngine("video"); setOpen(null); }}><span className="model-icon"><Film /></span><span><b>视频生成</b><small>使用 Seedance 生成或编辑视频</small></span>{engine === "video" && <Check />}</button><button className={engine === "image" ? "selected" : ""} aria-pressed={engine === "image"} onClick={() => { setEngine("image"); setOpen(null); }}><span className="model-icon"><ImageIcon /></span><span><b>图片生成</b><small>支持文生图与图生图</small></span>{engine === "image" && <Check />}</button></Popover>}</div>
        {engine === "image" ? <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "image-model" ? null : "image-model")}><Layers3 /> {(imageSpec?.name ?? "选择图片模型")} <ChevronDown /></button>{open === "image-model" && <Popover className="model-pop image-model-pop"><p>选择图片模型</p>{imageModels.map((item) => <button key={item.id} className={item.id === imageModelId ? "selected" : ""} onClick={() => { setImageModelId(item.id); setImageResolution(item.resolutions.includes(imageResolution) ? imageResolution : (item.resolutions.includes("1024") ? "1024" : item.resolutions[item.resolutions.length - 1])); setImageCount((count) => Math.min(count, item.maxCount)); setOpen(null); }}><span className="model-icon"><ImageIcon /></span><span><b>{item.name}</b><small>{item.resolutions.join(" / ")}px · 单次最多 {item.maxCount} 张</small></span>{item.id === imageModelId && <Check />}</button>)}</Popover>}</div> : <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "model" ? null : "model")}><Layers3 /> {model.name} <Sparkles className="tiny-spark" /></button>{open === "model" && <Popover className="model-pop"><p>选择模型</p>{models.map((item) => <button key={item.id} className={item.id === model.id ? "selected" : ""} onClick={() => { setModelId(item.id); setOpen(null); }}><span className="model-icon"><Sparkles /></span><span><b>{item.name}</b><small>{item.note}</small></span>{item.id === model.id && <Check />}</button>)}</Popover>}</div>}
        {engine === "image" ? (
          <>
            <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "image-format" ? null : "image-format")}><ImageIcon /> {imageRatio} <i /> {imageResolution}px <i /> ×{imageCount} <ChevronDown /></button>{open === "image-format" && <Popover className="format-pop image-format-pop"><p>选择比例</p><div className="ratio-grid">{[["21:9", "21:9"], ["16:9", "16:9"], ["3:2", "3:2"], ["4:3", "4:3"], ["1:1", "1:1"], ["3:4", "3:4"], ["2:3", "2:3"], ["9:16", "9:16"]].map(([value, label]) => <button className={imageRatio === value ? "selected" : ""} key={value} onClick={() => setImageRatio(value)}><span className={`ratio-icon ratio-${value.replace(":", "-")}`} />{label}</button>)}</div><p>选择分辨率</p><div className="resolution-grid">{(imageSpec?.resolutions ?? ["1024"]).map((item) => <button className={imageResolution === item ? "selected" : ""} onClick={() => setImageResolution(item)} key={item}>{item}px</button>)}</div><p>生成数量</p><div className="image-count-grid">{Array.from({ length: imageSpec?.maxCount ?? 4 }, (_, index) => index + 1).map((count) => <button className={imageCount === count ? "selected" : ""} onClick={() => setImageCount(count)} key={count}>{count} 张</button>)}</div></Popover>}</div>
            <div className="control-wrap"><button className="control control--icon" aria-label="选择参考图" onClick={() => setOpen(open === "library" ? null : "library")}>@</button>{open === "library" && <LibraryPanel add={(asset) => { attachMentionAsset(asset); setOpen(null); }} />}</div>
          </>
        ) : (
          <>
        <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "mode" ? null : "mode")}><Clapperboard /> {modeLabels[mode]} <ChevronDown /></button>{open === "mode" && <Popover className="mode-pop">{model.modes.map((item) => <button key={item} className={item === mode ? "selected" : ""} onClick={() => { setMode(item); setOpen(null); }}><Film /><span><b>{modeLabels[item]}</b><small>{modeNotes[item]}</small></span>{item === mode && <Check />}</button>)}</Popover>}</div>
        <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "format" ? null : "format")}><span className={`ratio-icon ${ratio === "adaptive" ? "ratio-adaptive" : `ratio-${ratio.replace(":", "-")}`}`} /> {ratio === "adaptive" ? "自动" : ratio} <i /> {resolution}</button>{open === "format" && <Popover className="format-pop"><p>选择画幅</p><div className="ratio-grid">{availableRatios.map((item) => <button className={item === ratio ? "selected" : ""} key={item} onClick={() => !ratioLocked && setRatio(item)}><span className={`ratio-icon ${item === "adaptive" ? "ratio-adaptive" : `ratio-${item.replace(":", "-")}`}`} />{item === "adaptive" ? "自动" : item}</button>)}</div><p>选择清晰度</p><div className="resolution-grid">{model.resolutions.map((item) => <button className={item === resolution ? "selected" : ""} onClick={() => setResolution(item)} key={item}>{item}{item === "720p" && <Sparkles />}</button>)}</div></Popover>}</div>
        <div className="control-wrap"><button className="control" disabled={durationLocked} onClick={() => !durationLocked && setOpen(open === "duration" ? null : "duration")}><Clock3 /> {durationLocked ? "自动" : `${duration}s`}</button>{open === "duration" && !durationLocked && <Popover className="duration-pop"><p>视频生成时长</p><input type="range" min={model.duration[0]} max={model.duration[1]} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /><div className="duration-scale"><span>{model.duration[0]}s</span><b>{duration} 秒</b><span>{model.duration[1]}s</span></div></Popover>}</div>
        {(["omni", "edit", "extend"] as CreationMode[]).includes(mode) && <div className="control-wrap"><button className="control control--icon" aria-label="选择素材" onClick={() => setOpen(open === "library" ? null : "library")}>@</button>{open === "library" && <LibraryPanel add={(asset) => { attachMentionAsset(asset); setOpen(null); }} />}</div>}
        <div className="control-wrap"><button className="control control--icon" aria-label="高级设置" onClick={() => setOpen(open === "advanced" ? null : "advanced")}><Settings2 /></button>{open === "advanced" && <Popover className="advanced-pop">{model.supportsAudio && <label><span>生成同步音频<small>由模型创作对白与环境声</small></span><input type="checkbox" checked={generateAudio} onChange={(e) => setGenerateAudio(e.target.checked)} /></label>}<label><span>固定镜头<small>减少镜头运动</small></span><input type="checkbox" checked={cameraFixed} onChange={(e) => setCameraFixed(e.target.checked)} /></label><label><span>显示水印<small>添加官方生成标识</small></span><input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /></label><label className="seed-input"><span>随机种子<small>-1 为随机</small></span><input type="number" min="-1" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label></Popover>}</div>
        <span className="control-spacer" />
          </>
        )}
        <button className="send-button" aria-label={engine === "image" ? "生成图片" : "生成视频"} disabled={loading || !uploadsReady || !modeReady} onClick={submit}>{loading ? <LoaderCircle className="spin" /> : <Send />}</button>
      </div>
      {error && <div className="composer-error">{error}</div>}
    </div>
  </div>;
}

function LibraryPanel({ add }: { add: (asset: UploadAsset) => void }) {
  const [groups, setGroups] = useState<LibraryGroup[]>([]); const [assets, setAssets] = useState<LibraryAsset[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [creating, setCreating] = useState(false); const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null); const [groupName, setGroupName] = useState(""); const [rights, setRights] = useState(false); const libraryFile = useRef<HTMLInputElement>(null);
  const batchControllers = useRef(new Set<AbortController>());
  useEffect(() => { Promise.all([api.get<{ Items?: LibraryGroup[] }>("/api/assets/groups"), api.get<{ Items?: LibraryAsset[] }>("/api/assets")]).then(([g, a]) => { setGroups(g.Items ?? []); setAssets(a.Items ?? []); }).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => () => { for (const controller of batchControllers.current) controller.abort(); batchControllers.current.clear(); }, []);
  useEffect(() => {
    const processing = assets.filter((asset) => asset.Status === "Processing");
    if (!processing.length) return;
    const refresh = () => void Promise.all(processing.map((asset) => api.get<LibraryAsset>(`/api/assets/${asset.Id}`).catch(() => asset))).then((updates) => setAssets((current) => current.map((asset) => updates.find((update) => update.Id === asset.Id) ?? asset)));
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [assets.map((asset) => `${asset.Id}:${asset.Status}`).join("|")]);
  const createGroup = async () => { if (!groupName.trim()) return; setCreating(true); setError(""); try { const result = await api.post<{ Id: string }>("/api/assets/groups", { name: groupName, description: "Created by Firefly" }); setGroups((old) => [{ Id: result.Id, Name: groupName }, ...old]); setGroupName(""); } catch (e) { setError(e instanceof Error ? e.message : "无法创建角色分组"); } finally { setCreating(false); } };
  const ingest = async (selected?: FileList | null) => {
    const files = Array.from(selected ?? []);
    if (!files.length || !groups[0] || !rights) return;
    if (files.length > 50) { setError("单次最多选择 50 个素材，请分批上传"); if (libraryFile.current) libraryFile.current.value = ""; return; }
    setCreating(true); setError(""); setNotice(""); setBatchProgress({ done: 0, total: files.length });
    const failures: string[] = []; let normalizedCount = 0; let cursor = 0;
    const uploadNext = async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        const controller = new AbortController(); batchControllers.current.add(controller);
        try {
          const type = inferUploadType(file);
          if (!type) throw new Error("不支持此素材格式");
           const uploaded = await uploadFile(file, type, () => undefined, { signal: controller.signal });
           if (uploaded.normalized) normalizedCount += 1;
           const result = await api.post<LibraryAsset>("/api/assets", { groupId: groups[0].Id, uploadId: uploaded.uploadId ?? uploaded.id, url: "url" in uploaded ? uploaded.url : undefined, type: `${type[0].toUpperCase()}${type.slice(1)}`, name: file.name, category: "character" });
           setAssets((old) => [result, ...old]);
        } catch (uploadError) { failures.push(`${file.name}（${uploadError instanceof Error ? uploadError.message.split(" · ")[0].slice(0, 60) : "上传失败"}）`); }
        finally { batchControllers.current.delete(controller); setBatchProgress((progress) => progress ? { ...progress, done: progress.done + 1 } : progress); }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, uploadNext));
      const succeeded = files.length - failures.length;
      if (succeeded) setNotice(`${succeeded} 个素材已上传，生成引用正在后台准备${normalizedCount ? `；${normalizedCount} 张图片已自动补白` : ""}`);
      if (failures.length) setError(`${failures.length} 个素材上传失败：${failures.slice(0, 3).join("、")}${failures.length > 3 ? " 等" : ""}`);
    } finally {
      setCreating(false); setBatchProgress(null); if (libraryFile.current) libraryFile.current.value = "";
    }
  };
  return <Popover className="library-pop"><div className="popover-title"><span><Library /> 可信角色库</span><small>AI 角色素材</small></div>{loading ? <div className="panel-state"><LoaderCircle className="spin" /> 正在读取角色库</div> : error && !groups.length ? <div className="panel-state panel-state--error">{error}</div> : <>{assets.length ? <div className="library-list">{assets.map((asset) => <button key={asset.Id} disabled={asset.Status !== "Active"} title={asset.Error} onClick={() => add({ id: asset.Id, assetId: asset.Id, name: asset.Name || asset.Id, type: asset.AssetType.toLowerCase() as UploadAsset["type"], size: 0, role: asset.AssetType === "Image" ? "reference_image" : asset.AssetType === "Video" ? "reference_video" : "reference_audio", progress: 100, preview: asset.URL, status: asset.Status })}>{asset.URL && asset.AssetType === "Image" ? <img src={asset.URL} /> : <span className="library-thumb"><Sparkles /></span>}<span><b>{asset.Name || "未命名角色"}</b><small>{asset.Status === "Processing" ? "已上传 · 引用准备中" : asset.Status === "Failed" ? "已上传 · 引用准备失败" : groups.find((g) => g.Id === asset.GroupId)?.Name ?? asset.AssetType}</small></span><i className={`status-dot status-${asset.Status.toLowerCase()}`} /> </button>)}</div> : <div className="panel-state panel-state--short"><Library /><b>还没有可用角色</b><small>创建分组后上传你的 AI 角色素材</small></div>}<div className="library-create">{groups.length ? <><label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> 我确认素材为 AI 角色且拥有完整权利</label><button disabled={!rights || creating} onClick={() => libraryFile.current?.click()}>{creating ? <LoaderCircle className="spin" /> : <Upload />} {creating && batchProgress ? `正在上传 ${batchProgress.done}/${batchProgress.total}` : `批量上传到「${groups[0].Name}」`}</button><input hidden ref={libraryFile} type="file" multiple accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav" onChange={(e) => void ingest(e.target.files)} /></> : <><input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="输入第一个角色分组名称" /><button disabled={creating || !groupName.trim()} onClick={createGroup}><Plus /> 创建角色分组</button></>}{notice && <small className="library-success">{notice}</small>}{error && <small className="library-error">{error}</small>}</div></>}</Popover>;
}

type MediaState = "idle" | "loading" | "ready" | "buffering" | "error";
type MediaEventName = "metadata" | "canplay" | "playing" | "waiting" | "stalled" | "error" | "download_click";

const reportMediaEvent = (taskId: string, event: MediaEventName, startedAt: number, video?: HTMLVideoElement, bufferingMs?: number) => {
  let bufferedAhead: number | undefined;
  if (video) {
    for (let index = 0; index < video.buffered.length; index++) {
      if (video.buffered.start(index) <= video.currentTime && video.buffered.end(index) >= video.currentTime) {
        bufferedAhead = Math.max(0, video.buffered.end(index) - video.currentTime);
        break;
      }
    }
  }
  void api.post("/api/media-events", {
    taskId,
    event,
    elapsedMs: Math.min(24 * 3600 * 1000, Math.max(0, Date.now() - startedAt)),
    readyState: video?.readyState,
    networkState: video?.networkState,
    currentTime: video && Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : undefined,
    bufferedAhead,
    bufferingMs
  }).catch(() => undefined);
};

const copyPlainText = async (text: string) => {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const input = document.createElement("textarea"); input.value = text; input.setAttribute("readonly", ""); input.style.position = "fixed"; input.style.opacity = "0";
    document.body.append(input); input.select(); const copied = document.execCommand("copy"); input.remove(); return copied;
  }
};

function CaseIdButton({ task, compact = false }: { task: Task; compact?: boolean }) {
  const [copied, setCopied] = useState(false); const resetTimer = useRef<number | null>(null); const caseId = task.caseId || task.id;
  useEffect(() => () => { if (resetTimer.current !== null) window.clearTimeout(resetTimer.current); }, []);
  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const success = await copyPlainText(caseId); setCopied(success);
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => setCopied(false), 2200);
  };
  return <button className={`case-id-button ${compact ? "case-id-button--compact" : ""} ${copied ? "is-copied" : ""}`} onClick={copy} title={`复制 Case ID：${caseId}`} aria-label={`复制 Case ID ${caseId}`}>{copied ? <Check /> : <Copy />}{!compact && <span>{copied ? "已复制" : `Case ${caseId.slice(0, 8)}`}</span>}</button>;
}

function TaskCard({ task, models, eager, now, onDelete, canDelete = false }: { task: Task; models: ModelCapability[]; eager: boolean; now: number; onDelete: (task: Task) => void; canDelete?: boolean }) {
  const model = models.find((item) => item.id === task.model);
  const temporaryAvailable = Boolean(task.temporaryVideoUrl && (!task.temporaryVideoExpiresAt || task.temporaryVideoExpiresAt > now));
  const expired = false;
  const mediaFailed = task.status === "succeeded" && task.mediaStatus === "failed";
  const [quoteIndex, setQuoteIndex] = useState(() => Math.abs(task.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % waitingMoments.length);
  const cardRef = useRef<HTMLElement>(null); const retryTimer = useRef<number | null>(null); const bufferWatchdog = useRef<number | null>(null); const automaticRecoveries = useRef(0); const readyOnce = useRef(false); const loadStartedAt = useRef(Date.now()); const bufferingStartedAt = useRef<number | null>(null); const resumeTime = useRef(0);
  const [nearViewport, setNearViewport] = useState(eager); const [mediaState, setMediaState] = useState<MediaState>("idle"); const [retryCount, setRetryCount] = useState(0); const [downloadNotice, setDownloadNotice] = useState(""); const [copyNotice, setCopyNotice] = useState("");
  const shouldLoadVideo = task.status === "succeeded" && Boolean(task.videoUrl) && (eager || nearViewport);
  const reportTaskMediaEvent = (event: MediaEventName, video?: HTMLVideoElement, bufferingMs?: number) => reportMediaEvent(task.id, event, loadStartedAt.current, video, bufferingMs);
  useEffect(() => {
    if (["succeeded", "failed"].includes(task.status)) return;
    const timer = window.setInterval(() => setQuoteIndex((index) => (index + 1) % waitingMoments.length), 5600);
    return () => window.clearInterval(timer);
  }, [task.status]);
  useEffect(() => {
    if (eager) { setNearViewport(true); return; }
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === "undefined") { setNearViewport(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setNearViewport(true); observer.disconnect(); }
    }, { rootMargin: "480px 0px", threshold: 0.01 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [eager]);
  useEffect(() => {
    if (!shouldLoadVideo) return;
    loadStartedAt.current = Date.now(); setMediaState("loading");
    return () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); };
  }, [shouldLoadVideo, task.videoUrl, task.mediaRevision]);
  useEffect(() => {
    readyOnce.current = false; resumeTime.current = 0; bufferingStartedAt.current = null; automaticRecoveries.current = 0; setRetryCount(0);
  }, [task.id, task.mediaRevision]);
  useEffect(() => {
    const resume = () => { if (mediaState === "error" && shouldLoadVideo) retryMedia(); };
    window.addEventListener("online", resume);
    return () => window.removeEventListener("online", resume);
  }, [mediaState, shouldLoadVideo]);
  const waitingMoment = waitingMoments[quoteIndex];
  const clearBufferWatchdog = () => { if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); bufferWatchdog.current = null; };
  const retryMedia = () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); clearBufferWatchdog(); setMediaState("loading"); setRetryCount((count) => count + 1); };
  const beginBufferRecovery = (video: HTMLVideoElement, event: "waiting" | "stalled") => {
    if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return;
    bufferingStartedAt.current = Date.now(); setMediaState("buffering"); reportTaskMediaEvent(event, video);
    clearBufferWatchdog();
    bufferWatchdog.current = window.setTimeout(() => {
      bufferWatchdog.current = null;
      if (!navigator.onLine) { setMediaState("error"); return; }
      if (video.paused || video.ended) return;
      if (Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
      if (automaticRecoveries.current >= 2) { setMediaState("error"); return; }
      automaticRecoveries.current += 1; bufferingStartedAt.current = null; setMediaState("loading"); setRetryCount((count) => count + 1);
    }, 15_000);
  };
  const handleMediaError = (video: HTMLVideoElement) => {
    clearBufferWatchdog();
    reportTaskMediaEvent("error", video);
    if (readyOnce.current && Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
    if (!navigator.onLine) { setMediaState("error"); return; }
    if (!readyOnce.current && retryCount < 2 && !expired) {
      setMediaState("loading");
      retryTimer.current = window.setTimeout(() => setRetryCount((count) => count + 1), [2000, 6000][retryCount]);
      return;
    }
    setMediaState("error");
  };
  const copyVideoLink = async () => {
    if (!task.videoUrl) return;
    try { await navigator.clipboard.writeText(new URL(task.videoUrl, window.location.origin).href); setCopyNotice("链接已复制"); } catch { setCopyNotice("复制失败，请使用下载按钮"); }
    window.setTimeout(() => setCopyNotice(""), 2400);
  };
  return <article id={`task-${task.id}`} ref={cardRef} className={`task-card task-card--${task.status}${mediaFailed ? " task-card--media-failed" : ""}`}>
    <header><div><span className="status-pulse" /><b>{taskStatusText(task)}</b><small>{new Date(task.createdAt).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small>{task.visibility === "shared" && <small className="shared-mark">团队历史</small>}</div><span>{model?.name ?? task.model} · {task.ratio} · {task.resolution} · {task.duration}s <CaseIdButton task={task} />{canDelete && <button className="task-delete" title="删除项目" onClick={() => onDelete(task)}><Trash2 /></button>}</span></header>
    <p>{task.prompt || "基于参考素材生成"}</p>
    {task.status === "succeeded" && task.videoUrl ? <div className="video-result"><div className="video-stage">{shouldLoadVideo && <video key={`${task.id}-${task.mediaRevision ?? 0}-${retryCount}`} src={task.videoUrl} poster={task.posterUrl} controls playsInline preload={eager ? "auto" : "metadata"} onLoadedMetadata={(event) => { const video = event.currentTarget; if (resumeTime.current > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resumeTime.current, Math.max(0, video.duration - 0.1)); reportTaskMediaEvent("metadata", video); }} onCanPlay={(event) => { const firstCanPlay = !readyOnce.current; readyOnce.current = true; setMediaState("ready"); if (firstCanPlay) reportTaskMediaEvent("canplay", event.currentTarget); }} onPlaying={(event) => { clearBufferWatchdog(); const bufferingMs = bufferingStartedAt.current === null ? undefined : Math.min(3600 * 1000, Date.now() - bufferingStartedAt.current); bufferingStartedAt.current = null; setMediaState("ready"); reportTaskMediaEvent("playing", event.currentTarget, bufferingMs); }} onWaiting={(event) => beginBufferRecovery(event.currentTarget, "waiting")} onStalled={(event) => beginBufferRecovery(event.currentTarget, "stalled")} onError={(event) => handleMediaError(event.currentTarget)} />}{(!shouldLoadVideo || mediaState !== "ready") && <div className={`video-loading video-loading--${mediaState}`} aria-live="polite"><div className="film-window"><Film /><span /><i /></div><b>{expired ? "预览链接已过期" : mediaState === "error" ? navigator.onLine ? "预览连接失败" : "网络连接已断开" : mediaState === "buffering" ? "正在继续缓冲" : shouldLoadVideo ? "正在载入第一帧" : "靠近时自动载入预览"}</b><small>{expired ? "成片正在重新归档，请稍后再试" : mediaState === "error" ? navigator.onLine ? "播放位置已保留，可重新加载预览" : "网络恢复后将自动重新连接" : "Firefly 正在从北京媒体存储准备画面"}</small>{mediaState === "error" && !expired && navigator.onLine && <button onClick={retryMedia}><RefreshCw /> 重新加载预览</button>}</div>}</div><div className="video-result__footer"><span>{expired ? "预览链接已过期" : downloadNotice || (task.mediaSource === "upstream" ? "临时源预览中，归档完成后将提供稳定入口" : "成片已安全归档，可随时预览与下载")}</span><div className="video-actions">{!expired && <button title="复制受保护的预览入口" onClick={copyVideoLink}><Copy /> {copyNotice || "复制入口"}</button>}{expired ? <button disabled><Download /> 下载暂不可用</button> : <a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" onClick={() => { setDownloadNotice("已交给浏览器下载器，可在下载列表中继续"); reportTaskMediaEvent("download_click"); }}><Download /> 下载视频</a>}</div></div></div> : task.status === "failed" ? <div className="task-error">{task.error ?? "生成失败，请检查素材与参数后重试"}</div> : <div className={`generation-visual ${mediaFailed ? "generation-visual--recovery" : ""}`}><div className="film-window"><Film /><span /><i /></div><div className="progress-copy"><div className="waiting-quote" aria-live="polite" key={quoteIndex}><b>{mediaFailed ? "成片尚未完成安全归档" : task.status === "succeeded" && task.mediaStatus === "archiving" ? "正在归档到北京 TOS" : task.status === "queued" ? "正在等待一束空闲的算力" : waitingMoment.title}</b><small>{mediaFailed ? "不会使用临时源；系统将在有效期内自动重试" : task.status === "succeeded" && task.mediaStatus === "archiving" ? "完成校验后将自动开放预览与下载" : task.status === "queued" ? "已进入安全队列，可以放心离开页面" : waitingMoment.detail}</small></div><code>{task.providerId ? `TASK / ${task.providerId.slice(0, 18)}…` : "SECURELY SUBMITTING PARAMETERS"}</code></div></div>}
    {task.status === "succeeded" && !task.videoUrl && temporaryAvailable && <button className="temporary-preview-button" onClick={() => window.open(task.temporaryVideoUrl, "_blank", "noopener,noreferrer")}><Play /> 立即预览临时源（可能卡顿）</button>}
  </article>;
}

function UserAvatar({ user }: { user: SessionUser }) {
  const initials = (user.name || user.email).trim().slice(0, 1).toUpperCase();
  return user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span>{initials}</span>;
}

function AccountMenu({ user, close, home, logout }: { user: SessionUser; close: () => void; home: () => void; logout: () => void }) {
  return <div className="account-menu" role="menu" aria-label="账号菜单" onClick={(event) => event.stopPropagation()}>
    <div className="account-menu__identity"><div className="account-menu__avatar"><UserAvatar user={user} /></div><span><b>{user.name}</b><small>{user.email}</small></span></div>
    <div className="account-menu__space"><span>企业创作空间</span><small>项目与成片仅你可见</small></div>
    <div className="account-menu__actions">
      <button role="menuitem" onClick={() => { close(); home(); }}><Home /><span>返回首页</span><ChevronRight /></button>
      <button role="menuitem" onClick={() => { close(); logout(); }}><LogOut /><span>退出登录</span></button>
    </div>
  </div>;
}

function AssetPreview({ task, close, onDelete, initialTime, onPosition }: { task: Task; close: () => void; onDelete: (task: Task) => void; initialTime: number; onPosition: (time: number) => void }) {
  const [state, setState] = useState<MediaState>("loading"); const [retryCount, setRetryCount] = useState(0); const [downloadNotice, setDownloadNotice] = useState("");
  const startedAt = useRef(Date.now()); const readyOnce = useRef(false); const bufferingStartedAt = useRef<number | null>(null); const resumeTime = useRef(initialTime); const retryTimer = useRef<number | null>(null); const bufferWatchdog = useRef<number | null>(null); const automaticRecoveries = useRef(0); const dialogRef = useRef<HTMLDivElement>(null); const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); }, []);
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>("[data-modal-initial]")?.focus());
    return () => { document.body.style.overflow = previousOverflow; opener?.focus(); };
  }, []);
  useEffect(() => () => {
    const time = videoRef.current?.currentTime;
    if (typeof time === "number" && Number.isFinite(time)) onPosition(Math.max(0, time));
  }, []);
  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],video[controls],[tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const clearBufferWatchdog = () => { if (bufferWatchdog.current !== null) window.clearTimeout(bufferWatchdog.current); bufferWatchdog.current = null; };
  const retry = () => { if (retryTimer.current !== null) window.clearTimeout(retryTimer.current); clearBufferWatchdog(); setState("loading"); setRetryCount((count) => count + 1); };
  useEffect(() => { const reconnect = () => { if (state === "error") retry(); }; window.addEventListener("online", reconnect); return () => window.removeEventListener("online", reconnect); }, [state]);
  const failed = (video: HTMLVideoElement) => {
    clearBufferWatchdog();
    reportMediaEvent(task.id, "error", startedAt.current, video);
    if (readyOnce.current && Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
    if (!readyOnce.current && retryCount < 2 && navigator.onLine) {
      setState("loading"); retryTimer.current = window.setTimeout(() => setRetryCount((count) => count + 1), [2000, 6000][retryCount]); return;
    }
    setState("error");
  };
  const beginBufferRecovery = (video: HTMLVideoElement, event: "waiting" | "stalled") => {
    if (!readyOnce.current || (video.paused && !video.seeking) || bufferingStartedAt.current !== null) return;
    bufferingStartedAt.current = Date.now(); setState("buffering"); reportMediaEvent(task.id, event, startedAt.current, video);
    clearBufferWatchdog();
    bufferWatchdog.current = window.setTimeout(() => {
      bufferWatchdog.current = null;
      if (!navigator.onLine) { setState("error"); return; }
      if (video.paused || video.ended) return;
      if (Number.isFinite(video.currentTime)) resumeTime.current = Math.max(0, video.currentTime);
      if (automaticRecoveries.current >= 2) { setState("error"); return; }
      automaticRecoveries.current += 1; bufferingStartedAt.current = null; setState("loading"); setRetryCount((count) => count + 1);
    }, 15_000);
  };
  return <div className="asset-preview-backdrop" role="dialog" aria-modal="true" aria-labelledby="asset-preview-title" onClick={close}>
    <div ref={dialogRef} className="asset-preview" onKeyDown={handleDialogKeyDown} onClick={(event) => event.stopPropagation()}>
      <header><div><span>视频预览</span><h2 id="asset-preview-title">{task.prompt || "参考素材生成"}</h2></div><button data-modal-initial aria-label="关闭预览" onClick={close}><X /></button></header>
      <div className="asset-preview__stage">
        <video ref={videoRef} key={`${task.id}-${task.mediaRevision ?? 0}-${retryCount}`} src={task.videoUrl} poster={task.posterUrl} controls playsInline preload="auto" onLoadedMetadata={(event) => { const video = event.currentTarget; if (resumeTime.current > 0 && Number.isFinite(video.duration) && resumeTime.current < video.duration - 1) video.currentTime = Math.min(resumeTime.current, Math.max(0, video.duration - 0.1)); reportMediaEvent(task.id, "metadata", startedAt.current, video); }} onTimeUpdate={(event) => { const time = event.currentTarget.currentTime; if (Number.isFinite(time)) onPosition(Math.max(0, time)); }} onEnded={() => onPosition(0)} onCanPlay={(event) => { const firstCanPlay = !readyOnce.current; readyOnce.current = true; setState("ready"); if (firstCanPlay) reportMediaEvent(task.id, "canplay", startedAt.current, event.currentTarget); }} onPlaying={(event) => { clearBufferWatchdog(); const bufferingMs = bufferingStartedAt.current === null ? undefined : Math.min(3600 * 1000, Date.now() - bufferingStartedAt.current); bufferingStartedAt.current = null; setState("ready"); reportMediaEvent(task.id, "playing", startedAt.current, event.currentTarget, bufferingMs); }} onWaiting={(event) => beginBufferRecovery(event.currentTarget, "waiting")} onStalled={(event) => beginBufferRecovery(event.currentTarget, "stalled")} onError={(event) => failed(event.currentTarget)} />
        {state !== "ready" && <div className={`asset-preview__status asset-preview__status--${state}`} aria-live="polite"><div className="film-window"><Film /><span /><i /></div><b>{state === "error" ? navigator.onLine ? "预览连接失败" : "网络连接已断开" : state === "buffering" ? "正在继续缓冲" : "正在载入成片"}</b><small>{state === "error" ? navigator.onLine ? "播放位置已保留，可重新加载" : "网络恢复后将自动重新连接" : "正在从北京媒体存储准备画面"}</small>{state === "error" && navigator.onLine && <button onClick={retry}><RefreshCw /> 重新加载</button>}</div>}
      </div>
      <footer><span>{downloadNotice || `${new Date(task.createdAt).toLocaleString("zh-CN")} · ${task.resolution} · ${task.ratio}`}</span><div><CaseIdButton task={task} /><button onClick={() => { close(); onDelete(task); }}><Trash2 /> 删除</button><a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" onClick={() => { setDownloadNotice("已交给浏览器下载器，可在下载列表中继续"); reportMediaEvent(task.id, "download_click", startedAt.current); }}><Download /> 下载视频</a></div></footer>
    </div>
  </div>;
}

function ImageAssetManager({ onInsertCanvas }: { onInsertCanvas: (asset: LibraryAsset) => void }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([]); const [group, setGroup] = useState<LibraryGroup | null>(null); const [query, setQuery] = useState(""); const [category, setCategory] = useState<"all" | AssetCategory>("all"); const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false); const [uploading, setUploading] = useState(false); const [progress, setProgress] = useState<{ done: number; total: number } | null>(null); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set()); const [editingId, setEditingId] = useState<string | null>(null); const [draftName, setDraftName] = useState(""); const [categorizing, setCategorizing] = useState<Set<string>>(new Set()); const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null); const requestSequence = useRef(0); const renaming = useRef(new Set<string>()); const cancelRename = useRef(false); const uploadControllers = useRef(new Set<AbortController>());
  const loadPage = async (requestedPage: number, replace: boolean, search = query) => {
    const sequence = ++requestSequence.current; replace ? setLoading(true) : setLoadingMore(true); setError("");
    try {
      const categoryQuery = category === "all" ? "" : `&category=${category}`;
      const result = await api.get<{ Items?: LibraryAsset[]; HasMore?: boolean }>(`/api/assets?type=Image&page=${requestedPage}&pageSize=60&q=${encodeURIComponent(search.trim())}${categoryQuery}`);
      if (sequence !== requestSequence.current) return;
      setAssets((current) => replace ? (result.Items ?? []) : [...current, ...(result.Items ?? []).filter((asset) => !current.some((item) => item.Id === asset.Id))]);
      setPage(requestedPage); setHasMore(Boolean(result.HasMore));
      if (replace) setSelected(new Set());
    } catch (loadError) { if (sequence === requestSequence.current) setError(loadError instanceof Error ? loadError.message : "图片资产载入失败"); }
    finally { if (sequence === requestSequence.current) { setLoading(false); setLoadingMore(false); } }
  };
  useEffect(() => { void api.get<{ Items?: LibraryGroup[] }>("/api/assets/groups").then((result) => setGroup(result.Items?.[0] ?? null)).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "素材空间暂时不可用")); }, []);
  useEffect(() => () => { for (const controller of uploadControllers.current) controller.abort(); uploadControllers.current.clear(); }, []);
  useEffect(() => { const timer = window.setTimeout(() => void loadPage(1, true, query), query ? 260 : 0); return () => window.clearTimeout(timer); }, [query, category]);
  useEffect(() => {
    const processing = assets.filter((asset) => asset.Status === "Processing");
    if (!processing.length) return;
    const refresh = () => void Promise.all(processing.map((asset) => api.get<LibraryAsset>(`/api/assets/${asset.Id}`).catch(() => asset))).then((updates) => setAssets((current) => current.map((asset) => updates.find((update) => update.Id === asset.Id) ?? asset)));
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [assets.map((asset) => `${asset.Id}:${asset.Status}`).join("|")]);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const allSelected = assets.length > 0 && assets.every((asset) => selected.has(asset.Id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(assets.map((asset) => asset.Id)));
  const uploadImages = async (files?: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    const images = selectedFiles.filter((file) => inferUploadType(file) === "image");
    if (!images.length || !group) { if (selectedFiles.length) setError("所选文件中没有受支持的图片"); return; }
    if (images.length > 50) { setError("单次最多上传 50 张图片"); if (fileInput.current) fileInput.current.value = ""; return; }
    setUploading(true); setProgress({ done: 0, total: images.length }); setError(""); setNotice(""); const created: LibraryAsset[] = []; let normalizedCount = 0; const failures: string[] = selectedFiles.filter((file) => !images.includes(file)).map((file) => `${file.name}（不支持的格式）`); let cursor = 0;
    const uploadCategory: AssetCategory = category === "all" ? "material" : category;
    const next = async () => { while (cursor < images.length) { const file = images[cursor++]; if (!file) continue; const controller = new AbortController(); uploadControllers.current.add(controller); try { const uploaded = await uploadFile(file, "image", () => undefined, { signal: controller.signal }); if (uploaded.normalized) normalizedCount += 1; const asset = await api.post<LibraryAsset>("/api/assets", { groupId: group.Id, uploadId: uploaded.uploadId ?? uploaded.id, type: "Image", name: file.name, category: uploadCategory }); created.push(asset); } catch (uploadError) { failures.push(`${file.name}（${uploadError instanceof Error ? uploadError.message.split(" · ")[0].slice(0, 60) : "上传失败"}）`); } finally { uploadControllers.current.delete(controller); setProgress((current) => current ? { ...current, done: current.done + 1 } : current); } } };
    try {
      await Promise.all(Array.from({ length: Math.min(3, images.length) }, next));
      if (created.length) { setAssets((current) => [...created.reverse(), ...current]); setNotice(`${created.length} 张图片已上传，生成引用正在后台准备${normalizedCount ? `，${normalizedCount} 张已自动补白` : ""}`); }
      if (failures.length) setError(`${failures.length} 张上传失败：${failures.slice(0, 3).join("、")}${failures.length > 3 ? " 等" : ""}`);
    } finally { setUploading(false); setProgress(null); if (fileInput.current) fileInput.current.value = ""; }
  };
  const startRename = (asset: LibraryAsset) => { cancelRename.current = false; setEditingId(asset.Id); setDraftName(asset.Name || "未命名图片"); setError(""); };
  const saveRename = async (asset: LibraryAsset) => {
    if (cancelRename.current) { cancelRename.current = false; return; }
    if (renaming.current.has(asset.Id)) return;
    const name = draftName.trim(); if (!name || name === asset.Name) { setEditingId(null); return; }
    renaming.current.add(asset.Id);
    try { const updated = await api.patch<LibraryAsset>(`/api/assets/${asset.Id}`, { name }); setAssets((current) => current.map((item) => item.Id === asset.Id ? updated : item)); setEditingId(null); setNotice("名称已更新"); }
    catch (renameError) { setError(renameError instanceof Error ? renameError.message : "重命名失败"); }
    finally { renaming.current.delete(asset.Id); }
  };
  const saveCategory = async (asset: LibraryAsset, nextCategory: AssetCategory) => {
    if (asset.Category === nextCategory || categorizing.has(asset.Id)) return;
    const previous = asset.Category;
    setCategorizing((current) => new Set(current).add(asset.Id)); setError("");
    setAssets((current) => current.map((item) => item.Id === asset.Id ? { ...item, Category: nextCategory } : item));
    try {
      const updated = await api.patch<LibraryAsset>(`/api/assets/${asset.Id}`, { category: nextCategory });
      setAssets((current) => current.map((item) => item.Id === asset.Id ? updated : item).filter((item) => category === "all" || item.Category === category));
      setNotice(`已标注为${assetCategoryLabels[nextCategory]}`);
    } catch (categoryError) {
      setAssets((current) => current.map((item) => item.Id === asset.Id ? { ...item, Category: previous } : item));
      setError(categoryError instanceof Error ? categoryError.message : "标签更新失败");
    } finally { setCategorizing((current) => { const next = new Set(current); next.delete(asset.Id); return next; }); }
  };
  const deleteSelection = async () => {
    const ids = [...selected]; if (!ids.length) return; setDeleting(true); setError("");
    try { const result = await api.post<{ deleted: string[]; failed: string[] }>("/api/assets/bulk-delete", { ids }); setAssets((current) => current.filter((asset) => !result.deleted.includes(asset.Id))); setSelected(new Set(result.failed)); setConfirmDelete(false); setNotice(`${result.deleted.length} 个素材已删除`); if (result.failed.length) setError(`${result.failed.length} 个素材删除失败，可再次重试`); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "删除失败，请稍后重试"); }
    finally { setDeleting(false); }
  };
  return <section className="image-assets" aria-label="图片资产管理">
    <nav className="asset-category-tabs" aria-label="图片资产标签"><button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部</button>{assetCategories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{assetCategoryLabels[item]}</button>)}</nav>
    <div className="image-assets__toolbar"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图片名称" aria-label="搜索图片资产" /></label><div>{assets.length > 0 && <button className="quiet" onClick={toggleAll}>{allSelected ? <CheckSquare2 /> : <Square />}{allSelected ? "取消全选" : "全选当前页"}</button>}{selected.size > 0 && <button className="quiet danger" onClick={() => setConfirmDelete(true)}><Trash2 /> 删除 {selected.size} 项</button>}<button className="asset-upload" disabled={!group || uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle className="spin" /> : <Upload />}{progress ? `上传 ${progress.done}/${progress.total}` : "上传图片"}</button><input ref={fileInput} hidden multiple type="file" accept="image/*" onChange={(event) => void uploadImages(event.target.files)} /></div></div>
    {(notice || error) && <div className={`image-assets__feedback ${error ? "is-error" : ""}`} role="status">{error || notice}</div>}
    {loading ? <div className="image-assets__state"><LoaderCircle className="spin" /> 正在整理你的图片资产</div> : !assets.length ? <div className="image-assets__empty"><ImageIcon /><h2>{query ? "没有匹配的图片" : category === "all" ? "把常用参考图放在这里" : `${assetCategoryLabels[category]}标签下还没有图片`}</h2><p>{query ? "换一个关键词，或清除搜索。" : "支持一次选择多张图片；上传时会自动归入当前标签。"}</p>{query ? <button onClick={() => setQuery("")}>清除搜索</button> : <button disabled={!group} onClick={() => fileInput.current?.click()}><Upload /> 上传第一批图片</button>}</div> : <><div className="image-assets__grid">{assets.map((asset) => <article key={asset.Id} className={`image-asset-card ${selected.has(asset.Id) ? "is-selected" : ""}`}>
      <button className="image-asset-card__media" aria-pressed={selected.has(asset.Id)} aria-label={`${selected.has(asset.Id) ? "取消选择" : "选择"} ${asset.Name}`} onClick={() => toggle(asset.Id)}>{asset.URL ? <img src={asset.URL} alt="" loading="lazy" decoding="async" /> : <span><ImageIcon /></span>}<i>{selected.has(asset.Id) ? <Check /> : null}</i>{asset.Status !== "Active" && <small className={`status-${asset.Status.toLowerCase()}`} title={asset.Error}>{asset.Status === "Processing" ? "已上传 · 引用准备中" : "已上传 · 引用失败"}</small>}</button>
      <div className="image-asset-card__body">{editingId === asset.Id ? <input autoFocus value={draftName} maxLength={80} onChange={(event) => setDraftName(event.target.value)} onBlur={() => void saveRename(asset)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { cancelRename.current = true; setEditingId(null); event.currentTarget.blur(); } }} aria-label="图片名称" /> : <><span className="image-asset-card__meta"><h3 title={asset.Name}>{asset.Name || "未命名图片"}</h3><select value={asset.Category} disabled={categorizing.has(asset.Id)} onChange={(event) => void saveCategory(asset, event.target.value as AssetCategory)} aria-label={`修改 ${asset.Name} 的标签`}>{assetCategories.map((item) => <option value={item} key={item}>{assetCategoryLabels[item]}</option>)}</select></span><span className="image-asset-card__actions"><button aria-label={`插入画布 ${asset.Name}`} disabled={!asset.UploadId || asset.Status !== "Active"} title={!asset.UploadId ? "外部链接素材暂不支持插入画布" : asset.Status !== "Active" ? "素材仍在处理中" : "插入画布"} onClick={() => onInsertCanvas(asset)}><LayoutGrid /></button><button aria-label={`重命名 ${asset.Name}`} onClick={() => startRename(asset)}><Pencil /></button></span></>}</div>
    </article>)}</div>{hasMore && <button className="image-assets__more" disabled={loadingMore} onClick={() => void loadPage(page + 1, false)}>{loadingMore ? <LoaderCircle className="spin" /> : <Plus />} 加载更多</button>}</>}
    {confirmDelete && <div className="image-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="image-delete-title" onClick={() => !deleting && setConfirmDelete(false)}><div onClick={(event) => event.stopPropagation()}><Trash2 /><h2 id="image-delete-title">删除 {selected.size} 个图片素材？</h2><p>这些素材将从你的资产库移除，已提交的历史生成不会受到影响。</p><footer><button disabled={deleting} onClick={() => setConfirmDelete(false)}>取消</button><button className="danger" disabled={deleting} onClick={() => void deleteSelection()}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} 确认删除</button></footer></div></div>}
  </section>;
}

function AssetArchive({ tasks, models, onCreate, onDelete, onInsertCanvas }: { tasks: Task[]; models: ModelCapability[]; onCreate: () => void; onDelete: (task: Task) => void; onInsertCanvas: (target: { kind: "video"; task: Task } | { kind: "image"; asset: LibraryAsset }) => void }) {
  const [assetView, setAssetView] = useState<"videos" | "images">("videos"); const [query, setQuery] = useState(""); const [preview, setPreview] = useState<Task | null>(null); const [downloadNotice, setDownloadNotice] = useState<{ task: Task; message: string } | null>(null); const noticeTimer = useRef<number | null>(null); const playbackPositions = useRef(new Map<string, number>());
  const archived = useMemo(() => tasks.filter((task) => task.visibility !== "shared" && task.status === "succeeded" && task.mediaStatus === "ready" && task.videoUrl), [tasks]);
  const filtered = useMemo(() => archived.filter((task) => (task.prompt || "参考素材生成").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [archived, query]);
  useEffect(() => () => { if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current); }, []);
  const announceDownload = (task: Task) => {
    reportMediaEvent(task.id, "download_click", Date.now());
    setDownloadNotice({ task, message: "已交给浏览器下载器" });
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setDownloadNotice(null), 5200);
  };
  const copyDownloadEntry = async () => {
    if (!downloadNotice) return;
    const url = downloadNotice.task.downloadUrl ?? downloadNotice.task.videoUrl;
    try {
      if (!url) throw new Error("missing download url");
      await navigator.clipboard.writeText(new URL(url, window.location.origin).href);
      setDownloadNotice({ ...downloadNotice, message: "下载入口已复制" });
    } catch { setDownloadNotice({ ...downloadNotice, message: "复制失败，请再次点击下载" }); }
  };
  return <div className="archive-page">
    <header className="archive-heading"><div><span>Firefly archive</span><h1>我的资产</h1><p>{assetView === "videos" ? "已完成并归档的视频会自动收录在这里。" : "管理只属于你的参考图片素材。"}</p></div>{assetView === "videos" && archived.length > 0 && <label className="archive-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索视频" aria-label="搜索视频资产" /></label>}</header>
    <nav className="asset-tabs" aria-label="资产类型"><button className={assetView === "videos" ? "active" : ""} aria-current={assetView === "videos" ? "page" : undefined} onClick={() => setAssetView("videos")}><Film /> 视频资产</button><button className={assetView === "images" ? "active" : ""} aria-current={assetView === "images" ? "page" : undefined} onClick={() => { setAssetView("images"); setPreview(null); }}><ImageIcon /> 图片资产</button></nav>
    {assetView === "images" ? <ImageAssetManager onInsertCanvas={(asset) => onInsertCanvas({ kind: "image", asset })} /> : <>{!archived.length ? <div className="archive-empty"><div><Archive /></div><h2>第一支成片会出现在这里</h2><p>完成一次视频生成后，Firefly 会自动整理预览、下载与创作参数。</p><button onClick={onCreate}><Plus /> 开始创作</button></div>
      : !filtered.length ? <div className="archive-empty archive-empty--search"><Search /><h2>没有找到相关视频</h2><p>换一个关键词，或清除当前搜索。</p><button onClick={() => setQuery("")}>清除搜索</button></div>
      : <div className="archive-grid">{filtered.map((task) => { const model = models.find((item) => item.id === task.model); return <article className="archive-card" key={task.id}>
        <button className="archive-card__media" onClick={() => setPreview(task)} aria-label={`预览 ${task.prompt || "生成视频"}`}>
          <div className="archive-card__fallback"><Film /><span>{task.ratio}</span></div>{task.posterUrl && <img key={`${task.id}-${task.mediaRevision ?? 0}`} src={task.posterUrl} alt="" loading="lazy" decoding="async" onLoad={(event) => { event.currentTarget.style.display = "block"; event.currentTarget.style.opacity = "1"; }} onError={(event) => { event.currentTarget.style.display = "none"; }} />}<span className="archive-card__play"><Play /></span><small>{task.duration}s</small>
        </button>
        <div className="archive-card__body"><h2 title={task.prompt || "参考素材生成"}>{task.prompt || "参考素材生成"}</h2><p>{model?.name ?? task.model} · {task.resolution} · {task.ratio}</p><footer><time>{new Date(task.createdAt).toLocaleDateString("zh-CN")}</time><div><CaseIdButton task={task} compact /><a href={task.downloadUrl ?? task.videoUrl} target="_blank" rel="noreferrer" title="下载视频" onClick={() => announceDownload(task)}><Download /></a><button title="插入画布" onClick={() => onInsertCanvas({ kind: "video", task })}><LayoutGrid /></button><button title="删除项目" onClick={() => onDelete(task)}><Trash2 /></button></div></footer></div>
      </article>; })}</div>}
    {preview && <AssetPreview task={preview} close={() => setPreview(null)} onDelete={onDelete} initialTime={playbackPositions.current.get(preview.id) ?? 0} onPosition={(time) => playbackPositions.current.set(preview.id, time)} />}
    {downloadNotice && <div className="archive-download-notice" role="status" aria-live="polite"><span className="archive-download-notice__icon"><Download /></span><span><b>{downloadNotice.message}</b><small>网络中断后可从浏览器下载列表继续</small></span><button onClick={copyDownloadEntry}><Copy /> 复制入口</button></div>}</>}
  </div>;
}

function ImageResultsGallery({ results, onInsertCanvas, onRemove }: { results: ImageResultBundle[]; onInsertCanvas: (target: { kind: "generated"; mediaId: string; title: string }) => void; onRemove: (id: string) => void }) {
  if (!results.length) return null;
  return <section className="image-results" aria-label="图片生成结果">
    {results.map((result) => <article className="image-result" key={result.id}>
      <header><span className="image-result__badge"><ImageIcon /> 图片生成</span><b>{result.modelName}</b><small>{result.ratio} · {result.resolution}px · {result.items.length} 张 · {new Date(result.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</small></header>
      {result.prompt && <p className="image-result__prompt" title={result.prompt}>「{result.prompt}」</p>}
      <div className="image-result__grid">
        {result.items.map((item) => <figure key={item.mediaId}>
          <img src={"/api/image-media/" + encodeURIComponent(item.mediaId)} alt={result.prompt || "生成图片"} loading="lazy" decoding="async" />
          <figcaption>
            <a href={"/api/image-media/" + encodeURIComponent(item.mediaId) + "?download=1"} download title="下载图片"><Download /> 下载</a>
            <button onClick={() => onInsertCanvas({ kind: "generated", mediaId: item.mediaId, title: (result.prompt || "生成图片").slice(0, 24) })} title="插入画布"><LayoutGrid /> 插入画布</button>
          </figcaption>
        </figure>)}
      </div>
      {!!result.failed?.length && <p className="image-result__failed" role="alert">{result.failed.length} 张生成失败，可调整参数后重试</p>}
      <button className="image-result__remove" onClick={() => onRemove(result.id)} title="删除这组结果"><X /> 删除</button>
    </article>)}
  </section>;
}

function Studio({ user, route, navigate, logout }: { user: SessionUser; route: string; navigate: (path: string) => void; logout: () => void }) {
  const view = route.startsWith("/studio/canvas") ? "canvas" : route === "/studio/assets" ? "assets" : "create";
  const [models, setModels] = useState<ModelCapability[]>([]); const [tasks, setTasks] = useState<Task[]>([]); const [sidebar, setSidebar] = useState(() => window.innerWidth > 760); const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState(""); const [syncIssue, setSyncIssue] = useState(false); const [creatingNew, setCreatingNew] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null); const [deleting, setDeleting] = useState(false); const [deleteError, setDeleteError] = useState(""); const [profileOpen, setProfileOpen] = useState(false); const [featureNotice, setFeatureNotice] = useState<{ kind: "atlas"; nonce: number; leaving?: boolean } | null>(null); const [pendingCanvasCreate, setPendingCanvasCreate] = useState(false); const [canvasInsertTarget, setCanvasInsertTarget] = useState<{ kind: "video"; task: Task } | { kind: "image"; asset: LibraryAsset } | { kind: "generated"; mediaId: string; title: string } | null>(null); const [imageResults, setImageResults] = useState<ImageResultBundle[]>([]); const profileRef = useRef<HTMLDivElement>(null); const atlasExitTimer = useRef<number | undefined>(undefined); const atlasAutoTimer = useRef<number | undefined>(undefined);
  const [now, setNow] = useState(Date.now());
  const activeTasks = useMemo(() => tasks.filter((task) => !["succeeded", "failed"].includes(task.status) || task.mediaStatus === "archiving"), [tasks]);
  const privateTasks = useMemo(() => tasks.filter((task) => task.visibility !== "shared"), [tasks]);
  const sharedTasks = useMemo(() => tasks.filter((task) => task.visibility === "shared"), [tasks]);
  const archivedCount = useMemo(() => privateTasks.filter((task) => task.status === "succeeded" && task.videoUrl).length, [privateTasks]);
  const latestVideoTaskId = useMemo(() => tasks.find((task) => task.status === "succeeded" && task.videoUrl && (!task.videoExpiresAt || task.videoExpiresAt > now))?.id, [tasks, now]);
  const refresh = async () => { try { setTasks(await api.get<Task[]>("/api/generations")); setLoadError(""); setSyncIssue(false); } catch { setSyncIssue(true); } finally { setLoading(false); } };
  const initialLoad = () => { setLoading(true); setLoadError(""); Promise.all([api.get<ModelCapability[]>("/api/models"), api.get<Task[]>("/api/generations")]).then(([m, t]) => { setModels(m); setTasks(t); setSyncIssue(false); }).catch((error) => setLoadError(error instanceof Error ? error.message : "创作台暂时无法载入")).finally(() => setLoading(false)); };
  useEffect(initialLoad, []);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => { if (atlasExitTimer.current) window.clearTimeout(atlasExitTimer.current); if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current); }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (profileRef.current && !profileRef.current.contains(event.target as Node)) setProfileOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setProfileOpen(false); if (!deleting) setDeleteTarget(null); } };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [deleting]);
  useEffect(() => {
    if (!activeTasks.length) return;
    let disposed = false; let timer: number | undefined;
    const schedule = () => { timer = window.setTimeout(tick, document.hidden ? 15000 : 2000); };
    const tick = async () => { await refresh(); if (!disposed) schedule(); };
    const resume = () => { if (timer) window.clearTimeout(timer); if (!document.hidden && navigator.onLine) void refresh(); schedule(); };
    schedule(); document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { disposed = true; if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [activeTasks.length]);
  useEffect(() => {
    if (activeTasks.length) return;
    let timer: number | undefined;
    const schedule = () => { timer = window.setTimeout(tick, document.hidden ? 5 * 60_000 : 60_000); };
    const tick = async () => { await refresh(); schedule(); };
    const resume = () => { if (timer) window.clearTimeout(timer); if (!document.hidden && navigator.onLine) void refresh(); schedule(); };
    schedule(); document.addEventListener("visibilitychange", resume); window.addEventListener("online", resume);
    return () => { if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [activeTasks.length]);
  const showCreate = (fresh = false) => { navigate("/studio"); setCreatingNew(fresh); setFeatureNotice(null); if (window.innerWidth <= 760) setSidebar(false); };
  const showAssets = () => { navigate("/studio/assets"); setProfileOpen(false); setFeatureNotice(null); if (window.innerWidth <= 760) setSidebar(false); };
  const showCanvas = () => { navigate("/studio/canvas"); setProfileOpen(false); setFeatureNotice(null); if (window.innerWidth <= 760) setSidebar(false); };
  const createCanvasFromSidebar = () => { setPendingCanvasCreate(true); showCanvas(); };
  const dismissAtlas = () => {
    if (!featureNotice || featureNotice.leaving) return;
    if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current);
    setFeatureNotice({ ...featureNotice, leaving: true });
    atlasExitTimer.current = window.setTimeout(() => setFeatureNotice(null), 700);
  };
  const activateAtlas = () => {
    setProfileOpen(false);
    if (featureNotice && !featureNotice.leaving) { dismissAtlas(); return; }
    if (atlasExitTimer.current) window.clearTimeout(atlasExitTimer.current);
    if (atlasAutoTimer.current) window.clearTimeout(atlasAutoTimer.current);
    setFeatureNotice({ kind: "atlas", nonce: Date.now() });
    atlasAutoTimer.current = window.setTimeout(() => {
      setFeatureNotice((current) => current && !current.leaving ? { ...current, leaving: true } : current);
      atlasExitTimer.current = window.setTimeout(() => setFeatureNotice(null), 700);
    }, 6400);
  };
  const selectTask = (task: Task) => { showCreate(false); requestAnimationFrame(() => document.getElementById(`task-${task.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" })); };
  const requestDelete = (task: Task) => { setDeleteError(""); setDeleteTarget(task); };
  const confirmDelete = async () => { if (!deleteTarget) return; setDeleting(true); setDeleteError(""); try { await api.delete(`/api/generations/${deleteTarget.id}`); setTasks((old) => old.filter((task) => task.id !== deleteTarget.id)); setDeleteTarget(null); } catch (error) { setDeleteError(error instanceof Error ? error.message : "删除失败，请稍后重试"); } finally { setDeleting(false); } };
  const historySection = (label: string, items: Task[]) => <>{!!items.length && <><div className="sidebar-label">{label}</div><div className="history-list">{items.map((task) => <button key={task.id} onClick={() => selectTask(task)}><MessageSquare /><span><b>{task.prompt || "参考素材生成"}</b><small>{taskStatusText(task)} · {new Date(task.createdAt).toLocaleDateString("zh-CN")}</small></span></button>)}</div></>}</>;
  return <main className={`studio ${sidebar ? "" : "studio--collapsed"}`}>
    <div className={`intelligence-aura ${featureNotice ? featureNotice.leaving ? "intelligence-aura--leaving" : "intelligence-aura--active" : ""}`} aria-hidden="true"><i className="aura-corner aura-corner--tl" /><i className="aura-corner aura-corner--tr" /><i className="aura-corner aura-corner--br" /><i className="aura-corner aura-corner--bl" /></div>
    <nav className="app-rail" aria-label="主要导航"><button className="rail-logo" aria-label="Firefly 创作台" onClick={() => showCreate(false)}><FireflyGlyph compact /></button><div className="rail-nav"><button className={view === "create" ? "active" : ""} aria-current={view === "create" ? "page" : undefined} onClick={() => showCreate(false)}><GenerateNavGlyph /><span>生成</span></button><button className={view === "assets" ? "active" : ""} aria-current={view === "assets" ? "page" : undefined} onClick={showAssets}><AssetsNavGlyph /><span>资产</span>{archivedCount > 0 && <i title={`${archivedCount} 个资产`}>{archivedCount > 99 ? "99+" : archivedCount}</i>}</button><button className={view === "canvas" ? "active" : ""} aria-current={view === "canvas" ? "page" : undefined} onClick={showCanvas}><CanvasNavGlyph /><span>画布</span></button><button className={featureNotice && !featureNotice.leaving ? "future active-preview" : "future"} aria-pressed={Boolean(featureNotice && !featureNotice.leaving)} onClick={activateAtlas}><AtlasNavGlyph /><span>Atlas</span></button></div><div className="rail-account" ref={profileRef}><button className="rail-avatar" aria-label="打开账号菜单" aria-expanded={profileOpen} onClick={() => setProfileOpen((open) => !open)}><UserAvatar user={user} /></button>{profileOpen && <AccountMenu user={user} close={() => setProfileOpen(false)} home={() => navigate("/")} logout={logout} />}</div></nav>
    <aside className="sidebar" aria-hidden={!sidebar} inert={!sidebar ? true : undefined}><div className="sidebar-head"><span>{view === "assets" ? "资产归档" : view === "canvas" ? "画布" : "开始创作"}</span><button aria-label="收起侧栏" onClick={() => setSidebar(false)}><PanelLeftClose /></button></div>{view === "create" ? <><button className="new-chat" onClick={() => showCreate(true)}><Plus /> 新创作</button>{historySection("我的创作", privateTasks)}{historySection("团队历史", sharedTasks)}{!tasks.length && <div className="history-list"><p>还没有创作记录</p></div>}</> : view === "assets" ? <><div className="asset-sidebar-summary"><span>已归档成片</span><strong>{archivedCount}</strong><p>完成生成的视频会自动进入资产页，并长期保留至你主动删除。</p></div><button className="new-chat new-chat--quiet" onClick={() => showCreate(true)}><Plus /> 创建新视频</button></> : <div className="canvas-sidebar-summary"><CanvasNavGlyph /><span>自由画布</span><p>把镜头、素材与灵感组织在同一张画布上，自由排版、连接创作。</p><button className="new-chat new-chat--quiet" onClick={createCanvasFromSidebar}><Plus /> 新建画布</button></div>}</aside>
    {sidebar && <button className="sidebar-scrim" aria-label="关闭侧栏" onClick={() => setSidebar(false)} />}
    <section className="workspace"><header className="workspace-head">{!sidebar && <button className="menu-button" aria-label="打开侧栏" onClick={() => setSidebar(true)}><Menu /></button>}<span>{view === "assets" ? "Firefly media archive" : view === "canvas" ? "Firefly canvas" : "Seedance video studio"}</span><div className={`system-live ${syncIssue ? "system-live--issue" : ""}`} title={syncIssue ? "与服务端的同步暂时中断，系统会自动重试" : undefined}><i /> {syncIssue ? "同步暂时中断" : activeTasks.length ? `${activeTasks.length} 项进行中` : "系统在线"}</div></header>
      {loading ? <div className="workspace-loading"><LoaderCircle className="spin" /> 正在唤醒 Firefly</div> : loadError ? <div className="workspace-error"><Archive /><h1>创作台暂时无法载入</h1><p>{loadError}</p><button onClick={initialLoad}><RefreshCw /> 重新载入</button></div> : view === "canvas" ? (route === "/studio/canvas" ? <CanvasProjectList navigate={navigate} autoCreate={pendingCanvasCreate} onAutoCreateHandled={() => setPendingCanvasCreate(false)} /> : <CanvasWorkspace canvasId={route.split("/")[3] ?? ""} navigate={navigate} user={user} logout={logout} />) : view === "assets" ? <AssetArchive tasks={tasks} models={models} onCreate={() => showCreate(true)} onDelete={requestDelete} onInsertCanvas={setCanvasInsertTarget} /> : creatingNew || !tasks.length ? <div className="empty-workspace"><Composer models={models} compact={false} onCreated={(task) => { setTasks((old) => [task, ...old]); setCreatingNew(false); }} onImagesGenerated={(bundle) => setImageResults((old) => [bundle, ...old])} /><ImageResultsGallery results={imageResults} onInsertCanvas={setCanvasInsertTarget} onRemove={(id) => setImageResults((old) => old.filter((item) => item.id !== id))} /><div className="creation-footnote">输入素材保留 7 天 · 成片将长期保存至主动删除</div></div> : <div className="conversation"><div className="conversation-inner"><ImageResultsGallery results={imageResults} onInsertCanvas={setCanvasInsertTarget} onRemove={(id) => setImageResults((old) => old.filter((item) => item.id !== id))} /><div className="conversation-heading"><span>Current sequence</span><h1>创作正在发生</h1></div>{tasks.map((task) => <TaskCard key={task.id} task={task} models={models} eager={task.id === latestVideoTaskId} now={now} onDelete={requestDelete} canDelete={task.ownerId === user.id} />)}</div><div className="composer-dock"><Composer models={models} compact onCreated={(task) => setTasks((old) => [task, ...old])} onImagesGenerated={(bundle) => setImageResults((old) => [bundle, ...old])} /></div></div>}
    </section>
    {canvasInsertTarget && <CanvasInsertPicker payload={canvasInsertTarget.kind === "video" ? { kind: "video", taskId: canvasInsertTarget.task.id, title: canvasInsertTarget.task.prompt || "参考素材生成" } : canvasInsertTarget.kind === "image" ? { kind: "image", uploadId: canvasInsertTarget.asset.UploadId ?? "", name: canvasInsertTarget.asset.Name || "图片" } : { kind: "generated", mediaId: canvasInsertTarget.mediaId, title: canvasInsertTarget.title }} onClose={() => setCanvasInsertTarget(null)} navigate={navigate} />}
    {deleteTarget && <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-title" onClick={() => !deleting && setDeleteTarget(null)}><div className="confirm-dialog" onClick={(event) => event.stopPropagation()}><span><Trash2 /></span><h2 id="delete-title">删除这次创作？</h2><p>项目与已归档成片将被删除，此操作无法撤销。</p>{deleteError && <small className="confirm-error" role="alert">{deleteError}</small>}<div><button autoFocus disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</button><button className="danger" disabled={deleting} onClick={confirmDelete}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} 删除项目</button></div></div></div>}
    {featureNotice && <div key={`notice-${featureNotice.nonce}`} className={`feature-notice feature-notice--atlas ${featureNotice.leaving ? "feature-notice--leaving" : ""}`} role="status" aria-live="polite"><span className="feature-notice__icon"><AtlasNavGlyph /></span><span><b>Atlas</b><small>功能即将上线</small></span><button aria-label="关闭提示" onClick={dismissAtlas}><X /></button></div>}
  </main>;
}

export function App() {
  const [route, setRoute] = useState(location.pathname); const [auth, setAuth] = useState<SessionUser | null | undefined>(undefined);
  const navigate = (path: string) => { history.pushState({}, "", path); setRoute(path); };
  useEffect(() => { const pop = () => setRoute(location.pathname); addEventListener("popstate", pop); api.get<{ authenticated: boolean; user?: SessionUser }>("/api/auth/session").then((r) => setAuth(r.authenticated && r.user ? r.user : null)).catch(() => setAuth(null)); return () => removeEventListener("popstate", pop); }, []);
  useEffect(() => listenForSignedOut(() => setAuth(null)), []);
  if (route === "/") return <Landing enter={() => navigate("/studio")} />;
  if (auth === undefined) return <main className="boot"><FireflyMark /><LoaderCircle className="spin" /></main>;
  if (!auth) return <AccessGate back={() => navigate("/")} />;
  return <Studio user={auth} route={route} navigate={navigate} logout={async () => { await api.delete("/api/auth/session"); notifySignedOut(); navigate("/"); }} />;
}
