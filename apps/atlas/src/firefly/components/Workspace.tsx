import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ApiError, atlasApi, uploadLocalAsset } from '../api';
import { createEditorHistory, createTimelinePlayback, guardedEditorReducer, timelinePlaybackReducer, type EditorAction } from '../timeline';
import { createId, stripRuntimeUrls, type AtlasAsset, type AtlasBootstrap, type AtlasDocument, type AtlasProjectSummary } from '../model';
import { mediaKindForFile, readMediaMetadata } from '../media';
import { enforceAtlasStorageQuota, loadLocalBlob, requestPersistentStorage, saveLocalBlob, saveLocalProject } from '../storage';
import { useI18n } from '../i18n';
import { AgentPanel, type AgentExportRequest, type AgentMutationContext } from './AgentPanel';
import { AtlasBrand } from './Brand';
import { ExportPanel } from './ExportPanel';
import { Icon } from './Icon';
import { InspectorPanel } from './InspectorPanel';
import { MediaPanel } from './MediaPanel';
import { Modal } from './Modal';
import { PreviewPanel } from './PreviewPanel';
import { TimelineView } from './TimelineView';

type SaveStatus = 'saved' | 'local' | 'saving' | 'failed';
const LEASE_RELOAD_HANDOFF_MAX_AGE_MS = 60_000;

