import { useEffect, useMemo, useRef, useState } from 'react';
import { atlasApi } from '../api';
import type { AtlasAsset, FireflyLibraryAsset } from '../model';
import { formatBytes } from '../capabilities';
import { useI18n } from '../i18n';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function MediaPanel({
  readOnly,
  projectId,
  assets,
  selectedAssetId,
  onSelect,
  onFiles,
  onAddTimeline,
  onRetry,
  onRelink,
  onImported,
  error,
}: {
  readOnly: boolean;
  projectId: string;
  assets: AtlasAsset[];
  selectedAssetId: string | null;
  onSelect: (assetId: string) => void;
  onFiles: (files: File[]) => void;
  onAddTimeline: (assetId: string) => void;
  onRetry: (assetId: string) => void;
  onRelink: (assetId: string, file: File) => void;
  onImported: (asset: AtlasAsset) => void;
  error?: string | null;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const relinkInputRef = useRef<HTMLInputElement>(null);
  const relinkAssetIdRef = useRef<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [library, setLibrary] = useState<FireflyLibraryAsset[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryReload, setLibraryReload] = useState(0);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryPartial, setLibraryPartial] = useState(false);
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState<Set<string>>(new Set());
  const [importError, setImportError] = useState<string | null>(null);
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  useEffect(() => {
    if (readOnly) setLibraryOpen(false);
  }, [readOnly]);

  useEffect(() => {
    if (!libraryOpen) return;
    setLibraryLoading(true);
    setLibraryError(null);
    setLibraryPartial(false);
    void atlasApi.listLibrary()
      .then((result) => {
        setLibrary(result.items);
        setLibraryPartial(result.partial);
      })
      .catch(() => setLibraryError(t('media.libraryLoadFailed')))
      .finally(() => setLibraryLoading(false));
  }, [libraryOpen, libraryReload, t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? library.filter((asset) => asset.name.toLocaleLowerCase().includes(needle)) : library;
  }, [library, query]);

  const importAsset = async (asset: FireflyLibraryAsset) => {
    if (readOnlyRef.current) return;
    setImportError(null);
    setImporting((current) => new Set(current).add(asset.id));
    try {
      const imported = await atlasApi.importAsset(projectId, asset);
      if (readOnlyRef.current) return;
      onImported({
        ...imported,
        kind: imported.kind ?? asset.kind,
        name: imported.name ?? asset.name,
        status: imported.status ?? 'ready',
        source: 'firefly',
        sourceId: asset.id,
        mediaUrl: imported.mediaUrl ?? `/api/atlas/project-assets/${encodeURIComponent(imported.id)}/media`,
      });
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t('media.importFailed'));
    } finally {
      setImporting((current) => {
        const next = new Set(current);
        next.delete(asset.id);
        return next;
      });
    }
  };

  return (
    <aside className="atlas-media-panel" aria-label={t('media.title')} aria-disabled={readOnly || undefined}>
      <header className="atlas-panel-heading">
        <div><span className="atlas-panel-heading__index">01</span><h2>{t('media.title')}</h2></div>
        <span>{assets.length}</span>
      </header>
      <div className="atlas-media-actions">
        <button className="atlas-button atlas-button--soft" type="button" disabled={readOnly} onClick={() => inputRef.current?.click()}><Icon name="upload" />{t('media.importLocal')}</button>
        <button className="atlas-button atlas-button--quiet" type="button" disabled={readOnly} onClick={() => setLibraryOpen(true)}><Icon name="library" />{t('media.importLibrary')}</button>
        <input
          ref={inputRef}
          type="file"
          multiple
          disabled={readOnly}
          hidden
          accept="video/*,audio/*,image/*"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            if (!readOnlyRef.current && files.length) onFiles(files);
            event.target.value = '';
          }}
        />
        <input
          ref={relinkInputRef}
          type="file"
          disabled={readOnly}
          hidden
          accept="video/*,audio/*,image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            const assetId = relinkAssetIdRef.current;
            if (!readOnlyRef.current && file && assetId) onRelink(assetId, file);
            relinkAssetIdRef.current = null;
            event.target.value = '';
          }}
        />
      </div>
      {error && <div className="atlas-inline-alert atlas-inline-alert--error" role="alert"><Icon name="warning" /><span><strong>{error}</strong></span></div>}
      <p className="atlas-panel-note">{t('media.localHint')}</p>
      <div className="atlas-media-list">
        {assets.length ? assets.map((asset) => (
          <article
            className={`atlas-media-card${selectedAssetId === asset.id ? ' is-selected' : ''}`}
            key={asset.id}
            draggable={!readOnly}
            onDragStart={(event) => {
              if (readOnly) { event.preventDefault(); return; }
              event.dataTransfer.setData('text/plain', `asset:${asset.id}`);
            }}
          >
            <button className="atlas-media-card__preview" type="button" onClick={() => onSelect(asset.id)} aria-label={`${t('preview.title')}：${asset.name}`}>
              {asset.kind === 'image' && (asset.objectUrl || asset.mediaUrl) && <img src={asset.objectUrl ?? asset.mediaUrl} alt="" loading="lazy" />}
              {asset.kind === 'video' && <>{asset.posterUrl ? <img src={asset.posterUrl} alt="" loading="lazy" /> : <span className="atlas-media-card__film"><Icon name="video" /></span>}<span className="atlas-media-card__type"><Icon name="video" /></span></>}
              {asset.kind === 'audio' && <span className="atlas-media-card__wave" aria-hidden="true">{[8, 16, 10, 23, 17, 28, 13, 20, 9, 16].map((height, index) => <i key={index} style={{ height }} />)}</span>}
            </button>
            <div className="atlas-media-card__meta">
              <strong title={asset.name}>{asset.name}</strong>
              <small>{formatBytes(asset.size)} · {asset.status === 'uploading' ? t('media.uploading') : asset.status === 'failed' ? t('media.failed') : t('media.ready')}</small>
            </div>
            <div className="atlas-media-card__actions">
              {asset.status === 'failed' && <button className="atlas-icon-button" type="button" disabled={readOnly} onClick={() => onRetry(asset.id)} aria-label={`${t('media.retryUpload')}：${asset.name}`} title={asset.error ?? t('media.retryUpload')}><Icon name="refresh" /></button>}
              {asset.status === 'failed' && asset.source === 'local' && !asset.sourceId && <button className="atlas-icon-button" type="button" disabled={readOnly} onClick={() => { relinkAssetIdRef.current = asset.id; relinkInputRef.current?.click(); }} aria-label={`${t('media.reconnect')}：${asset.name}`} title={t('media.reconnect')}><Icon name="upload" /></button>}
              <button className="atlas-icon-button" type="button" disabled={readOnly} onClick={() => onAddTimeline(asset.id)} aria-label={`${t('media.addTimeline')}：${asset.name}`}><Icon name="plus" /></button>
            </div>
          </article>
        )) : (
          <div className="atlas-panel-empty"><Icon name="folder" /><strong>{t('media.emptyTitle')}</strong><span>{t('media.emptyBody')}</span></div>
        )}
      </div>

      {libraryOpen && (
        <Modal title={t('media.libraryTitle')} onClose={() => setLibraryOpen(false)}>
          <p className="atlas-modal-note">{t('media.libraryHint')}</p>
          {importError && <div className="atlas-inline-alert atlas-inline-alert--error" role="alert"><Icon name="warning" /><span><strong>{importError}</strong></span></div>}
          {libraryError && <div className="atlas-inline-alert atlas-inline-alert--error" role="alert"><Icon name="warning" /><span><strong>{libraryError}</strong></span><button className="atlas-button atlas-button--quiet" type="button" onClick={() => setLibraryReload((value) => value + 1)}><Icon name="refresh" />{t('app.retry')}</button></div>}
          {libraryPartial && !libraryError && <div className="atlas-inline-alert" role="status"><Icon name="warning" /><span>{t('media.libraryPartial')}</span></div>}
          <label className="atlas-search"><Icon name="search" /><span className="sr-only">{t('app.search')}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('app.search')} /></label>
          <div className="atlas-library-grid" aria-busy={libraryLoading}>
            {libraryLoading ? [0, 1, 2, 3].map((item) => <div className="atlas-library-card atlas-library-card--skeleton" key={item} />) : filtered.length ? filtered.map((asset) => {
              const alreadyImported = assets.some((current) => current.sourceId === asset.id);
              return (
                <article className="atlas-library-card" key={`${asset.sourceType}-${asset.id}`}>
                  <div className="atlas-library-card__preview">
                    {asset.posterUrl || (asset.kind === 'image' && asset.previewUrl)
                      ? <img src={asset.posterUrl ?? asset.previewUrl} alt="" loading="lazy" />
                      : <Icon name={asset.kind} />}
                    <span><Icon name={asset.kind} /></span>
                  </div>
                  <strong title={asset.name}>{asset.name}</strong>
                  <button className="atlas-button atlas-button--soft" type="button" disabled={readOnly || alreadyImported || importing.has(asset.id)} onClick={() => void importAsset(asset)}>
                    {alreadyImported ? <><Icon name="check" />{t('media.imported')}</> : importing.has(asset.id) ? t('media.loading') : t('media.import')}
                  </button>
                </article>
              );
            }) : <div className="atlas-panel-empty"><Icon name="library" /><span>{t('media.libraryEmpty')}</span></div>}
          </div>
        </Modal>
      )}
    </aside>
  );
}
