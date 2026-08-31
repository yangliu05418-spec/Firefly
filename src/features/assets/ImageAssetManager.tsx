import { useEffect, useRef, useState } from "react";
import { Check, CheckSquare2, ImageIcon, LayoutGrid, LoaderCircle, Pencil, Plus, Search, Square, Trash2, Upload } from "lucide-react";
import { api, inferUploadType } from "../../api";
import { assetLibraryGroupsOrDefault, defaultAssetLibraryGroup } from "../../asset-library-config";
import { assetCategories, assetCategoryLabels } from "../../asset-categories";
import { useAssetCacheUserId } from "../../asset-cache-context";
import { assetMetadataCache, filterCachedAssets } from "../../asset-metadata-cache";
import { assetPreviewSource } from "../../asset-preview-source";
import { RecoveringThumbnail } from "../../recovering-image";
import type { AssetCategory, LibraryAsset, LibraryGroup } from "../../types";
import { uploadFileUntilAccepted } from "../../upload-acceptance";
import { usePendingAssetPreviews } from "../../use-pending-asset-previews";
import { persistPrivateMediaStorage } from "../../private-media-cache";
import { useLocalMediaSource } from "../../local-media-client";

function AssetThumbnail({ asset, preview }: { asset: LibraryAsset; preview: string }) {
  const { source } = useLocalMediaSource(asset.LocalMedia?.thumbnail, { warm: true, switchWhenReady: true });
  return <RecoveringThumbnail src={source ?? preview} alt={asset.Name || "图片素材"} manualRecovery={false} loading="lazy" decoding="async" />;
}

