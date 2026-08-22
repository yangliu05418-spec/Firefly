import { useEffect, useRef, useState } from "react";
import { Library, LoaderCircle, Plus, Sparkles, Upload } from "lucide-react";
import { api, inferUploadType } from "../../api";
import type { LibraryAsset, LibraryGroup, UploadAsset } from "../../types";
import { useAssetCacheUserId } from "../../asset-cache-context";
import { assetMetadataCache } from "../../asset-metadata-cache";
import { uploadFileUntilAccepted } from "../../upload-acceptance";
import { assetPreviewSource } from "../../asset-preview-source";
import { usePendingAssetPreviews } from "../../use-pending-asset-previews";
import { RecoveringThumbnail } from "../../recovering-image";

export function LibraryPanel({ add }: { add: (asset: UploadAsset) => void }) {
  const userId = useAssetCacheUserId();
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; uploaded: number; total: number } | null>(null);
  const [groupName, setGroupName] = useState("");
  const [rights, setRights] = useState(false);
  const libraryFile = useRef<HTMLInputElement>(null);
  const batchControllers = useRef(new Set<AbortController>());
  const pendingPreviews = usePendingAssetPreviews(userId, assets);

  useEffect(() => {
    let active = true;
    void (async () => {
      const freshRequest = Promise.allSettled([
        api.get<{ Items?: LibraryGroup[] }>("/api/assets/groups"),
        api.get<{ Items?: LibraryAsset[]; HasMore?: boolean }>("/api/assets?pageSize=100"),
      ]);
      const cached = await assetMetadataCache.read(userId);
      if (active && cached.length) {
        setAssets(cached);
        setLoading(false);
      }
      const [groupResult, assetResult] = await freshRequest;
      if (!active) return;
      if (groupResult.status === "fulfilled") setGroups(groupResult.value.Items ?? []);
      if (assetResult.status === "fulfilled") {
        const fresh = assetResult.value.Items ?? [];
        setAssets(fresh);
        void (assetResult.value.HasMore ? assetMetadataCache.merge(userId, fresh) : assetMetadataCache.replace(userId, fresh));
      }
      if (groupResult.status === "rejected" && assetResult.status === "rejected") {
        setError(cached.length ? "素材同步暂时中断，已显示本地缓存" : "素材空间暂时不可用");
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [userId]);

  useEffect(() => () => {
    for (const controller of batchControllers.current) controller.abort();
    batchControllers.current.clear();
  }, []);

  useEffect(() => {
    const processing = assets.filter((asset) => asset.Status === "Processing");
    if (!processing.length) return;
    const refresh = () => void Promise.all(processing.map((asset) => api.get<LibraryAsset>(`/api/assets/${asset.Id}`).catch(() => asset))).then((updates) => {
      setAssets((current) => current.map((asset) => updates.find((update) => update.Id === asset.Id) ?? asset));
      void assetMetadataCache.merge(userId, updates);
    });
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [userId, assets.map((asset) => `${asset.Id}:${asset.Status}`).join("|")]);

  const createGroup = async () => {
    if (!groupName.trim()) return;
    setCreating(true);
    setError("");
    try {
      const result = await api.post<{ Id: string }>("/api/assets/groups", { name: groupName, description: "Created by Firefly" });
      setGroups((old) => [{ Id: result.Id, Name: groupName }, ...old]);
      setGroupName("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "无法创建角色分组");
    } finally {
      setCreating(false);
    }
  };

  const ingest = async (selected?: FileList | null) => {
    const files = Array.from(selected ?? []);
    if (!files.length || !groups[0] || !rights) return;
    if (files.length > 50) {
      setError("单次最多选择 50 个素材，请分批上传");
      if (libraryFile.current) libraryFile.current.value = "";
      return;
    }
    setCreating(true);
    setError("");
    setNotice("");
    setBatchProgress({ done: 0, uploaded: 0, total: files.length });
    const failures: string[] = [];
    let normalizedCount = 0;
    let cursor = 0;
    const uploadNext = async () => {
      while (cursor < files.length) {
        const file = files[cursor++];
        const controller = new AbortController();
        batchControllers.current.add(controller);
        try {
          const type = inferUploadType(file);
          if (!type) throw new Error("不支持此素材格式");
          let preparedPreview: Blob | undefined;
          const uploaded = await uploadFileUntilAccepted(file, type, () => undefined, {
            signal: controller.signal,
            onPreparedPreview: type === "image" ? (blob) => { preparedPreview = blob; } : undefined,
            onTransportComplete: () => setBatchProgress((progress) => progress ? { ...progress, uploaded: progress.uploaded + 1 } : progress),
          });
          if (uploaded.normalized) normalizedCount += 1;
          const result = await api.post<LibraryAsset>("/api/assets", {
            groupId: groups[0].Id,
            uploadId: uploaded.uploadId ?? uploaded.id,
            url: "url" in uploaded ? uploaded.url : undefined,
            type: `${type[0].toUpperCase()}${type.slice(1)}`,
            name: file.name,
            category: "character",
          });
          const previewBlob = preparedPreview ?? (type === "image" && file.size <= 2 * 1024 * 1024 ? file : undefined);
          if (previewBlob) pendingPreviews.remember(result.Id, previewBlob);
          setAssets((old) => [result, ...old]);
          void assetMetadataCache.merge(userId, [result]);
        } catch (failure) {
          failures.push(`${file.name}（${failure instanceof Error ? failure.message.split(" · ")[0].slice(0, 60) : "上传失败"}）`);
        } finally {
          batchControllers.current.delete(controller);
          setBatchProgress((progress) => progress ? { ...progress, done: progress.done + 1 } : progress);
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, files.length) }, uploadNext));
      const succeeded = files.length - failures.length;
      if (succeeded) setNotice(`${succeeded} 个素材已上传，生成引用正在后台准备${normalizedCount ? `；${normalizedCount} 张图片已自动补白` : ""}`);
      if (failures.length) setError(`${failures.length} 个素材上传失败：${failures.slice(0, 3).join("、")}${failures.length > 3 ? " 等" : ""}`);
    } finally {
      setCreating(false);
      setBatchProgress(null);
      if (libraryFile.current) libraryFile.current.value = "";
    }
  };

  return <div className="popover library-pop" onClick={(event) => event.stopPropagation()}>
    <div className="popover-title"><span><Library /> 可信角色库</span><small>AI 角色素材</small></div>
    {loading ? <div className="panel-state"><LoaderCircle className="spin" /> 正在读取角色库</div> : error && !groups.length ? <div className="panel-state panel-state--error">{error}</div> : <>
      {assets.length ? <div className="library-list">{assets.map((asset) => {
        const preview = assetPreviewSource(asset, pendingPreviews.get(asset.Id));
        return <button key={asset.Id} disabled={asset.Status !== "Active"} title={asset.Error} onClick={() => add({ id: asset.Id, uploadId: asset.UploadId, assetId: asset.Id, name: asset.Name || asset.Id, type: asset.AssetType.toLowerCase() as UploadAsset["type"], size: 0, role: asset.AssetType === "Image" ? "reference_image" : asset.AssetType === "Video" ? "reference_video" : "reference_audio", progress: 100, preview: asset.URL, status: asset.Status })}>
          {preview && asset.AssetType === "Image" ? <RecoveringThumbnail src={preview} alt={asset.Name || "素材图片"} fallbackClassName="library-thumb" manualRecovery={false} loading="lazy" decoding="async" /> : <span className="library-thumb"><Sparkles /></span>}
          <span><b>{asset.Name || "未命名角色"}</b><small>{asset.Status === "Processing" ? "已上传 · 引用准备中" : asset.Status === "Failed" ? "已上传 · 引用准备失败" : groups.find((group) => group.Id === asset.GroupId)?.Name ?? asset.AssetType}</small></span>
          <i className={`status-dot status-${asset.Status.toLowerCase()}`} />
        </button>;
      })}</div> : <div className="panel-state panel-state--short"><Library /><b>还没有可用角色</b><small>创建分组后上传你的 AI 角色素材</small></div>}
      <div className="library-create">
        {groups.length ? <>
          <label><input type="checkbox" checked={rights} onChange={(event) => setRights(event.target.checked)} /> 我确认素材为 AI 角色且拥有完整权利</label>
          <button disabled={!rights || creating} onClick={() => libraryFile.current?.click()}>{creating ? <LoaderCircle className="spin" /> : <Upload />} {creating && batchProgress ? batchProgress.uploaded > batchProgress.done ? `已上传 ${batchProgress.uploaded}/${batchProgress.total} · 正在准备引用` : `正在上传 ${batchProgress.done}/${batchProgress.total}` : `批量上传到「${groups[0].Name}」`}</button>
          <input hidden ref={libraryFile} type="file" multiple accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav" onChange={(event) => void ingest(event.target.files)} />
        </> : <>
          <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="输入第一个角色分组名称" />
          <button disabled={creating || !groupName.trim()} onClick={createGroup}><Plus /> 创建角色分组</button>
        </>}
        {notice && <small className="library-success">{notice}</small>}
        {error && <small className="library-error">{error}</small>}
      </div>
    </>}
  </div>;
}
