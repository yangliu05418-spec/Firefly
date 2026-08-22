import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AudioLines, Check, ChevronDown, Clock3, Clapperboard, Film, ImageIcon, Layers3, LoaderCircle, Plus, RefreshCw, Send, Settings2, Sparkles, Video, WandSparkles, X } from "lucide-react";
import { api, inferUploadType } from "../../api";
import { useAssetCacheUserId } from "../../asset-cache-context";
import { reconcileComposerAssets } from "../../composer-assets";
import { clearComposerDraftInBackground, composerDraftCache, type ComposerDraftState } from "../../composer-draft-cache";
import { recoverComposerDraftAsset } from "../../composer-draft-recovery";
import { materializePromptReferences } from "../../prompt-references";
import { RecoveringThumbnail } from "../../recovering-image";
import { isAmbiguousSubmissionFailure } from "../../studio-sync";
import type { CreationMode, ImageGenResponse, ImageResultBundle, ModelCapability, Task, UploadAsset } from "../../types";
import { areAttachedUploadsAdmissible } from "../../upload-state";
import { useImageModelCatalog } from "../../use-image-model-catalog";
import { LibraryPanel } from "./LibraryPanel";
import { PromptEditor } from "./PromptEditor";
import { persistPrivateMediaStorage } from "../../private-media-cache";
import { uploadFileUntilAccepted } from "../../upload-acceptance";

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

function Popover({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`popover ${className}`} onClick={(event) => event.stopPropagation()}>{children}</div>;
}