export function ImageAssetManager({ onInsertCanvas }: { onInsertCanvas: (asset: LibraryAsset) => void }) {
  const userId = useAssetCacheUserId();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [group, setGroup] = useState<LibraryGroup>(defaultAssetLibraryGroup);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | AssetCategory>("all");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [categorizing, setCategorizing] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const renaming = useRef(new Set<string>());
  const cancelRename = useRef(false);
  const uploadControllers = useRef(new Set<AbortController>());
  const pendingPreviews = usePendingAssetPreviews(userId, assets);
  const openFilePicker = () => {
    void persistPrivateMediaStorage();
    fileInput.current?.click();
  };

  const loadPage = async (requestedPage: number, replace: boolean, search = query) => {
    const sequence = ++requestSequence.current;
    replace ? setLoading(true) : setLoadingMore(true);
    setError("");
    const categoryQuery = category === "all" ? "" : `&category=${category}`;
    const freshRequest = api.get<{ Items?: LibraryAsset[]; HasMore?: boolean }>(
      `/api/assets?type=Image&page=${requestedPage}&pageSize=60&q=${encodeURIComponent(search.trim())}${categoryQuery}`,
    );
    let cached: LibraryAsset[] = [];
    if (replace) {
      cached = filterCachedAssets(await assetMetadataCache.read(userId), { type: "Image", query: search, category });
      if (sequence !== requestSequence.current) {
        void freshRequest.catch(() => undefined);
        return;
      }
      if (cached.length) {
        setAssets(cached.slice(0, 60));
        setLoading(false);
        setSelected(new Set());
      }
    }
    try {
      const result = await freshRequest;
      if (sequence !== requestSequence.current) return;
      const fresh = result.Items ?? [];
      setAssets((current) => replace ? fresh : [...current, ...fresh.filter((asset) => !current.some((item) => item.Id === asset.Id))]);
      setPage(requestedPage);
      setHasMore(Boolean(result.HasMore));
      if (replace) setSelected(new Set());
      if (requestedPage === 1 && !search.trim() && category === "all" && !result.HasMore) {
        void assetMetadataCache.replaceType(userId, "Image", fresh);
      } else {
        void assetMetadataCache.merge(userId, fresh);
      }
    } catch (loadError) {
      if (sequence === requestSequence.current) {
        setError(cached.length ? "同步暂时中断，已显示本地素材" : loadError instanceof Error ? loadError.message : "图片资产载入失败");
      }
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  useEffect(() => {
    void api.get<{ Items?: LibraryGroup[] }>("/api/assets/groups")
      .then((result) => setGroup(assetLibraryGroupsOrDefault(result.Items)[0]))
      .catch(() => undefined);
  }, []);

  useEffect(() => () => {
    for (const controller of uploadControllers.current) controller.abort();
    uploadControllers.current.clear();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPage(1, true, query), query ? 260 : 0);
    return () => window.clearTimeout(timer);
  }, [query, category]);

  useEffect(() => {
    const processing = assets.filter((asset) => asset.Status === "Processing");
    if (!processing.length) return;
    const refresh = () => void Promise.all(
      processing.map((asset) => api.get<LibraryAsset>(`/api/assets/${asset.Id}`).catch(() => asset)),
    ).then((updates) => {
      setAssets((current) => current.map((asset) => updates.find((update) => update.Id === asset.Id) ?? asset));
      void assetMetadataCache.merge(userId, updates);
    });
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [userId, assets.map((asset) => `${asset.Id}:${asset.Status}`).join("|")]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = assets.length > 0 && assets.every((asset) => selected.has(asset.Id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(assets.map((asset) => asset.Id)));

  const uploadImages = async (files?: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    const images = selectedFiles.filter((file) => inferUploadType(file) === "image");
    if (!images.length) {
      if (selectedFiles.length) setError("所选文件中没有受支持的图片");
      return;
    }
    if (images.length > 50) {
      setError("单次最多上传 50 张图片");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setUploading(true);
    setProgress({ done: 0, total: images.length });
    setError("");
    setNotice("");
    const created: LibraryAsset[] = [];
    let normalizedCount = 0;
    const failures = selectedFiles.filter((file) => !images.includes(file)).map((file) => `${file.name}（不支持的格式）`);
    let cursor = 0;
    const uploadCategory: AssetCategory = category === "all" ? "material" : category;
    const next = async () => {
      while (cursor < images.length) {
        const file = images[cursor++];
        if (!file) continue;
        const controller = new AbortController();
        let preparedPreview: Blob | undefined;
        uploadControllers.current.add(controller);
        try {
          const uploaded = await uploadFileUntilAccepted(file, "image", () => undefined, {
            signal: controller.signal,
            onPreparedPreview: (blob) => { preparedPreview = blob; },
          });
          if (uploaded.normalized) normalizedCount += 1;
          const asset = await api.post<LibraryAsset>("/api/assets", {
            groupId: group.Id,
            uploadId: uploaded.uploadId ?? uploaded.id,
            type: "Image",
            name: file.name,
            category: uploadCategory,
          });
          created.push(asset);
          const previewBlob = preparedPreview ?? (file.size <= 2 * 1024 * 1024 ? file : undefined);
          if (previewBlob) pendingPreviews.remember(asset.Id, previewBlob);
          setAssets((current) => [asset, ...current.filter((item) => item.Id !== asset.Id)]);
          void assetMetadataCache.merge(userId, [asset]);
        } catch (uploadError) {
          failures.push(`${file.name}（${uploadError instanceof Error ? uploadError.message.split(" · ")[0].slice(0, 60) : "上传失败"}）`);
        } finally {
          uploadControllers.current.delete(controller);
          setProgress((current) => current ? { ...current, done: current.done + 1 } : current);
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(3, images.length) }, next));
      if (created.length) setNotice(`${created.length} 张图片已上传，生成引用正在后台准备${normalizedCount ? `，${normalizedCount} 张已自动补白` : ""}`);
      if (failures.length) setError(`${failures.length} 张上传失败：${failures.slice(0, 3).join("、")}${failures.length > 3 ? " 等" : ""}`);
    } finally {
      setUploading(false);
      setProgress(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const startRename = (asset: LibraryAsset) => {
    cancelRename.current = false;
    setEditingId(asset.Id);
    setDraftName(asset.Name || "未命名图片");
    setError("");
  };
  const saveRename = async (asset: LibraryAsset) => {
    if (cancelRename.current) {
      cancelRename.current = false;
      return;
    }
    if (renaming.current.has(asset.Id)) return;
    const name = draftName.trim();
    if (!name || name === asset.Name) {
      setEditingId(null);
      return;
    }
    renaming.current.add(asset.Id);
    try {
      const updated = await api.patch<LibraryAsset>(`/api/assets/${asset.Id}`, { name });
      setAssets((current) => current.map((item) => item.Id === asset.Id ? updated : item));
      void assetMetadataCache.merge(userId, [updated]);
      setEditingId(null);
      setNotice("名称已更新");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "重命名失败");
    } finally {
      renaming.current.delete(asset.Id);
    }
  };

  const saveCategory = async (asset: LibraryAsset, nextCategory: AssetCategory) => {
    if (asset.Category === nextCategory || categorizing.has(asset.Id)) return;
    const previous = asset.Category;
    setCategorizing((current) => new Set(current).add(asset.Id));
    setError("");
    setAssets((current) => current.map((item) => item.Id === asset.Id ? { ...item, Category: nextCategory } : item));
    try {
      const updated = await api.patch<LibraryAsset>(`/api/assets/${asset.Id}`, { category: nextCategory });
      setAssets((current) => current.map((item) => item.Id === asset.Id ? updated : item).filter((item) => category === "all" || item.Category === category));
      void assetMetadataCache.merge(userId, [updated]);
      setNotice(`已标注为${assetCategoryLabels[nextCategory]}`);
    } catch (categoryError) {
      setAssets((current) => current.map((item) => item.Id === asset.Id ? { ...item, Category: previous } : item));
      setError(categoryError instanceof Error ? categoryError.message : "标签更新失败");
    } finally {
      setCategorizing((current) => {
        const next = new Set(current);
        next.delete(asset.Id);
        return next;
      });
    }
  };

  const deleteSelection = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    setDeleting(true);
    setError("");
    try {
      const result = await api.post<{ deleted: string[]; failed: string[] }>("/api/assets/bulk-delete", { ids });
      setAssets((current) => current.filter((asset) => !result.deleted.includes(asset.Id)));
      for (const id of result.deleted) pendingPreviews.remove(id);
      void assetMetadataCache.remove(userId, result.deleted);
      setSelected(new Set(result.failed));
      setConfirmDelete(false);
      setNotice(`${result.deleted.length} 个素材已删除`);
      if (result.failed.length) setError(`${result.failed.length} 个素材删除失败，可再次重试`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败，请稍后重试");
    } finally {
      setDeleting(false);
    }
  };

  return <section className="image-assets" aria-label="图片资产管理">
    <nav className="asset-category-tabs" aria-label="图片资产标签">
      <button className={category === "all" ? "active" : ""} onClick={() => setCategory("all")}>全部</button>
      {assetCategories.map((item) => <button key={item} className={category === item ? "active" : ""} onClick={() => setCategory(item)}>{assetCategoryLabels[item]}</button>)}
    </nav>
    <div className="image-assets__toolbar">
      <label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图片名称" aria-label="搜索图片资产" /></label>
      <div>
        {assets.length > 0 && <button className="quiet" onClick={toggleAll}>{allSelected ? <CheckSquare2 /> : <Square />}{allSelected ? "取消全选" : "全选当前页"}</button>}
        {selected.size > 0 && <button className="quiet danger" onClick={() => setConfirmDelete(true)}><Trash2 /> 删除 {selected.size} 项</button>}
        <button className="asset-upload" disabled={uploading} onClick={openFilePicker}>{uploading ? <LoaderCircle className="spin" /> : <Upload />}{progress ? `上传 ${progress.done}/${progress.total}` : "上传图片"}</button>
        <input ref={fileInput} hidden multiple type="file" accept="image/*" onChange={(event) => void uploadImages(event.target.files)} />
      </div>
    </div>
    {(notice || error) && <div className={`image-assets__feedback ${error ? "is-error" : ""}`} role="status">{error || notice}</div>}
    {loading ? <div className="image-assets__state"><LoaderCircle className="spin" /> 正在整理你的图片资产</div> : !assets.length ? <div className="image-assets__empty">
      <ImageIcon />
      <h2>{query ? "没有匹配的图片" : category === "all" ? "把常用参考图放在这里" : `${assetCategoryLabels[category]}标签下还没有图片`}</h2>
      <p>{query ? "换一个关键词，或清除搜索。" : "支持一次选择多张图片；上传时会自动归入当前标签。"}</p>
      {query ? <button onClick={() => setQuery("")}>清除搜索</button> : <button onClick={openFilePicker}><Upload /> 上传第一批图片</button>}
    </div> : <>
      <div className="image-assets__grid">{assets.map((asset) => {
        const preview = assetPreviewSource(asset, pendingPreviews.get(asset.Id));
        return <article key={asset.Id} className={`image-asset-card ${selected.has(asset.Id) ? "is-selected" : ""}`}>
          <button className="image-asset-card__media" aria-pressed={selected.has(asset.Id)} aria-label={`${selected.has(asset.Id) ? "取消选择" : "选择"} ${asset.Name}`} onClick={() => toggle(asset.Id)}>
            {preview ? <AssetThumbnail asset={asset} preview={preview} /> : <span><ImageIcon /></span>}
            <i>{selected.has(asset.Id) ? <Check /> : null}</i>
            {asset.Status !== "Active" && <small className={`status-${asset.Status.toLowerCase()}`} title={asset.Error}>{asset.Status === "Processing" ? "已上传 · 引用准备中" : "已上传 · 引用失败"}</small>}
          </button>
          <div className="image-asset-card__body">{editingId === asset.Id ? <input autoFocus value={draftName} maxLength={80} onChange={(event) => setDraftName(event.target.value)} onBlur={() => void saveRename(asset)} onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              cancelRename.current = true;
              setEditingId(null);
              event.currentTarget.blur();
            }
          }} aria-label="图片名称" /> : <>
            <span className="image-asset-card__meta">
              <h3 title={asset.Name}>{asset.Name || "未命名图片"}</h3>
              <select value={asset.Category} disabled={categorizing.has(asset.Id)} onChange={(event) => void saveCategory(asset, event.target.value as AssetCategory)} aria-label={`修改 ${asset.Name} 的标签`}>
                {assetCategories.map((item) => <option value={item} key={item}>{assetCategoryLabels[item]}</option>)}
              </select>
            </span>
            <span className="image-asset-card__actions">
              <button aria-label={`插入画布 ${asset.Name}`} disabled={!asset.UploadId || asset.Status !== "Active"} title={!asset.UploadId ? "外部链接素材暂不支持插入画布" : asset.Status !== "Active" ? "素材仍在处理中" : "插入画布"} onClick={() => onInsertCanvas(asset)}><LayoutGrid /></button>
              <button aria-label={`重命名 ${asset.Name}`} onClick={() => startRename(asset)}><Pencil /></button>
            </span>
          </>}</div>
        </article>;
      })}</div>
      {hasMore && <button className="image-assets__more" disabled={loadingMore} onClick={() => void loadPage(page + 1, false)}>{loadingMore ? <LoaderCircle className="spin" /> : <Plus />} 加载更多</button>}
    </>}
    {confirmDelete && <div className="image-delete-backdrop" role="dialog" aria-modal="true" aria-labelledby="image-delete-title" onClick={() => !deleting && setConfirmDelete(false)}>
      <div onClick={(event) => event.stopPropagation()}>
        <Trash2 />
        <h2 id="image-delete-title">删除 {selected.size} 个图片素材？</h2>
        <p>这些素材将从你的资产库移除，已提交的历史生成不会受到影响。</p>
        <footer>
          <button disabled={deleting} onClick={() => setConfirmDelete(false)}>取消</button>
          <button className="danger" disabled={deleting} onClick={() => void deleteSelection()}>{deleting ? <LoaderCircle className="spin" /> : <Trash2 />} 确认删除</button>
        </footer>
      </div>
    </div>}
  </section>;
}
