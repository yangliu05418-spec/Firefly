import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Check, ChevronDown, Clock3, Clapperboard, Film, ImageIcon, Layers3, Library, LoaderCircle, Plus, Send, Settings2, Sparkles, Upload, Video, WandSparkles, X } from "lucide-react";
import { api, uploadFile } from "../../api";
import type { CreationMode, ImageGenerationTask, ImageModel, LibraryAsset, LibraryGroup, ModelCapability, Task, UploadAsset } from "../../types";
import { materializePromptReferences, promptAssetLabel, promptAssetMarker } from "../../prompt-references";

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
type AssetCreateResponse = LibraryAsset | { Pending: true; UploadId: string; Status: "Processing"; Message: string };
const assetRegistrationPending = (result: AssetCreateResponse): result is Extract<AssetCreateResponse, { Pending: true }> => "Pending" in result && result.Pending;

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

  return <div className="prompt-editor-wrap"><div ref={editor} className="prompt-editor" contentEditable role="textbox" aria-multiline="true" aria-label="创作提示词" data-placeholder={placeholder} suppressContentEditableWarning onInput={() => { sync(); detectMention(); }} onKeyUp={(event) => !["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key) && detectMention()} onKeyDown={keyDown} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onPaste={(event) => { event.preventDefault(); document.execCommand("insertText", false, event.clipboardData.getData("text/plain")); }} />{popup}</div>;
}

export function Composer({ models, compact, onCreated, onImageQueued }: { models: ModelCapability[]; compact: boolean; onCreated: (task: Task) => void; onImageQueued?: (task: ImageGenerationTask) => void }) {
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
    if (!model.modes.includes(mode)) { setMode(model.modes[0]); return; }
    if (!model.resolutions.includes(resolution)) setResolution(model.resolutions.includes("720p") ? "720p" : model.resolutions[0]);
    if (ratioLocked) setRatio("adaptive"); else if (ratio === "adaptive" || !model.ratios.includes(ratio)) setRatio("16:9");
    if (durationLocked) setDuration(-1); else setDuration((value) => Math.min(model.duration[1], Math.max(model.duration[0], value === -1 ? model.duration[0] : value)));
    if (!model.supportsAudio) setGenerateAudio(false);
    setAssets([]);
    setError("");
  }, [modelId, mode]);
  useEffect(() => { const close = () => setOpen(null); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, []);
  if (!model) return null;

  const pickFiles = async (files: FileList | null) => {
    if (!files || (mode === "text" && engine === "video")) return;
    const plannedAssets = [...assets];
    for (const file of Array.from(files)) {
      const type: UploadAsset["type"] = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio";
      if (engine === "image" && type !== "image") { setError("图片生成只接受图片参考（图生图）"); continue; }
      if ((mode === "first_frame" || mode === "first_last") && type !== "image") { setError("首帧与首尾帧模式只接受图片"); continue; }
      if (mode === "first_frame" && plannedAssets.length >= 1) { setError("首帧模式只接受一张图片"); continue; }
      if (mode === "first_last" && plannedAssets.length >= 2) { setError("首尾帧模式只接受两张图片"); continue; }
      const allowed = type === "image" ? model.imageLimit : type === "video" ? model.videoLimit : model.audioLimit;
      if (!allowed || plannedAssets.filter((a) => a.type === type).length >= allowed) { setError(`当前模型最多支持 ${allowed} 个${type === "image" ? "图片" : type === "video" ? "视频" : "音频"}参考`); continue; }
      const tempId = crypto.randomUUID();
      const role: UploadAsset["role"] = mode === "first_frame" ? "first_frame" : mode === "first_last" ? (plannedAssets.some((a) => a.role === "first_frame") ? "last_frame" : "first_frame") : type === "image" ? "reference_image" : type === "video" ? "reference_video" : "reference_audio";
      const pending = { id: tempId, name: file.name, size: file.size, type, role, progress: 0, preview: type === "image" ? URL.createObjectURL(file) : undefined } satisfies UploadAsset;
      plannedAssets.push(pending);
      setAssets((old) => [...old, pending]);
      try {
        const uploaded = await uploadFile(file, type, (progress) => setAssets((old) => old.map((a) => a.id === tempId ? { ...a, progress } : a)));
        setAssets((old) => old.map((a) => a.id === tempId ? { ...a, ...uploaded, uploadId: uploaded.uploadId ?? uploaded.id, role, progress: 100 } : a));
      } catch (e) { setAssets((old) => old.filter((a) => a.id !== tempId)); setError(e instanceof Error ? e.message : "上传失败"); }
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const attachMentionAsset = (candidate: UploadAsset) => {
    if (candidate.status === "Processing") { setError("素材仍在处理中，处理完成后即可加入参考"); return null; }
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
        const references = assets.filter((asset) => asset.type === "image" && asset.uploadId).map((asset) => asset.uploadId!);
        const task = await api.post<ImageGenerationTask>("/api/image-generations", { model: imageModelId, ratio: imageRatio, resolution: imageResolution, count: imageCount, prompt: prompt.trim(), references });
        onImageQueued?.(task);
        setPrompt(""); setAssets([]);
        return;
      }
      const task = await api.post<Task>("/api/generations", { prompt: materializePromptReferences(prompt, assets), model: model.id, mode, ratio, resolution, duration, generateAudio: model.supportsAudio && generateAudio, seed, cameraFixed, watermark, outputFormat: "mp4", assets: assets.map(({ preview, progress, size, ...asset }) => asset) });
      onCreated(task); setPrompt(""); setAssets([]);
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
      {!!assets.length && <div className="asset-strip">{assets.map((asset, index) => <div className="asset-chip" key={asset.id}>{asset.preview ? <img src={asset.preview} /> : asset.type === "video" ? <Video /> : <AudioLines />}<span><b>{asset.role === "first_frame" ? "首帧" : asset.role === "last_frame" ? "尾帧" : `${asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"} ${index + 1}`}</b><small>{asset.progress === 100 ? asset.name : `上传 ${asset.progress ?? 0}%`}</small></span>{asset.progress !== 100 && <i style={{ width: `${asset.progress ?? 0}%` }} />}<button onClick={() => setAssets((old) => old.filter((a) => a.id !== asset.id))}><X /></button></div>)}</div>}
      <div className={`prompt-row ${referenceSlots.length > 1 ? "prompt-row--dual" : ""} ${!referenceSlots.length ? "prompt-row--text" : ""}`}>
        {!!referenceSlots.length && <div className="reference-slots">{referenceSlots.map((label, index) => <button className="add-reference" key={label} onClick={() => fileInput.current?.click()} disabled={(mode === "first_frame" && assets.length >= 1) || (mode === "first_last" && assets.length > index)}><Plus /><span>{label}</span></button>)}</div>}
        <PromptEditor value={prompt} change={setPrompt} placeholder={engine === "image" ? "描述你想生成的画面；上传参考图即可进行图生图……" : modePlaceholders[mode]} assets={assets} disabled={mode === "text" && engine === "video"} attach={attachMentionAsset} />
        <input ref={fileInput} hidden type="file" multiple={mode !== "first_frame"} accept={fileAccept} onChange={(e) => pickFiles(e.target.files)} />
      </div>
      <div className="control-row">
        <div className="control-wrap"><button className="control control--accent" onClick={() => setOpen(open === "generation" ? null : "generation")}><WandSparkles /> {engine === "video" ? "视频生成" : "图片生成"} <ChevronDown /></button>{open === "generation" && <Popover className="mode-pop generation-pop"><div className="engine-tabs" role="tablist" aria-label="创作类型"><button className={engine === "video" ? "active" : ""} role="tab" aria-selected={engine === "video"} onClick={() => { setEngine("video"); setOpen(null); }}><Film /> 视频生成</button><button className={engine === "image" ? "active" : ""} role="tab" aria-selected={engine === "image"} onClick={() => { setEngine("image"); setOpen(null); }}><ImageIcon /> 图片生成</button></div><p>选择创作类型</p>{engine === "video" ? <button className="selected" onClick={() => setOpen(null)}><WandSparkles /><span><b>视频生成</b><small>使用 Seedance 生成或编辑视频</small></span><Check /></button> : <button className="selected" onClick={() => setOpen(null)}><ImageIcon /><span><b>图片生成</b><small>{imageSpec ? imageSpec.name : "OpenRouter 图像模型"}，支持文生图与图生图</small></span><Check /></button>}</Popover>}</div>
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
  const [groups, setGroups] = useState<LibraryGroup[]>([]); const [assets, setAssets] = useState<LibraryAsset[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [creating, setCreating] = useState(false); const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null); const [groupName, setGroupName] = useState(""); const [rights, setRights] = useState(false); const [pendingRegistrations, setPendingRegistrations] = useState(0); const libraryFile = useRef<HTMLInputElement>(null);
  useEffect(() => { Promise.all([api.get<{ Items?: LibraryGroup[] }>("/api/assets/groups"), api.get<{ Items?: LibraryAsset[] }>("/api/assets")]).then(([g, a]) => { setGroups(g.Items ?? []); setAssets(a.Items ?? []); }).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!pendingRegistrations) return;
    const refresh = () => void api.get<{ Items?: LibraryAsset[] }>("/api/assets").then((result) => setAssets(result.Items ?? [])).catch(() => undefined);
    const timers = [5_000, 15_000, 30_000].map((delay) => window.setTimeout(refresh, delay));
    return () => timers.forEach(window.clearTimeout);
  }, [pendingRegistrations]);
  const createGroup = async () => { if (!groupName.trim()) return; setCreating(true); setError(""); try { const result = await api.post<{ Id: string }>("/api/assets/groups", { name: groupName, description: "Created by Firefly" }); setGroups((old) => [{ Id: result.Id, Name: groupName }, ...old]); setGroupName(""); } catch (e) { setError(e instanceof Error ? e.message : "无法创建角色分组"); } finally { setCreating(false); } };
  const ingest = async (selected?: FileList | null) => {
    const files = Array.from(selected ?? []);
    if (!files.length || !groups[0] || !rights) return;
    if (files.length > 50) { setError("单次最多选择 50 个素材，请分批上传"); if (libraryFile.current) libraryFile.current.value = ""; return; }
    setCreating(true); setError(""); setNotice(""); setBatchProgress({ done: 0, total: files.length });
    const failures: string[] = []; let cursor = 0;
    const uploadNext = async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        try {
          const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "audio";
          const uploaded = await uploadFile(file, type, () => undefined);
          const result = await api.post<AssetCreateResponse>("/api/assets", { groupId: groups[0].Id, uploadId: uploaded.uploadId ?? uploaded.id, url: "url" in uploaded ? uploaded.url : undefined, type: `${type[0].toUpperCase()}${type.slice(1)}`, name: file.name });
          if (assetRegistrationPending(result)) setPendingRegistrations((count) => count + 1);
          else setAssets((old) => [result, ...old.filter((asset) => asset.Id !== result.Id)]);
        } catch (uploadError) { failures.push(`${file.name}（${uploadError instanceof Error ? uploadError.message.split(" · ")[0].slice(0, 60) : "上传失败"}）`); }
        finally { setBatchProgress((progress) => progress ? { ...progress, done: progress.done + 1 } : progress); }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, uploadNext));
      const succeeded = files.length - failures.length;
      if (succeeded) setNotice(`已接收 ${succeeded} 个素材，正在后台处理与核对`);
      if (failures.length) setError(`${failures.length} 个素材上传失败：${failures.slice(0, 3).join("、")}${failures.length > 3 ? " 等" : ""}`);
    } finally {
      setCreating(false); setBatchProgress(null); if (libraryFile.current) libraryFile.current.value = "";
    }
  };
  return <Popover className="library-pop"><div className="popover-title"><span><Library /> 可信角色库</span><small>AI 角色素材</small></div>{loading ? <div className="panel-state"><LoaderCircle className="spin" /> 正在读取角色库</div> : error && !groups.length ? <div className="panel-state panel-state--error">{error}</div> : <>{assets.length ? <div className="library-list">{assets.map((asset) => <button key={asset.Id} disabled={asset.Status !== "Active"} onClick={() => add({ id: asset.Id, assetId: asset.Id, name: asset.Name || asset.Id, type: asset.AssetType.toLowerCase() as UploadAsset["type"], size: 0, role: asset.AssetType === "Image" ? "reference_image" : asset.AssetType === "Video" ? "reference_video" : "reference_audio", progress: 100, preview: asset.URL, status: asset.Status })}>{asset.URL && asset.AssetType === "Image" ? <img src={asset.URL} /> : <span className="library-thumb"><Sparkles /></span>}<span><b>{asset.Name || "未命名角色"}</b><small>{asset.Status === "Processing" ? "正在入库" : groups.find((g) => g.Id === asset.GroupId)?.Name ?? asset.AssetType}</small></span><i className={`status-dot status-${asset.Status.toLowerCase()}`} /> </button>)}</div> : <div className="panel-state panel-state--short"><Library /><b>还没有可用角色</b><small>创建分组后上传你的 AI 角色素材</small></div>}<div className="library-create">{groups.length ? <><label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /> 我确认素材为 AI 角色且拥有完整权利</label><button disabled={!rights || creating} onClick={() => libraryFile.current?.click()}>{creating ? <LoaderCircle className="spin" /> : <Upload />} {creating && batchProgress ? `正在上传 ${batchProgress.done}/${batchProgress.total}` : `批量上传到「${groups[0].Name}」`}</button><input hidden ref={libraryFile} type="file" multiple accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav" onChange={(e) => void ingest(e.target.files)} /></> : <><input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="输入第一个角色分组名称" /><button disabled={creating || !groupName.trim()} onClick={createGroup}><Plus /> 创建角色分组</button></>}{notice && <small className="library-success">{notice}</small>}{error && <small className="library-error">{error}</small>}</div></>}</Popover>;
}
