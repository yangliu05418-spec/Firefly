import { useEffect, useMemo, useRef, useState } from "react";
import { Download, GripVertical, LoaderCircle, Pause, Play, Scissors, Trash2, Volume2, VolumeX, X } from "lucide-react";
import { cancelCanvasExport, completeCanvasExport, createCanvasExport, createCanvasMontage, updateCanvasMontage, type CanvasMontage as MontageRecord, type CanvasProjectAsset, type MontageTimeline } from "../canvas-api";

const makeTimeline = (assets: CanvasProjectAsset[]): MontageTimeline => {
  let startMs = 0;
  return { video: assets.map((asset) => { const durationMs = Math.max(1000, asset.durationMs ?? 5000); const clip = { id: `clip-${crypto.randomUUID()}`, projectAssetId: asset.id, startMs, durationMs, trimStartMs: 0, trimEndMs: 0, muted: false }; startMs += durationMs; return clip; }), audio: [], settings: { width: 1920, height: 1080, fps: 30 } };
};

const normalizeStarts = (timeline: MontageTimeline): MontageTimeline => {
  let startMs = 0;
  const video = timeline.video.map((clip) => { const next = { ...clip, startMs }; startMs += Math.max(1, clip.durationMs - clip.trimStartMs - clip.trimEndMs); return next; });
  let audioStartMs = 0;
  const audio = timeline.audio.map((clip) => { const next = { ...clip, startMs: audioStartMs }; audioStartMs += Math.max(1, clip.durationMs - clip.trimStartMs - clip.trimEndMs); return next; });
  return { ...timeline, video, audio };
};