export function Workspace({
  bootstrap,
  initialDocument,
  onBack,
  onProjectUpdated,
  onOpenProject,
}: {
  bootstrap: AtlasBootstrap;
  initialDocument: AtlasDocument;
  onBack: () => void;
  onProjectUpdated: (project: AtlasProjectSummary) => void;
  onOpenProject: (project: AtlasProjectSummary) => void;
}) {
  const { t } = useI18n();
  const mutationLockRef = useRef(false);
  const [history, baseDispatch] = useReducer(
    (state: ReturnType<typeof createEditorHistory>, action: EditorAction) => guardedEditorReducer(state, action, mutationLockRef.current),
    createEditorHistory(normalizeDocument(initialDocument)),
  );
  const dispatch = useCallback((action: EditorAction) => baseDispatch(action), []);
  const document = history.present;
  // Transport state is intentionally outside the editor history. Seeking and
  // playback must not dirty the project, increment its revision, or autosave.
  const [playback, playbackDispatch] = useReducer(timelinePlaybackReducer, document.playhead, createTimelinePlayback);
  const setPlaybackPlaying = useCallback((playing: boolean) => playbackDispatch({ type: playing ? 'play' : 'pause' }), []);
  const seekPlayback = useCallback((time: number) => playbackDispatch({ type: 'seek', time }), []);
  const [serverRevision, setServerRevision] = useState(initialDocument.revision);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(document.assets[0]?.id ?? null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [readOnly, setReadOnly] = useState(true);
  const [agentMutationLocked, setAgentMutationLocked] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [storageDenied, setStorageDenied] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [agentExport, setAgentExport] = useState<AgentExportRequest | null>(null);
  const documentRef = useRef(document);
  const readOnlyRef = useRef(readOnly);
  const serverRevisionRef = useRef(serverRevision);
  const dirtyRef = useRef(false);
  const changeSequenceRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const saveInFlightPromiseRef = useRef<Promise<void> | null>(null);
  const localWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const projectTitleRef = useRef(initialDocument.title);
  const cloudTimerRef = useRef<number | null>(null);
  const leaseRef = useRef<{ token: string; deviceId: string; expiresAt: number } | null>(null);
  const uploadPoolRef = useRef(createTaskPool(2));
  const activeUploadAssetIdsRef = useRef(new Set<string>());
  const leaseAcquireInFlightRef = useRef(false);
  const leaseResumePendingRef = useRef<{ token: string; attempt: number } | null>(null);
  const leaseResumeTimerRef = useRef<number | null>(null);
  const recoverLeaseRef = useRef<() => void>(() => undefined);
  const pageHidingRef = useRef(false);
  const initialHydrationRef = useRef(true);
  const deviceIdRef = useRef(getDeviceId(bootstrap.user.id));

  documentRef.current = document;
  readOnlyRef.current = readOnly;
  serverRevisionRef.current = serverRevision;

  const selectedClip = document.clips.find((clip) => clip.id === selectedClipId);
  const selectedTrackLocked = Boolean(selectedClip && document.tracks.find((track) => track.id === selectedClip.trackId)?.locked);
  const previewAssetId = selectedClip?.assetId ?? selectedAssetId;
  const selectedAsset = document.assets.find((asset) => asset.id === previewAssetId);
  const effectiveReadOnly = readOnly || agentMutationLocked;

  const persistLocalProject = useCallback((snapshot: AtlasDocument) => {
    const write = localWriteChainRef.current.catch(() => undefined).then(() => saveLocalProject(bootstrap.user.id, snapshot));
    localWriteChainRef.current = write.catch(() => undefined);
    return write;
  }, [bootstrap.user.id]);

  const flushLocalSnapshot = useCallback(() => persistLocalProject({
    ...documentRef.current,
    revision: serverRevisionRef.current,
  }), [persistLocalProject]);

  const saveCloud = useCallback(async () => {
    const lease = leaseRef.current;
    if (readOnlyRef.current || mutationLockRef.current || !dirtyRef.current || !lease || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    let finishSave: (() => void) | undefined;
    saveInFlightPromiseRef.current = new Promise<void>((resolve) => { finishSave = resolve; });
    setSaveStatus('saving');
    const snapshot = { ...stripRuntimeUrls(documentRef.current), revision: serverRevisionRef.current };
    const savedSequence = changeSequenceRef.current;
    try {
      if (projectTitleRef.current !== snapshot.title) {
        await atlasApi.renameProject(snapshot.projectId, snapshot.title, serverRevisionRef.current);
        projectTitleRef.current = snapshot.title;
      }
      const result = await atlasApi.saveCheckpoint(snapshot.projectId, snapshot, serverRevisionRef.current, lease.token);
      const revision = result.revision;
      setServerRevision(revision);
      serverRevisionRef.current = revision;
      const changedDuringSave = changeSequenceRef.current !== savedSequence;
      dirtyRef.current = changedDuringSave;
      setSaveStatus(changedDuringSave ? 'local' : 'saved');
      onProjectUpdated({
        id: snapshot.projectId,
        title: snapshot.title,
        revision,
        createdAt: snapshot.updatedAt,
        updatedAt: new Date().toISOString(),
        hasCheckpoint: true,
      });
      await persistLocalProject({ ...documentRef.current, revision });
      if (changedDuringSave) cloudTimerRef.current = window.setTimeout(() => void saveCloud(), 1_000);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConflict(true);
        setReadOnly(true);
      }
      setSaveStatus('failed');
    } finally {
      saveInFlightRef.current = false;
      finishSave?.();
      saveInFlightPromiseRef.current = null;
    }
  }, [onProjectUpdated, persistLocalProject]);

  useEffect(() => {
    if (initialHydrationRef.current) {
      initialHydrationRef.current = false;
      return;
    }
    changeSequenceRef.current += 1;
    dirtyRef.current = true;
    setSaveStatus('local');
    const localTimer = window.setTimeout(() => {
      void persistLocalProject({ ...documentRef.current, revision: serverRevisionRef.current }).catch(() => setSaveStatus('failed'));
    }, 250);
    if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current);
    cloudTimerRef.current = window.setTimeout(() => void saveCloud(), 5000);
    return () => window.clearTimeout(localTimer);
  }, [document, persistLocalProject, saveCloud]);

  useEffect(() => {
    const interval = window.setInterval(() => void saveCloud(), 30_000);
    const onVisible = () => globalThis.document.visibilityState === 'hidden' && void saveCloud();
    const onOnline = () => void saveCloud();
    globalThis.document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(interval);
      globalThis.document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [saveCloud]);

  useEffect(() => {
    const onPageHide = () => {
      pageHidingRef.current = true;
      const resumable = leaseRef.current ?? leaseResumePendingRef.current;
      if (resumable) {
        sessionStorage.setItem(getLeaseHandoffKey(bootstrap.user.id, initialDocument.projectId), JSON.stringify({
          createdAt: Date.now(),
        }));
      }
      void flushLocalSnapshot();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      pageHidingRef.current = false;
      // A bfcache restore keeps the original document alive, so no successor
      // should be allowed to consume its reload handoff.
      if (event.persisted) {
        sessionStorage.removeItem(getLeaseHandoffKey(bootstrap.user.id, initialDocument.projectId));
        recoverLeaseRef.current();
      }
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [bootstrap.user.id, flushLocalSnapshot, initialDocument.projectId]);

  useEffect(() => {
    void requestPersistentStorage().then((granted) => setStorageDenied(!granted));
  }, []);

  useEffect(() => {
    let stopped = false;
    const projectId = initialDocument.projectId;
    const leaseSessionKey = getLeaseSessionKey(bootstrap.user.id, projectId);
    const leaseHandoffKey = getLeaseHandoffKey(bootstrap.user.id, projectId);
    let renewInFlight = false;
    const acquire = async (takeover = false) => {
      if (leaseAcquireInFlightRef.current) return;
      leaseAcquireInFlightRef.current = true;
      try {
        const lease = await retryLeaseRequest(() => atlasApi.acquireLease(projectId, deviceIdRef.current, takeover));
        if (stopped) return;
        leaseRef.current = lease;
        sessionStorage.setItem(leaseSessionKey, lease.token);
        setReadOnly(false);
        setConflict(false);
      } catch (error) {
        if (!stopped) {
          leaseRef.current = null;
          sessionStorage.removeItem(leaseSessionKey);
          setReadOnly(true);
          if (error instanceof ApiError && error.status === 409) setConflict(true);
        }
      } finally {
        leaseAcquireInFlightRef.current = false;
      }
    };
    const resumeLease = async () => {
      const pending = leaseResumePendingRef.current;
      if (!pending || renewInFlight || stopped) return;
      renewInFlight = true;
      try {
        const lease = await retryLeaseRequest(() => atlasApi.renewLease(projectId, pending.token));
        if (stopped) return;
        leaseRef.current = lease;
        leaseResumePendingRef.current = null;
        setReadOnly(false);
        setConflict(false);
      } catch (error) {
        if (stopped) return;
        if (isLeaseLost(error)) {
          sessionStorage.removeItem(leaseSessionKey);
          leaseResumePendingRef.current = null;
          await acquire();
          return;
        }
        if (isProjectMissing(error)) {
          sessionStorage.removeItem(leaseSessionKey);
          leaseResumePendingRef.current = null;
          setReadOnly(true);
          return;
        }
        // A transient renew failure must never fall through to acquire: the
        // server may still hold this exact lease, which would self-conflict.
        setReadOnly(true);
        pending.attempt += 1;
        const delay = Math.min(10_000, 1_000 * 2 ** Math.min(3, pending.attempt - 1));
        leaseResumeTimerRef.current = window.setTimeout(() => void resumeLease(), delay);
      } finally {
        renewInFlight = false;
      }
    };
    const resumeOrAcquire = async () => {
      const priorToken = sessionStorage.getItem(leaseSessionKey);
      const handoff = priorToken ? consumeFreshLeaseHandoff(leaseHandoffKey) : null;
      if (priorToken && handoff) {
        leaseResumePendingRef.current = { token: priorToken, attempt: 0 };
        await resumeLease();
        return;
      }
      await acquire();
    };
    void resumeOrAcquire();
    const renewActiveLease = async () => {
      const lease = leaseRef.current;
      if (!lease || renewInFlight) return;
      renewInFlight = true;
      try {
        const result = await retryLeaseRequest(() => atlasApi.renewLease(projectId, lease.token));
        if (stopped) return;
        lease.expiresAt = result.expiresAt;
        setReadOnly(false);
      } catch (error) {
        if (stopped) return;
        setReadOnly(true);
        if (isLeaseLost(error)) {
          leaseRef.current = null;
          sessionStorage.removeItem(leaseSessionKey);
          await acquire();
        } else if (isProjectMissing(error)) {
          leaseRef.current = null;
          sessionStorage.removeItem(leaseSessionKey);
        }
      } finally {
        renewInFlight = false;
      }
    };
    const renew = window.setInterval(() => void renewActiveLease(), 15_000);
    const recover = () => {
      if (leaseResumePendingRef.current) void resumeLease();
      else if (leaseRef.current) void renewActiveLease();
      else void acquire();
    };
    recoverLeaseRef.current = recover;
    const onOnline = recover;
    window.addEventListener('online', onOnline);
    return () => {
      stopped = true;
      recoverLeaseRef.current = () => undefined;
      window.clearInterval(renew);
      if (leaseResumeTimerRef.current) window.clearTimeout(leaseResumeTimerRef.current);
      window.removeEventListener('online', onOnline);
      const token = leaseRef.current?.token ?? leaseResumePendingRef.current?.token;
      // A reload keeps this tab's sessionStorage. Preserve its lease so the
      // replacement document can renew it; a normal in-app navigation still
      // releases immediately for another real tab/device.
      if (token && !pageHidingRef.current) {
        sessionStorage.removeItem(leaseSessionKey);
        leaseResumePendingRef.current = null;
        void fetch(`/api/atlas/projects/${encodeURIComponent(projectId)}/lease`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ token }), keepalive: true });
      }
    };
  }, [bootstrap.user.id, initialDocument.projectId]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? 'redo' : 'undo' });
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatch({ type: 'redo' });
      }
      if (event.key === 'Delete' && selectedClipId && !effectiveReadOnly) dispatch({ type: 'delete-clip', clipId: selectedClipId });
      if (event.key.toLowerCase() === 's' && selectedClipId && !effectiveReadOnly) dispatch({ type: 'split-clip', clipId: selectedClipId, time: playback.playhead });
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dispatch, effectiveReadOnly, playback.playhead, selectedClipId]);

  useEffect(() => () => {
    if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current);
    // React cannot await unmount cleanup, but starting the serialized IndexedDB
    // write here preserves the latest reducer snapshot after route changes.
    void flushLocalSnapshot();
    documentRef.current.assets.forEach((asset) => asset.objectUrl && URL.revokeObjectURL(asset.objectUrl));
  }, [flushLocalSnapshot]);

  const archiveLocalAsset = useCallback((asset: AtlasAsset, file: File) => {
    if (activeUploadAssetIdsRef.current.has(asset.id)) return;
    activeUploadAssetIdsRef.current.add(asset.id);
    uploadPoolRef.current(async () => {
      try {
        const archived = await uploadLocalAsset(
          initialDocument.projectId, file, asset.kind, () => undefined, undefined, `atlas-upload-${asset.id}`,
        );
        dispatch({ type: 'sync-asset', assetId: asset.id, patch: {
          status: 'ready',
          sourceId: archived.id,
          mediaUrl: archived.mediaUrl ?? `/api/atlas/project-assets/${encodeURIComponent(archived.id)}/media`,
          error: undefined,
        } });
        window.setTimeout(() => void enforceAtlasStorageQuota(bootstrap.user.id).catch(() => undefined), 1_000);
      } catch (error) {
        dispatch({ type: 'sync-asset', assetId: asset.id, patch: {
          status: 'failed', error: error instanceof Error ? error.message : String(error),
        } });
      } finally {
        activeUploadAssetIdsRef.current.delete(asset.id);
      }
    });
  }, [bootstrap.user.id, dispatch, initialDocument.projectId]);

  // A local Blob and its stable asset id are kept in the per-user IndexedDB.
  // Once this tab owns the edit lease, resume every upload interrupted by a
  // refresh or crash; the server returns the same Multipart session and
  // ListParts skips bytes that TOS already accepted.
  useEffect(() => {
    if (readOnly) return;
    const pending = documentRef.current.assets.filter((asset) => asset.source === 'local' && asset.status === 'uploading' && !asset.sourceId);
    pending.forEach((asset) => {
      void loadLocalBlob(bootstrap.user.id, asset.id).then((blob) => {
        if (!blob) {
          dispatch({ type: 'sync-asset', assetId: asset.id, patch: { status: 'failed', error: '本地源文件不可用，请重新关联素材' } });
          return;
        }
        archiveLocalAsset(asset, new File([blob], asset.name, { type: asset.mimeType, lastModified: Date.now() }));
      }).catch((error) => {
        dispatch({ type: 'sync-asset', assetId: asset.id, patch: { status: 'failed', error: error instanceof Error ? error.message : '无法恢复本地素材' } });
      });
    });
  }, [archiveLocalAsset, bootstrap.user.id, dispatch, initialDocument.projectId, readOnly]);

  const addLocalFiles = (files: File[]) => {
    if (readOnlyRef.current) return;
    let unsupported = 0;
    let oversized = 0;
    const accepted = files.flatMap((file): Array<{ file: File; asset: AtlasAsset }> => {
      const kind = mediaKindForFile(file);
      if (!kind) { unsupported += 1; return []; }
      if (file.size > bootstrap.capabilities.maxUploadBytes) { oversized += 1; return []; }
      const id = createId('asset');
      return [{ file, asset: {
        id, name: file.name, kind, mimeType: file.type || 'application/octet-stream', size: file.size,
        duration: kind === 'image' ? 5 : 10, status: 'uploading', source: 'local', objectUrl: URL.createObjectURL(file),
      } }];
    });
    setMediaError([
      oversized ? t('media.fileTooLarge') : '',
      unsupported ? t('media.unsupportedFile') : '',
    ].filter(Boolean).join(' · ') || null);
    if (!accepted.length) return;
    dispatch({ type: 'add-assets', assets: accepted.map((item) => item.asset) });
    setSelectedAssetId(accepted[0]?.asset.id ?? null);
    accepted.forEach(({ file, asset }) => {
      // The durable browser copy is crash recovery, not a prerequisite for the
      // transfer. Large files must start uploading while IndexedDB persists in
      // parallel; quota failures must not turn a healthy TOS upload into a
      // failed asset.
      archiveLocalAsset(asset, file);
      void saveLocalBlob(bootstrap.user.id, asset.id, file)
        .then(() => enforceAtlasStorageQuota(bootstrap.user.id))
        .catch(() => setStorageDenied(true));
      void readMediaMetadata(asset.objectUrl!, asset.kind)
        .then((metadata) => dispatch({ type: 'sync-asset', assetId: asset.id, patch: metadata }))
        .catch(() => undefined);
    });
  };

  const retryLocalAsset = useCallback((assetId: string) => {
    const asset = documentRef.current.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.source !== 'local' || asset.sourceId || readOnlyRef.current) return;
    dispatch({ type: 'sync-asset', assetId, patch: { status: 'uploading', error: undefined } });
    void loadLocalBlob(bootstrap.user.id, assetId).then(async (cachedBlob) => {
      let blob = cachedBlob;
      if (!blob && asset.objectUrl) {
        const response = await fetch(asset.objectUrl);
        if (response.ok) blob = await response.blob();
      }
      if (!blob) throw new Error(t('media.reconnectRequired'));
      archiveLocalAsset(asset, new File([blob], asset.name, { type: asset.mimeType, lastModified: Date.now() }));
    }).catch((error) => {
      dispatch({ type: 'sync-asset', assetId, patch: {
        status: 'failed', error: error instanceof Error ? error.message : t('media.reconnectRequired'),
      } });
    });
  }, [archiveLocalAsset, bootstrap.user.id, dispatch, t]);

  const relinkLocalAsset = useCallback((assetId: string, file: File) => {
    const asset = documentRef.current.assets.find((candidate) => candidate.id === assetId);
    if (!asset || asset.source !== 'local' || asset.sourceId || readOnlyRef.current) return;
    const kind = mediaKindForFile(file);
    if (!kind || kind !== asset.kind) {
      setMediaError(t('media.unsupportedFile'));
      return;
    }
    if (file.size > bootstrap.capabilities.maxUploadBytes) {
      setMediaError(t('media.fileTooLarge'));
      return;
    }
    setMediaError(null);
    if (asset.objectUrl) URL.revokeObjectURL(asset.objectUrl);
    const objectUrl = URL.createObjectURL(file);
    const updated = {
      ...asset,
      name: file.name,
      mimeType: file.type || asset.mimeType,
      size: file.size,
      objectUrl,
      status: 'uploading' as const,
      error: undefined,
    };
    dispatch({ type: 'sync-asset', assetId, patch: updated });
    void saveLocalBlob(bootstrap.user.id, assetId, file)
      .then(() => enforceAtlasStorageQuota(bootstrap.user.id))
      .catch(() => setStorageDenied(true));
    void readMediaMetadata(objectUrl, kind)
      .then((metadata) => dispatch({ type: 'sync-asset', assetId, patch: metadata }))
      .catch(() => undefined);
    archiveLocalAsset(updated, file);
  }, [archiveLocalAsset, bootstrap.capabilities.maxUploadBytes, bootstrap.user.id, dispatch, t]);

  const addImportedAsset = (asset: AtlasAsset) => {
    dispatch({ type: 'add-assets', assets: [asset] });
    setSelectedAssetId(asset.id);
  };

  const takeOver = async () => {
    try {
      const lease = await retryLeaseRequest(() => atlasApi.acquireLease(document.projectId, deviceIdRef.current, true));
      leaseRef.current = lease;
      setReadOnly(false);
      setConflict(false);
    } catch {
      leaseRef.current = null;
      setReadOnly(true);
      setConflict(true);
    }
  };

  const returnToDashboard = async () => {
    if (cloudTimerRef.current) window.clearTimeout(cloudTimerRef.current);
    await flushLocalSnapshot().catch(() => undefined);
    onBack();
  };

  const reloadCloud = async () => {
    const result = await atlasApi.loadCheckpoint(document.projectId);
    const normalized = normalizeDocument(result);
    dispatch({ type: 'replace', document: normalized });
    setServerRevision(normalized.revision);
    serverRevisionRef.current = normalized.revision;
    dirtyRef.current = false;
    setConflict(false);
  };

  const keepCopy = async () => {
    const project = await atlasApi.createProject(`${document.title} · 副本`);
    const copy = { ...stripRuntimeUrls(document), projectId: project.id, title: project.title, revision: project.revision };
    await persistLocalProject(copy);
    setConflict(false);
    onOpenProject(project);
  };

  const getLeaseToken = useCallback(() => {
    const lease = leaseRef.current;
    return !readOnlyRef.current && lease && lease.expiresAt > Date.now() + 5_000 ? lease.token : null;
  }, []);

  const validateMutationLock = useCallback((): AgentMutationContext | null => {
    if (!mutationLockRef.current) return null;
    const leaseToken = getLeaseToken();
    if (!leaseToken) return null;
    return { document: { ...documentRef.current, revision: serverRevisionRef.current }, leaseToken };
  }, [getLeaseToken]);

  const beginMutationLock = useCallback(async (): Promise<AgentMutationContext | null> => {
    if (mutationLockRef.current || !bootstrap.capabilities.agent || readOnlyRef.current || !getLeaseToken()) return null;
    mutationLockRef.current = true;
    setAgentMutationLocked(true);
    // Drain writes that started before the lock. Otherwise an older IndexedDB
    // transaction could complete after the Agent commit and restore stale data.
    await Promise.all([
      localWriteChainRef.current.catch(() => undefined),
      saveInFlightPromiseRef.current?.catch(() => undefined) ?? Promise.resolve(),
    ]);
    const context = validateMutationLock();
    if (!context) {
      mutationLockRef.current = false;
      setAgentMutationLocked(false);
    }
    return context;
  }, [bootstrap.capabilities.agent, getLeaseToken, validateMutationLock]);

  const endMutationLock = useCallback(() => {
    if (!mutationLockRef.current) return;
    mutationLockRef.current = false;
    setAgentMutationLocked(false);
    window.setTimeout(() => void saveCloud(), 0);
  }, [saveCloud]);

  const saveLabel = saveStatus === 'saving' ? t('workspace.saving') : saveStatus === 'failed' ? t('workspace.saveFailed') : saveStatus === 'local' ? t('workspace.localSaved') : t('workspace.saved');

  return (
    <div className="atlas-workspace" aria-busy={agentMutationLocked} data-agent-mutation-locked={agentMutationLocked || undefined}>
      <header className="atlas-workspace__header">
        <div className="atlas-workspace__identity">
          <button className="atlas-icon-button" type="button" disabled={agentMutationLocked} onClick={() => void returnToDashboard()} aria-label={t('workspace.back')}><Icon name="arrow-left" /></button>
          <AtlasBrand compact />
          <span className="atlas-header-divider" />
          <label><span className="sr-only">{t('projects.renameTitle')}</span><input value={document.title} readOnly={effectiveReadOnly} maxLength={80} onChange={(event) => dispatch({ type: 'rename-document', title: event.target.value })} /></label>
        </div>
        <div className="atlas-workspace__status">
          <span className={`atlas-save-state atlas-save-state--${saveStatus}`}><i />{saveLabel}</span>
          {effectiveReadOnly && <span className="atlas-badge"><Icon name="warning" />{t('workspace.readOnly')}</span>}
          <button className="atlas-button atlas-button--primary" type="button" disabled={effectiveReadOnly} onClick={() => { setAgentExport(null); setExportOpen(true); }}><Icon name="export" />{t('workspace.export')}</button>
          <div className="atlas-user atlas-user--compact" title={bootstrap.user.email}>{bootstrap.user.avatarUrl ? <img src={bootstrap.user.avatarUrl} alt="" /> : <span>{bootstrap.user.name.slice(0, 1).toUpperCase()}</span>}</div>
        </div>
      </header>

      {storageDenied && <div className="atlas-workspace-notice" role="status"><Icon name="warning" />{t('notice.storageDenied')}</div>}
      <main className="atlas-workspace__main">
        <MediaPanel readOnly={effectiveReadOnly} projectId={document.projectId} assets={document.assets} selectedAssetId={selectedAssetId} onSelect={(id) => { setSelectedAssetId(id); setSelectedClipId(null); }} onFiles={addLocalFiles} onAddTimeline={(assetId) => dispatch({ type: 'add-clip', assetId })} onRetry={retryLocalAsset} onRelink={relinkLocalAsset} onImported={addImportedAsset} error={mediaError} />
        <div className="atlas-workspace__center">
          <PreviewPanel
            document={document}
            asset={selectedAsset}
            clip={selectedClip}
            playhead={playback.playhead}
            playing={playback.playing}
            onPlayingChange={setPlaybackPlaying}
            onPlayheadChange={seekPlayback}
          />
          <AgentPanel userId={bootstrap.user.id} document={{ ...document, revision: serverRevision }} dispatch={dispatch} enabled={bootstrap.capabilities.agent && !readOnly} beginMutationLock={beginMutationLock} validateMutationLock={validateMutationLock} endMutationLock={endMutationLock} getLeaseToken={getLeaseToken} onRequestExport={(request) => { setAgentExport(request); setExportOpen(true); }} />
        </div>
        <InspectorPanel clip={selectedClip} dispatch={dispatch} readOnly={effectiveReadOnly || selectedTrackLocked} />
      </main>
      <TimelineView document={document} selectedClipId={selectedClipId} onSelectClip={(clipId) => { setSelectedClipId(clipId); const clip = document.clips.find((candidate) => candidate.id === clipId); if (clip) setSelectedAssetId(clip.assetId); }} dispatch={dispatch} readOnly={effectiveReadOnly} playhead={playback.playhead} onPlayheadChange={seekPlayback} />

      <ExportPanel
        open={exportOpen}
        document={{ ...document, revision: serverRevision }}
        userId={bootstrap.user.id}
        onClose={() => { setExportOpen(false); setAgentExport(null); }}
        onComplete={async (asset) => {
          addImportedAsset(asset);
          await agentExport?.onCompleted(asset);
          setAgentExport(null);
          setExportOpen(false);
        }}
        onFailed={agentExport ? async (reason) => {
          await agentExport.onFailed(reason);
          setAgentExport(null);
        } : undefined}
      />
      {conflict && (
        <Modal title={t('workspace.conflictTitle')} onClose={() => undefined} actions={<><button className="atlas-button atlas-button--quiet" type="button" onClick={() => void reloadCloud()}>{t('workspace.reloadCloud')}</button><button className="atlas-button atlas-button--soft" type="button" onClick={() => void keepCopy()}>{t('workspace.keepCopy')}</button><button className="atlas-button atlas-button--primary" type="button" onClick={() => void takeOver()}>{t('workspace.takeOver')}</button></>}>
          <p>{t('workspace.conflictBody')}</p>
        </Modal>
      )}
    </div>
  );
}