export function Composer({ models, compact, sessionId, onCreated, onImagesGenerated }: { models: ModelCapability[]; compact: boolean; sessionId: string; onCreated: (task: Task) => void; onImagesGenerated?: (bundle: ImageResultBundle) => void }) {
  const userId = useAssetCacheUserId();
  const { catalog: imageModelCatalog, error: imageModelCatalogError } = useImageModelCatalog();
  const defaultModel = models[0];
  const [modelId, setModelId] = useState(defaultModel?.id ?? "");
  const model = models.find((item) => item.id === modelId) ?? defaultModel;
  const [mode, setMode] = useState<CreationMode>("omni");
  const [engine, setEngine] = useState<"video" | "image">("video");
  const imageModels = imageModelCatalog?.Items ?? [];
  const [imageModelId, setImageModelId] = useState("");
  const [imageRatio, setImageRatio] = useState("1:1");
  const [imageResolution, setImageResolution] = useState("");
  const [imageCount, setImageCount] = useState(1);
  const [prompt, setPrompt] = useState(""); const [ratio, setRatio] = useState("16:9"); const [resolution, setResolution] = useState("720p"); const [duration, setDuration] = useState(4);
  const [assets, setAssets] = useState<UploadAsset[]>([]); const [open, setOpen] = useState<"generation" | "model" | "mode" | "format" | "duration" | "advanced" | "library" | "image-model" | "image-format" | null>(null);
  const [generateAudio, setGenerateAudio] = useState(true); const [cameraFixed, setCameraFixed] = useState(false); const [watermark, setWatermark] = useState(false); const [seed, setSeed] = useState(-1);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const fileInput = useRef<HTMLInputElement>(null);
  const [draftHydrated, setDraftHydrated] = useState(false); const [draftNotice, setDraftNotice] = useState("");
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
    if (!imageModelCatalog) return;
    const items = imageModelCatalog.Items;
    setImageModelId((current) => {
      const spec = items.find((item) => item.id === current) ?? items.find((item) => item.id === imageModelCatalog.DefaultModel) ?? items[0];
      if (spec) {
        setImageResolution((resolution) => spec.resolutions.includes(resolution) ? resolution : (spec.defaultResolution ?? spec.resolutions[0]));
        setImageCount((count) => Math.min(count, spec.maxCount));
      }
      return spec?.id ?? "";
    });
  }, [imageModelCatalog]);
  useEffect(() => {
    if (!model) return;
    if (!model.modes.includes(mode)) { setMode(model.modes[0]); return; }
    if (!model.resolutions.includes(resolution)) setResolution(model.resolutions.includes("720p") ? "720p" : model.resolutions[0]);
    if (ratioLocked) setRatio("adaptive"); else if (ratio === "adaptive" || !model.ratios.includes(ratio)) setRatio("16:9");
    if (durationLocked) setDuration(-1); else setDuration((value) => Math.min(model.duration[1], Math.max(model.duration[0], value === -1 ? model.duration[0] : value)));
    if (!model.supportsAudio) setGenerateAudio(false);
    setAssets((current) => {
      const next = reconcileComposerAssets(current, engine, mode, model);
      const retained = new Set(next.map((asset) => asset.id));
      current.filter((asset) => !retained.has(asset.id)).forEach(cancelAssetTransfer);
      return next;
    });
    setError("");
  }, [modelId, mode]);
  useEffect(() => {
    setAssets((current) => {
      const next = reconcileComposerAssets(current, engine, mode, model);
      const retained = new Set(next.map((asset) => asset.id));
      current.filter((asset) => !retained.has(asset.id)).forEach(cancelAssetTransfer);
      return next;
    });
    setError("");
  }, [engine]);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setDraftHydrated(false);
    void composerDraftCache.read(userId, sessionId).then(async (restored) => {
      if (!active || !restored) { if (active) setDraftHydrated(true); return; }
      const state = restored.state;
      setEngine(state.engine);
      setPrompt(state.prompt);
      setModelId(models.some((item) => item.id === state.modelId) ? state.modelId : (defaultModel?.id ?? ""));
      setMode(state.mode);
      setRatio(state.ratio);
      setResolution(state.resolution);
      setDuration(state.duration);
      setGenerateAudio(state.generateAudio);
      setCameraFixed(state.cameraFixed);
      setWatermark(state.watermark);
      setSeed(state.seed);
      setImageModelId(state.imageModelId);
      setImageRatio(state.imageRatio);
      setImageResolution(state.imageResolution);
      setImageCount(state.imageCount);
      const cachedAssets = state.assets.map((asset) => ({ ...asset, progress: 100, phase: asset.assetId ? undefined : "verifying" as const, status: asset.assetId ? "Processing" as const : undefined }));
      setAssets(cachedAssets);
      setDraftHydrated(true);
      const results = await Promise.all(cachedAssets.map(async (asset) => {
        try { return { id: asset.id, asset: await recoverComposerDraftAsset(asset, controller.signal) }; }
        catch (recoveryError) { if (recoveryError instanceof DOMException && recoveryError.name === "AbortError") return { id: asset.id, asset: undefined }; return { id: asset.id, asset: null }; }
      }));
      if (!active) return;
      const resolved = new Map(results.filter((result) => result.asset !== undefined).map((result) => [result.id, result.asset]));
      const invalid = results.filter((result) => result.asset === null).length + restored.droppedAssets;
      setAssets((current) => current.flatMap((asset) => {
        if (!resolved.has(asset.id)) return [asset];
        const recovered = resolved.get(asset.id);
        return recovered ? [recovered] : [];
      }));
      if (state.prompt.trim() || state.assets.length || restored.droppedAssets) setDraftNotice(invalid ? `已恢复草稿，${invalid} 个过期素材已移除` : "已恢复上次未发送的内容");
    }).catch(() => { if (active) setDraftHydrated(true); });
    return () => { active = false; controller.abort(); };
  }, [userId, sessionId]);
  const draftState = useMemo<ComposerDraftState>(() => ({ engine, prompt, modelId, mode, ratio, resolution, duration, generateAudio, cameraFixed, watermark, seed, imageModelId, imageRatio, imageResolution, imageCount, assets }), [engine, prompt, modelId, mode, ratio, resolution, duration, generateAudio, cameraFixed, watermark, seed, imageModelId, imageRatio, imageResolution, imageCount, assets]);
  useEffect(() => {
    if (!draftHydrated) return;
    const timer = window.setTimeout(() => { void composerDraftCache.write(userId, sessionId, draftState); }, 350);
    return () => window.clearTimeout(timer);
  }, [draftHydrated, userId, sessionId, draftState]);
  useEffect(() => {
    if (!draftNotice) return;
    const timer = window.setTimeout(() => setDraftNotice(""), 5_000);
    return () => window.clearTimeout(timer);
  }, [draftNotice]);
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
        const uploaded = await uploadFileUntilAccepted(file, pending.type, (progress, phase) => setAssets((old) => old.map((a) => a.id === tempId ? { ...a, progress, phase } : a)), {
          signal: controller.signal,
          onTransportComplete: (transport) => setAssets((old) => old.map((asset) => asset.id === tempId ? { ...asset, uploadId: transport.uploadId ?? transport.id, name: file.name, size: transport.size, progress: 100, phase: "verifying" } : asset)),
        });
        setAssets((old) => old.map((a) => a.id === tempId ? { ...a, ...uploaded, id: tempId, uploadId: uploaded.uploadId ?? uploaded.id, role, progress: 100, phase: "verifying" } : a));
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
    let pendingImage: ImageResultBundle | undefined;
    let pendingVideo: Task | undefined;
    const clearSubmittedComposer = () => {
      setPrompt(""); clearAttachedAssets();
      clearComposerDraftInBackground(composerDraftCache, userId, sessionId);
    };
    try {
      if (engine === "image") {
        const spec = imageModels.find((item) => item.id === imageModelId) ?? imageModels[0];
        const submittedPrompt = prompt.trim();
        pendingImage = { id: crypto.randomUUID(), sessionId, modelName: spec?.name ?? imageModelId, ratio: imageRatio, resolution: imageResolution, prompt: submittedPrompt, items: [], createdAt: Date.now(), status: "generating", requestedCount: imageCount };
        const references = assets.filter((asset) => asset.type === "image" && asset.uploadId).map((asset) => asset.uploadId!);
        clearSubmittedComposer();
        onImagesGenerated?.(pendingImage);
        await api.post<ImageGenResponse>("/api/image-generation", { requestId: pendingImage.id, sessionId, model: imageModelId, ratio: imageRatio, resolution: imageResolution, count: imageCount, prompt: submittedPrompt, references }, { timeoutMs: 8_000 });
        return;
      }
      const requestId = crypto.randomUUID();
      const submittedPrompt = materializePromptReferences(prompt, assets);
      const submittedAt = Date.now();
      pendingVideo = { id: requestId, sessionId, caseId: requestId, ownerId: userId, visibility: "private", status: "submitting", mediaStatus: "none", prompt: submittedPrompt, model: model.id, mode, ratio, resolution, duration, createdAt: submittedAt, updatedAt: submittedAt };
      const task = await api.post<Task>("/api/generations", { requestId, sessionId, prompt: submittedPrompt, model: model.id, mode, ratio, resolution, duration, generateAudio: model.supportsAudio && generateAudio, seed, cameraFixed, watermark, outputFormat: "mp4", assets: assets.map(({ preview, progress, size, ...asset }) => asset) }, { timeoutMs: 8_000 });
      clearSubmittedComposer(); onCreated(task);
    } catch (e) {
      const message = e instanceof Error ? e.message : "无法创建任务";
      if (pendingImage && isAmbiguousSubmissionFailure(e)) {
        const confirming = { ...pendingImage, error: "连接暂时中断，正在确认任务是否已经进入队列" };
        onImagesGenerated?.(confirming);
        void api.get<ImageResultBundle>(`/api/image-generations/${encodeURIComponent(pendingImage.id)}`, { timeoutMs: 8_000 })
          .then((result) => onImagesGenerated?.(result))
          .catch((confirmation) => { if ((confirmation as { status?: number }).status === 404) onImagesGenerated?.({ ...pendingImage!, status: "failed", error: "任务未完成接纳，请重新生成" }); });
        return;
      }
      if (pendingVideo && isAmbiguousSubmissionFailure(e)) {
        clearSubmittedComposer(); onCreated(pendingVideo);
        void api.get<Task>(`/api/generations/${encodeURIComponent(pendingVideo.id)}`, { timeoutMs: 8_000 })
          .then(onCreated)
          .catch((confirmation) => { if ((confirmation as { status?: number }).status === 404) onCreated({ ...pendingVideo!, status: "failed", error: "任务未完成接纳，请重新生成", updatedAt: Date.now() }); });
        return;
      }
      if (pendingImage) onImagesGenerated?.({ ...pendingImage, status: "failed", error: message });
      setError(message);
    } finally { setLoading(false); }
  };

  const uploadsReady = areAttachedUploadsAdmissible(assets);
  const uploadsFinalizing = assets.some((asset) => !asset.assetId && asset.progress === 100 && asset.phase === "verifying");
  const modeReady = engine === "image" ? imageReady!
    : mode === "text" ? Boolean(prompt.trim())
    : mode === "first_frame" ? assets.length === 1 && assets[0]?.role === "first_frame"
    : mode === "first_last" ? assets.length === 2 && assets.some((asset) => asset.role === "first_frame") && assets.some((asset) => asset.role === "last_frame")
    : mode === "omni" ? assets.length > 0
    : Boolean(prompt.trim()) && assets.some((asset) => asset.type === "video");

  return <div className={`composer ${compact ? "composer--compact" : ""}`} onClick={(e) => e.stopPropagation()}>
    {!compact && <h1>今晚，想创造什么？</h1>}
    <div className="composer-shell">
      {!!assets.length && <div className="asset-strip">{assets.map((asset, index) => <div className="asset-chip" key={asset.id}>{asset.preview ? <RecoveringThumbnail src={asset.preview} alt={asset.name || "参考素材"} fallbackClassName="asset-chip__media" manualRecovery={false} /> : asset.type === "image" ? <ImageIcon /> : asset.type === "video" ? <Video /> : <AudioLines />}<span><b>{asset.role === "first_frame" ? "首帧" : asset.role === "last_frame" ? "尾帧" : `${asset.type === "image" ? "图片" : asset.type === "video" ? "视频" : "音频"} ${index + 1}`}</b><small>{asset.status === "Processing" ? "正在恢复素材引用" : asset.phase === "preparing" ? "正在检查图片" : asset.phase === "verifying" ? `${asset.name} · 已上传，可立即生成` : asset.progress === 100 ? `${asset.name}${asset.normalized ? " · 已自动补白" : ""}` : `上传 ${asset.progress ?? 0}%`}</small></span>{asset.progress !== 100 && <i style={{ width: `${asset.progress ?? 0}%` }} />}<button onClick={() => removeAttachedAsset(asset.id)}><X /></button></div>)}</div>}
      <div className={`prompt-row ${referenceSlots.length > 1 ? "prompt-row--dual" : ""} ${!referenceSlots.length ? "prompt-row--text" : ""}`}>
        {!!referenceSlots.length && <div className="reference-slots">{referenceSlots.map((label, index) => <button className="add-reference" key={label} onClick={() => { void persistPrivateMediaStorage(); fileInput.current?.click(); }} disabled={(mode === "first_frame" && assets.length >= 1) || (mode === "first_last" && assets.length > index)}><Plus /><span>{label}</span></button>)}</div>}
        <PromptEditor value={prompt} change={setPrompt} placeholder={engine === "image" ? "描述你想生成的画面；上传参考图即可进行图生图……" : modePlaceholders[mode]} assets={assets} disabled={mode === "text" && engine === "video"} attach={attachMentionAsset} />
        <input ref={fileInput} hidden type="file" multiple={mode !== "first_frame"} accept={fileAccept} onChange={(e) => pickFiles(e.target.files)} />
      </div>
      <div className="control-row">
        <div className="control-wrap"><button className="control control--accent" onClick={() => setOpen(open === "generation" ? null : "generation")}><WandSparkles /> {engine === "video" ? "视频生成" : "图片生成"} <ChevronDown /></button>{open === "generation" && <Popover className="mode-pop generation-pop"><p>选择创作类型</p><button className={engine === "video" ? "selected" : ""} aria-pressed={engine === "video"} onClick={() => { setEngine("video"); setOpen(null); }}><span className="model-icon"><Film /></span><span><b>视频生成</b><small>使用 Seedance 生成或编辑视频</small></span>{engine === "video" && <Check />}</button><button className={engine === "image" ? "selected" : ""} aria-pressed={engine === "image"} onClick={() => { setEngine("image"); setOpen(null); }}><span className="model-icon"><ImageIcon /></span><span><b>图片生成</b><small>支持文生图与图生图</small></span>{engine === "image" && <Check />}</button></Popover>}</div>
        {engine === "image" ? <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "image-model" ? null : "image-model")}><Layers3 /> {(imageSpec?.name ?? "选择图片模型")} <ChevronDown /></button>{open === "image-model" && <Popover className="model-pop image-model-pop"><p>选择图片模型</p>{imageModels.map((item) => <button key={item.id} className={item.id === imageModelId ? "selected" : ""} onClick={() => { setImageModelId(item.id); setImageResolution(item.resolutions.includes(imageResolution) ? imageResolution : (item.resolutions.includes("1024") ? "1024" : item.resolutions[item.resolutions.length - 1])); setImageCount((count) => Math.min(count, item.maxCount)); setOpen(null); }}><span className="model-icon"><ImageIcon /></span><span><b>{item.name}</b><small>{item.resolutions.join(" / ")}px · 单次最多 {item.maxCount} 张</small></span>{item.id === imageModelId && <Check />}</button>)}</Popover>}</div> : <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "model" ? null : "model")}><Layers3 /> {model.name} <Sparkles className="tiny-spark" /></button>{open === "model" && <Popover className="model-pop"><p>选择模型</p>{models.map((item) => <button key={item.id} className={item.id === model.id ? "selected" : ""} onClick={() => { setModelId(item.id); setOpen(null); }}><span className="model-icon"><Sparkles /></span><span><b>{item.name}</b><small>{item.note}</small></span>{item.id === model.id && <Check />}</button>)}</Popover>}</div>}
        {engine === "image" ? (
          <>
            <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "image-format" ? null : "image-format")}><ImageIcon /> {imageRatio} <i /> {imageResolution}px <i /> ×{imageCount} <ChevronDown /></button>{open === "image-format" && <Popover className="format-pop image-format-pop"><p>选择比例</p><div className="ratio-grid">{[["21:9", "21:9"], ["16:9", "16:9"], ["3:2", "3:2"], ["4:3", "4:3"], ["1:1", "1:1"], ["3:4", "3:4"], ["2:3", "2:3"], ["9:16", "9:16"]].map(([value, label]) => <button className={imageRatio === value ? "selected" : ""} key={value} onClick={() => setImageRatio(value)}><span className={`ratio-icon ratio-${value.replace(":", "-")}`} />{label}</button>)}</div><p>选择分辨率</p><div className="resolution-grid">{(imageSpec?.resolutions ?? ["1024"]).map((item) => <button className={imageResolution === item ? "selected" : ""} onClick={() => setImageResolution(item)} key={item}>{item}px</button>)}</div><p>生成数量</p><div className="image-count-grid">{Array.from({ length: imageSpec?.maxCount ?? 4 }, (_, index) => index + 1).map((count) => <button className={imageCount === count ? "selected" : ""} onClick={() => setImageCount(count)} key={count}>{count} 张</button>)}</div></Popover>}</div>
            <div className="control-wrap"><button className="control control--icon" aria-label="选择参考图" onClick={() => { void persistPrivateMediaStorage(); setOpen(open === "library" ? null : "library"); }}>@</button>{open === "library" && <LibraryPanel add={(asset) => { attachMentionAsset(asset); setOpen(null); }} />}</div>
          </>
        ) : (
          <>
        <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "mode" ? null : "mode")}><Clapperboard /> {modeLabels[mode]} <ChevronDown /></button>{open === "mode" && <Popover className="mode-pop">{model.modes.map((item) => <button key={item} className={item === mode ? "selected" : ""} onClick={() => { setMode(item); setOpen(null); }}><Film /><span><b>{modeLabels[item]}</b><small>{modeNotes[item]}</small></span>{item === mode && <Check />}</button>)}</Popover>}</div>
        <div className="control-wrap"><button className="control" onClick={() => setOpen(open === "format" ? null : "format")}><span className={`ratio-icon ${ratio === "adaptive" ? "ratio-adaptive" : `ratio-${ratio.replace(":", "-")}`}`} /> {ratio === "adaptive" ? "自动" : ratio} <i /> {resolution}</button>{open === "format" && <Popover className="format-pop"><p>选择画幅</p><div className="ratio-grid">{availableRatios.map((item) => <button className={item === ratio ? "selected" : ""} key={item} onClick={() => !ratioLocked && setRatio(item)}><span className={`ratio-icon ${item === "adaptive" ? "ratio-adaptive" : `ratio-${item.replace(":", "-")}`}`} />{item === "adaptive" ? "自动" : item}</button>)}</div><p>选择清晰度</p><div className="resolution-grid">{model.resolutions.map((item) => <button className={item === resolution ? "selected" : ""} onClick={() => setResolution(item)} key={item}>{item}{item === "720p" && <Sparkles />}</button>)}</div></Popover>}</div>
        <div className="control-wrap"><button className="control" disabled={durationLocked} onClick={() => !durationLocked && setOpen(open === "duration" ? null : "duration")}><Clock3 /> {durationLocked ? "自动" : `${duration}s`}</button>{open === "duration" && !durationLocked && <Popover className="duration-pop"><p>视频生成时长</p><input type="range" min={model.duration[0]} max={model.duration[1]} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /><div className="duration-scale"><span>{model.duration[0]}s</span><b>{duration} 秒</b><span>{model.duration[1]}s</span></div></Popover>}</div>
        {(["omni", "edit", "extend"] as CreationMode[]).includes(mode) && <div className="control-wrap"><button className="control control--icon" aria-label="选择素材" onClick={() => { void persistPrivateMediaStorage(); setOpen(open === "library" ? null : "library"); }}>@</button>{open === "library" && <LibraryPanel add={(asset) => { attachMentionAsset(asset); setOpen(null); }} />}</div>}
        <div className="control-wrap"><button className="control control--icon" aria-label="高级设置" onClick={() => setOpen(open === "advanced" ? null : "advanced")}><Settings2 /></button>{open === "advanced" && <Popover className="advanced-pop">{model.supportsAudio && <label><span>生成同步音频<small>由模型创作对白与环境声</small></span><input type="checkbox" checked={generateAudio} onChange={(e) => setGenerateAudio(e.target.checked)} /></label>}<label><span>固定镜头<small>减少镜头运动</small></span><input type="checkbox" checked={cameraFixed} onChange={(e) => setCameraFixed(e.target.checked)} /></label><label><span>显示水印<small>添加官方生成标识</small></span><input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} /></label><label className="seed-input"><span>随机种子<small>-1 为随机</small></span><input type="number" min="-1" value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label></Popover>}</div>
        <span className="control-spacer" />
          </>
        )}
        <button className={`send-button ${loading ? "send-button--submitted" : ""}`} title={uploadsFinalizing ? "文件已上传，后台准备引用，不影响提交" : undefined} aria-label={loading ? engine === "image" ? "图片已提交，正在生成" : "视频已提交，正在确认任务" : engine === "image" ? "生成图片" : "生成视频"} aria-busy={loading ? true : undefined} disabled={loading || !uploadsReady || !modeReady} onClick={submit}>{loading ? <Check /> : <Send />}</button>
      </div>
      {loading && <div className="composer-generation-status" role="status" aria-live="polite"><Check /><span><b>{engine === "image" ? "已提交，正在生成" : "已提交，正在确认任务"}</b><small>{engine === "image" ? "完成后会自动出现在结果区" : "接纳后会立即进入上方生成队列"}</small></span></div>}
      {draftNotice && <div className="composer-draft-status" role="status" aria-live="polite"><RefreshCw /><span>{draftNotice}</span></div>}
      {engine === "image" && imageModelCatalogError && !imageModels.length && <div className="composer-error">{imageModelCatalogError}</div>}
      {error && <div className="composer-error">{error}</div>}
    </div>
  </div>;
}