export function CanvasMontage({ canvasId, initialAssets, allAssets, onClose, onComplete }: { canvasId: string; initialAssets: CanvasProjectAsset[]; allAssets: CanvasProjectAsset[]; onClose: () => void; onComplete: (asset: CanvasProjectAsset) => void }) {
  const [timeline, setTimeline] = useState(() => makeTimeline(initialAssets));
  const [record, setRecord] = useState<MontageRecord | null>(null);
  const [state, setState] = useState<"ready" | "saving" | "exporting" | "complete" | "error">("saving");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [activeClip, setActiveClip] = useState(0);
  const [playing, setPlaying] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const exportIdRef = useRef("");
  const saveTimer = useRef<number | undefined>(undefined);
  const recordRef = useRef<MontageRecord | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());
  const videos = allAssets.filter((asset) => asset.kind === "video");
  const audios = allAssets.filter((asset) => asset.kind === "audio");
  const current = timeline.video[activeClip];
  const currentAsset = allAssets.find((asset) => asset.id === current?.projectAssetId);
  const totalMs = useMemo(() => timeline.video.reduce((total, clip) => total + Math.max(1, clip.durationMs - clip.trimStartMs - clip.trimEndMs), 0), [timeline.video]);

  useEffect(() => {
    let active = true;
    void createCanvasMontage(canvasId, timeline).then((value) => { if (active) { recordRef.current = value; setRecord(value); setState("ready"); } }).catch((failure) => { if (active) { setError(failure instanceof Error ? failure.message : "无法创建 Montage"); setState("error"); } });
    return () => { active = false; };
  }, []);
  useEffect(() => () => { workerRef.current?.postMessage({ type: "cancel" }); workerRef.current?.terminate(); if (exportIdRef.current) void cancelCanvasExport(canvasId, exportIdRef.current); }, [canvasId]);

  const persistTimeline = (next: MontageTimeline) => {
    const run = saveChain.current.then(async () => {
      const base = recordRef.current;
      if (!base) throw new Error("Montage 尚未准备完成");
      const saved = await updateCanvasMontage(canvasId, base.id, base.revision, next);
      recordRef.current = saved; setRecord(saved); setState("ready");
    });
    saveChain.current = run.catch(() => undefined);
    return run;
  };
  const update = (next: MontageTimeline) => {
    const normalized = normalizeStarts(next); setTimeline(normalized);
    if (!recordRef.current) return;
    window.clearTimeout(saveTimer.current); setState("saving");
    saveTimer.current = window.setTimeout(() => void persistTimeline(normalized).catch((failure) => { setError(failure instanceof Error ? failure.message : "时间线保存失败"); setState("error"); }), 450);
  };
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= timeline.video.length) return; const video = [...timeline.video]; [video[index], video[target]] = [video[target], video[index]]; update({ ...timeline, video }); setActiveClip(target); };
  const patchClip = (id: string, patch: Partial<MontageTimeline["video"][number]>) => update({ ...timeline, video: timeline.video.map((clip) => clip.id === id ? { ...clip, ...patch } : clip) });
  const remove = (id: string) => { update({ ...timeline, video: timeline.video.filter((clip) => clip.id !== id) }); setActiveClip(0); };
  const addVideo = (assetId: string) => { const asset = allAssets.find((item) => item.id === assetId); if (!asset) return; update({ ...timeline, video: [...timeline.video, { id: `clip-${crypto.randomUUID()}`, projectAssetId: asset.id, startMs: totalMs, durationMs: asset.durationMs ?? 5000, trimStartMs: 0, trimEndMs: 0, muted: false }] }); };
  const addAudio = (assetId: string) => { const asset = allAssets.find((item) => item.id === assetId); if (!asset) return; const startMs = timeline.audio.reduce((total, clip) => total + clip.durationMs - clip.trimStartMs - clip.trimEndMs, 0); update({ ...timeline, audio: [...timeline.audio, { id: `audio-clip-${crypto.randomUUID()}`, projectAssetId: asset.id, startMs, durationMs: asset.durationMs ?? Math.max(totalMs, 1000), trimStartMs: 0, trimEndMs: 0 }] }); };
  const splitCurrent = () => {
    const clip = timeline.video[activeClip];
    const sourceTimeMs = Math.round((previewRef.current?.currentTime ?? (clip ? clip.trimStartMs / 1000 : 0)) * 1000);
    if (!clip || sourceTimeMs <= clip.trimStartMs + 100 || sourceTimeMs >= clip.durationMs - clip.trimEndMs - 100) return setError("请将播放头移动到片段中间再分割");
    const first = { ...clip, trimEndMs: clip.durationMs - sourceTimeMs };
    const second = { ...clip, id: `clip-${crypto.randomUUID()}`, trimStartMs: sourceTimeMs };
    update({ ...timeline, video: [...timeline.video.slice(0, activeClip), first, second, ...timeline.video.slice(activeClip + 1)] });
    setActiveClip(activeClip + 1); setError("");
  };

  useEffect(() => {
    const video = previewRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => setPlaying(false)); else video.pause();
  }, [playing, activeClip]);

  const startExport = async () => {
    if (!record || !timeline.video.length || totalMs > 600_000) return;
    setState("exporting"); setProgress(0); setError("");
    try {
      window.clearTimeout(saveTimer.current);
      await persistTimeline(timeline);
      const saved = recordRef.current;
      if (!saved) throw new Error("Montage 尚未准备完成");
      const session = await createCanvasExport(canvasId, saved.id, 1); exportIdRef.current = session.id;
      const worker = new Worker(new URL("./montage-export.worker.ts", import.meta.url), { type: "module" }); workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<{ type: string; progress?: number; parts?: { partNumber: number; etag: string }[]; message?: string }>) => {
        if (event.data.type === "progress" || event.data.type === "upload") setProgress(Math.round((event.data.progress ?? 0) * 100));
        if (event.data.type === "error") { setError(event.data.message ?? "导出失败"); setState("error"); void cancelCanvasExport(canvasId, session.id); exportIdRef.current = ""; worker.terminate(); }
        if (event.data.type === "complete" && event.data.parts) void completeCanvasExport(canvasId, session.id, event.data.parts).then((result) => { exportIdRef.current = ""; setProgress(100); setState("complete"); onComplete(result.projectAsset); worker.terminate(); }).catch((failure) => { setError(failure instanceof Error ? failure.message : "导出归档失败"); setState("error"); });
      };
      worker.postMessage({ type: "start", canvasId, exportId: session.id, partSize: session.partSize, timeline, assets: allAssets.map((asset) => ({ id: asset.id, mediaUrl: asset.mediaUrl })) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "导出失败"); setState("error"); }
  };
  const cancel = () => { workerRef.current?.postMessage({ type: "cancel" }); if (exportIdRef.current) void cancelCanvasExport(canvasId, exportIdRef.current); exportIdRef.current = ""; setState("ready"); setProgress(0); };

  return <div className="canvas-v2-modal canvas-v2-montage-modal" role="dialog" aria-modal="true" aria-label="Montage"><section className="canvas-v2-montage">
    <header><div><span>MONTAGE</span><b>将片段编成一条时间线</b></div><p>{Math.round(totalMs / 100) / 10}s · {timeline.settings.width}×{timeline.settings.height} · {timeline.settings.fps}fps</p><button onClick={onClose} disabled={state === "exporting"}><X /></button></header>
    <div className="canvas-v2-montage__preview">{currentAsset ? <video ref={previewRef} key={`${currentAsset.id}-${current?.id}`} src={currentAsset.mediaUrl} controls onLoadedMetadata={(event) => { event.currentTarget.currentTime = (current?.trimStartMs ?? 0) / 1000; }} onTimeUpdate={(event) => { if (current && event.currentTarget.currentTime * 1000 >= current.durationMs - current.trimEndMs) { event.currentTarget.pause(); setPlaying(false); } }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} /> : <div>选择一个片段开始预览</div>}</div>
    <div className="canvas-v2-montage__transport"><button onClick={() => setPlaying((value) => !value)}>{playing ? <Pause /> : <Play />}</button><button onClick={splitCurrent} disabled={!current}><Scissors /> 播放头处分割</button><span>{currentAsset?.title ?? "No clip"}</span><label>画质<select value={`${timeline.settings.width}x${timeline.settings.height}`} onChange={(event) => { const [width, height] = event.target.value.split("x").map(Number); update({ ...timeline, settings: { ...timeline.settings, width, height } }); }}><option value="1280x720">720p</option><option value="1920x1080">1080p</option></select></label><label>帧率<select value={timeline.settings.fps} onChange={(event) => update({ ...timeline, settings: { ...timeline.settings, fps: Number(event.target.value) } })}><option value={24}>24fps</option><option value={30}>30fps</option></select></label></div>
    <div className="canvas-v2-montage__timeline">
      <header><span>VIDEO 01</span><select value="" onChange={(event) => { addVideo(event.target.value); event.target.value = ""; }}><option value="">+ 添加视频</option>{videos.map((asset) => <option value={asset.id} key={asset.id}>{asset.title}</option>)}</select></header>
      <div className="canvas-v2-montage__clips">{timeline.video.map((clip, index) => { const asset = allAssets.find((item) => item.id === clip.projectAssetId); return <article key={clip.id} className={index === activeClip ? "active" : ""} onClick={() => setActiveClip(index)}><GripVertical /><div><b>{asset?.title ?? "视频片段"}</b><small>{Math.round((clip.durationMs - clip.trimStartMs - clip.trimEndMs) / 100) / 10}s</small></div><label title="左裁剪"><Scissors /><input type="number" min={0} max={clip.durationMs - clip.trimEndMs - 100} step={100} value={clip.trimStartMs} onChange={(event) => patchClip(clip.id, { trimStartMs: Number(event.target.value) })} /></label><label title="右裁剪"><input type="number" min={0} max={clip.durationMs - clip.trimStartMs - 100} step={100} value={clip.trimEndMs} onChange={(event) => patchClip(clip.id, { trimEndMs: Number(event.target.value) })} /></label><button onClick={(event) => { event.stopPropagation(); patchClip(clip.id, { muted: !clip.muted }); }}>{clip.muted ? <VolumeX /> : <Volume2 />}</button><button onClick={(event) => { event.stopPropagation(); move(index, -1); }}>←</button><button onClick={(event) => { event.stopPropagation(); move(index, 1); }}>→</button><button onClick={(event) => { event.stopPropagation(); remove(clip.id); }}><Trash2 /></button></article>; })}</div>
      <header><span>AUDIO 01</span><small>{timeline.audio.length ? "外部音频会替代片段原声" : "未添加外部音频时保留未静音片段的原声"}</small><select value="" onChange={(event) => { addAudio(event.target.value); event.target.value = ""; }}><option value="">+ 添加音频</option>{audios.map((asset) => <option value={asset.id} key={asset.id}>{asset.title}</option>)}</select></header>
      {timeline.audio.length > 0 && <div className="canvas-v2-montage__clips canvas-v2-montage__clips--audio">{timeline.audio.map((clip) => { const asset = allAssets.find((item) => item.id === clip.projectAssetId); return <article key={clip.id}><Volume2 /><div><b>{asset?.title ?? "音频片段"}</b><small>{Math.round((clip.durationMs - clip.trimStartMs - clip.trimEndMs) / 100) / 10}s</small></div><span /><span /><span /><span /><span /><button onClick={() => update({ ...timeline, audio: timeline.audio.filter((item) => item.id !== clip.id) })}><Trash2 /></button></article>; })}</div>}
    </div>
    <footer>{error && <span className="error">{error}</span>}{state === "saving" && <span><LoaderCircle className="spin" /> 保存时间线</span>}{state === "exporting" && <div className="canvas-v2-montage__progress"><i><em style={{ width: `${progress}%` }} /></i><span>{progress}% · 页面保持打开，编码在独立线程运行</span></div>}<button onClick={state === "exporting" ? cancel : onClose}>{state === "exporting" ? "取消导出" : "关闭"}</button><button className="primary" disabled={!record || !timeline.video.length || state === "saving" || state === "exporting"} onClick={() => void startExport()}>{state === "exporting" ? <LoaderCircle className="spin" /> : <Download />} 导出 MP4</button></footer>
  </section></div>;
}