function normalizeDocument(document: AtlasDocument): AtlasDocument {
  return {
    ...document,
    version: 1,
    assets: document.assets.map((asset) => ({ ...asset, status: asset.status ?? 'ready' })),
    tracks: document.tracks.map((track) => ({ ...track, locked: Boolean(track.locked), muted: Boolean(track.muted) })),
    clips: document.clips.map((clip) => ({
      ...clip,
      volume: Number.isFinite(clip.volume) ? clip.volume : 1,
      muted: Boolean(clip.muted),
      transitionIn: clip.transitionIn ?? 'none',
      transform: {
        x: clip.transform?.x ?? 0,
        y: clip.transform?.y ?? 0,
        scaleX: clip.transform?.scaleX ?? (clip.transform as unknown as { scale?: number } | undefined)?.scale ?? 1,
        scaleY: clip.transform?.scaleY ?? (clip.transform as unknown as { scale?: number } | undefined)?.scale ?? 1,
        rotation: clip.transform?.rotation ?? 0,
        opacity: clip.transform?.opacity ?? 1,
      },
    })),
  };
}

function getDeviceId(userId: string): string {
  const key = `firefly:atlas:${userId}:device-id`;
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = createId('device');
  localStorage.setItem(key, id);
  return id;
}

export function getLeaseSessionKey(userId: string, projectId: string): string {
  return `firefly:atlas:${userId}:project:${projectId}:lease-token`;
}

export function getLeaseHandoffKey(userId: string, projectId: string): string {
  return `firefly:atlas:${userId}:project:${projectId}:reload-handoff`;
}

/** Atomically consumes the bounded proof that this tab is replacing itself. */
export function consumeFreshLeaseHandoff(key: string, currentTime = Date.now()): true | null {
  const raw = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { createdAt?: unknown };
    const createdAt = Number(parsed.createdAt);
    if (!Number.isFinite(createdAt) || createdAt > currentTime) return null;
    if (currentTime - createdAt > LEASE_RELOAD_HANDOFF_MAX_AGE_MS) return null;
    return true;
  } catch {
    return null;
  }
}

const isLeaseLost = (error: unknown): boolean => error instanceof ApiError && error.status === 409;
const isProjectMissing = (error: unknown): boolean => error instanceof ApiError && error.status === 404;

/** Two files at a time; each file already bounds TOS part concurrency to 3. */
export function createTaskPool(limit: number) {
  const queue: Array<() => Promise<void>> = [];
  let active = 0;
  const drain = () => {
    while (active < limit && queue.length) {
      const task = queue.shift()!;
      active += 1;
      void task().finally(() => { active -= 1; drain(); });
    }
  };
  return (task: () => Promise<void>) => { queue.push(task); drain(); };
}

export async function retryLeaseRequest<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; wait?: (delayMs: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, options.attempts ?? 3));
  const wait = options.wait ?? ((delayMs: number) => new Promise((resolve) => window.setTimeout(resolve, delayMs)));
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = !(error instanceof ApiError)
        || error.status === 408
        || error.status === 429
        || error.status >= 500;
      if (!retryable || attempt === attempts - 1) throw error;
      await wait(250 * 2 ** attempt);
    }
  }
  throw lastError;
}
