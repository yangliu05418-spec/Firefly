import { useEffect, useRef, useState, type Dispatch } from 'react';
import { agentSemanticFingerprint, atlasApi, parseAgentPlan } from '../api';
import { exportReceipt, prepareAgentExecution } from '../agent-execution';
import type { AtlasAgentLedger, AtlasAgentPlan, AtlasAsset, AtlasDocument } from '../model';
import {
  clearAgentIntent,
  commitAgentExecution,
  getOrCreateAgentIntent,
  listPendingAgentLedgers,
  saveAgentLedger,
} from '../storage';
import type { EditorAction } from '../timeline';
import { validateAgentPlan } from '../timeline';
import { useI18n, type MessageKey } from '../i18n';
import { Icon } from './Icon';

type AgentStatus = 'idle' | 'connecting' | 'thinking' | 'ready' | 'applying' | 'completed' | 'failed';

export function AgentPanel({
  userId,
  document,
  dispatch,
  enabled,
  onRequestExport,
  beginMutationLock,
  validateMutationLock,
  endMutationLock,
  getLeaseToken,
}: {
  userId: string;
  document: AtlasDocument;
  dispatch: Dispatch<EditorAction>;
  enabled: boolean;
  onRequestExport: (request: AgentExportRequest) => void;
  beginMutationLock: () => Promise<AgentMutationContext | null>;
  validateMutationLock: () => AgentMutationContext | null;
  endMutationLock: () => void;
  getLeaseToken: () => string | null;
}) {
  const { t } = useI18n();
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [plan, setPlan] = useState<AtlasAgentPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executionStarted, setExecutionStarted] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);
  const documentRef = useRef(document);
  const submittedSemanticRef = useRef<string | null>(null);
  const intentKeyRef = useRef<string | null>(null);
  const ledgerRef = useRef<AtlasAgentLedger | null>(null);
  const exportRequestedRef = useRef(false);
  const pollingRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const mutationLockHeldRef = useRef(false);
  documentRef.current = document;

  const releaseMutationLock = () => {
    if (!mutationLockHeldRef.current) return;
    mutationLockHeldRef.current = false;
    endMutationLock();
  };

  const persistLedger = async (ledger: AtlasAgentLedger) => {
    ledgerRef.current = ledger;
    await saveAgentLedger(userId, ledger);
  };

  const reportPendingReceipts = async (initial: AtlasAgentLedger, suppliedLeaseToken?: string): Promise<AtlasAgentLedger> => {
    let current = initial;
    while (current.pendingReceipts.length) {
      const receipt = current.pendingReceipts[0]!;
      const leaseToken = suppliedLeaseToken ?? getLeaseToken();
      if (!leaseToken) throw new Error(t('workspace.readOnly'));
      await atlasApi.reportAgentResult(current.projectId, current.runId, receipt, leaseToken);
      current = {
        ...current,
        pendingReceipts: current.pendingReceipts.slice(1),
        status: current.pendingReceipts.length === 1 && !current.pendingExport ? 'reported' : current.status,
        updatedAt: new Date().toISOString(),
      };
      await persistLedger(current);
    }
    if (!current.pendingExport && current.status !== 'reported') {
      current = { ...current, status: 'reported', updatedAt: new Date().toISOString() };
      await persistLedger(current);
    }
    if (current.status === 'reported') await clearAgentIntent(userId, current.projectId, current.idempotencyKey);
    return current;
  };

  const settleExport = async (statusValue: 'succeeded' | 'failed', result: unknown) => {
    const current = ledgerRef.current;
    if (!current) return;
    const receipt = exportReceipt(current, statusValue, result);
    if (!receipt) return;
    // Persist the exact result before sending it. If the HTTP response is lost,
    // Atlas can only replay the same receipt and never turn a real TOS success
    // into a conflicting failure result.
    const pending: AtlasAgentLedger = {
      ...current,
      status: 'applied',
      pendingExport: undefined,
      pendingReceipts: [...current.pendingReceipts, receipt],
      updatedAt: new Date().toISOString(),
    };
    await persistLedger(pending);
    try {
      await reportPendingReceipts(pending);
      if (statusValue === 'succeeded') {
        setStatus('completed');
        setInstruction('');
      } else {
        setError(t('export.failed'));
        setStatus('failed');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('agent.failed'));
      setStatus('failed');
    } finally {
      releaseMutationLock();
    }
  };

  const openExport = (ledger: AtlasAgentLedger) => {
    if (!ledger.pendingExport || exportRequestedRef.current) return;
    exportRequestedRef.current = true;
    onRequestExport({
      onCompleted: async (asset) => { await settleExport('succeeded', { assetId: asset.id, status: 'ready' }); },
      onFailed: async (reason) => { await settleExport('failed', { code: reason }); },
    });
  };

  const continueExecution = async (ledger: AtlasAgentLedger, leaseToken?: string) => {
    const reported = await reportPendingReceipts(ledger, leaseToken);
    if (reported.pendingExport) {
      openExport(reported);
      return;
    }
    setStatus('completed');
    setInstruction('');
    releaseMutationLock();
  };

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    // Reloading terminates browser encoding. Editing receipts are replayed;
    // unfinished exports are closed as interrupted, never reported as ready.
    void listPendingAgentLedgers(userId, document.projectId).then(async (ledgers) => {
      for (const stored of ledgers) {
        if (stopped) return;
        let recoverable = stored;
        if (recoverable.pendingExport) {
          const interrupted = exportReceipt(recoverable, 'failed', { code: 'EXPORT_INTERRUPTED' });
          if (interrupted) {
            recoverable = {
              ...recoverable,
              status: 'applied',
              pendingExport: undefined,
              pendingReceipts: [...recoverable.pendingReceipts, interrupted],
              updatedAt: new Date().toISOString(),
            };
            await saveAgentLedger(userId, recoverable);
          }
        }
        await reportPendingReceipts(recoverable).catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => { stopped = true; sourceRef.current?.close(); pollingRef.current?.abort(); };
    // Recovery is scoped to the active user and project, not editor rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document.projectId, enabled, userId]);

  useEffect(() => {
    if (enabled) return;
    sourceRef.current?.close();
    pollingRef.current?.abort();
    if (status === 'applying') {
      setError(t('workspace.readOnly'));
      setStatus('failed');
    }
    releaseMutationLock();
    // `enabled` is the current lease/feature authority; losing it fails closed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  useEffect(() => () => {
    sourceRef.current?.close();
    pollingRef.current?.abort();
    releaseMutationLock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptPayload = (payload: unknown, generation = requestGenerationRef.current) => {
    if (generation !== requestGenerationRef.current) return false;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
    const value = payload as Record<string, unknown>;
    if (!value.plan) return false;
    try {
      const candidate = parseAgentPlan(value.plan);
      if (!validateAgentPlan(candidate)) {
        setError(t('agent.unsupportedOperation'));
        setStatus('failed');
        return true;
      }
      setPlan(candidate);
      setStatus('ready');
      return true;
    } catch {
      setError(t('agent.unsupportedOperation'));
      setStatus('failed');
      return true;
    }
  };

  const pollRun = async (activeRunId: string, generation: number) => {
    pollingRef.current?.abort();
    const controller = new AbortController();
    pollingRef.current = controller;
    const deadline = Date.now() + 12 * 60_000;
    let attempt = 0;
    while (!controller.signal.aborted && Date.now() < deadline) {
      try {
        const result = await atlasApi.getAgentRun(document.projectId, activeRunId);
        if (generation !== requestGenerationRef.current) return;
        if (result.plan && acceptPayload({ plan: result.plan }, generation)) return;
        if (result.status === 'failed' || result.status === 'cancelled') {
          setError(agentErrorMessage(result.errorCode, t));
          setStatus('failed');
          await clearAgentIntent(userId, document.projectId, intentKeyRef.current ?? undefined);
          return;
        }
        if (result.status === 'succeeded') {
          setError(t('agent.failed'));
          setStatus('failed');
          return;
        }
      } catch (caught) {
        if (controller.signal.aborted) return;
      }
      attempt += 1;
      await waitForAgentRetry(controller.signal, Math.min(10_000, 2_000 + attempt * 250));
    }
    if (!controller.signal.aborted) {
      setError(t('agent.errorTimeout'));
      setStatus('failed');
    }
  };

  const connect = (activeRunId: string, generation: number) => {
    sourceRef.current?.close();
    const source = new EventSource(`/api/atlas/projects/${encodeURIComponent(document.projectId)}/agent/runs/${encodeURIComponent(activeRunId)}/events`);
    sourceRef.current = source;
    const handlePlan = (event: MessageEvent<string>) => {
      if (generation !== requestGenerationRef.current) return;
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        if (acceptPayload(payload, generation)) source.close();
      } catch {
        // Ignore malformed keep-alive events; the API remains the source of truth.
      }
    };
    const handleFailed = (event: MessageEvent<string>) => {
      if (generation !== requestGenerationRef.current) return;
      try {
        const payload = JSON.parse(event.data) as Record<string, unknown>;
        setError(agentErrorMessage(typeof payload.errorCode === 'string' ? payload.errorCode : undefined, t));
      } catch { setError(t('agent.failed')); }
      setStatus('failed');
      void clearAgentIntent(userId, document.projectId, intentKeyRef.current ?? undefined);
      source.close();
    };
    source.onopen = () => { if (generation === requestGenerationRef.current) setStatus('thinking'); };
    source.addEventListener('plan_ready', handlePlan as EventListener);
    source.addEventListener('run_failed', handleFailed as EventListener);
    source.onerror = () => {
      source.close();
      if (generation === requestGenerationRef.current) void pollRun(activeRunId, generation);
    };
  };

  const submit = async () => {
    const normalizedInstruction = instruction.trim();
    if (!enabled || !normalizedInstruction || status === 'connecting' || status === 'thinking') return;
    setError(null);
    setPlan(null);
    setExecutionStarted(false);
    ledgerRef.current = null;
    exportRequestedRef.current = false;
    setStatus('connecting');
    const generation = ++requestGenerationRef.current;
    try {
      const semanticFingerprint = await agentSemanticFingerprint(documentRef.current);
      const intent = await getOrCreateAgentIntent(userId, document.projectId, normalizedInstruction, semanticFingerprint);
      submittedSemanticRef.current = semanticFingerprint;
      intentKeyRef.current = intent.idempotencyKey;
      const result = await atlasApi.createAgentRun(document.projectId, normalizedInstruction, documentRef.current, intent.idempotencyKey);
      if (generation !== requestGenerationRef.current) return;
      setRunId(result.id);
      if (result.plan && acceptPayload({ plan: result.plan }, generation)) return;
      connect(result.id, generation);
    } catch (caught) {
      if (generation !== requestGenerationRef.current) return;
      // Retain the intent after transport failure so retrying the same user
      // action cannot create a duplicate server run.
      setError(caught instanceof Error ? caught.message : t('agent.failed'));
      setStatus('failed');
    }
  };

  const apply = async () => {
    if (!enabled) {
      setError(t('workspace.readOnly'));
      setStatus('failed');
      return;
    }
    if (executionStarted && ledgerRef.current) {
      setStatus('applying');
      const leaseToken = getLeaseToken();
      if (!leaseToken) { setError(t('workspace.readOnly')); setStatus('failed'); return; }
      try { await continueExecution(ledgerRef.current, leaseToken); }
      catch (caught) { setError(caught instanceof Error ? caught.message : t('agent.failed')); setStatus('failed'); releaseMutationLock(); }
      return;
    }
    if (!plan || !runId || !submittedSemanticRef.current || !intentKeyRef.current) return;
    setStatus('applying');
    try {
      const locked = await beginMutationLock();
      if (!locked) throw new Error(t('workspace.readOnly'));
      mutationLockHeldRef.current = true;
      const currentSemantic = await agentSemanticFingerprint(locked.document);
      let prepared = prepareAgentExecution({
        document: locked.document,
        plan,
        submittedSemanticFingerprint: submittedSemanticRef.current,
        currentSemanticFingerprint: currentSemantic,
        runId,
        idempotencyKey: intentKeyRef.current,
        historyNodeId: crypto.randomUUID(),
      });
      if (!prepared) {
        await clearAgentIntent(userId, document.projectId, intentKeyRef.current);
        setError(t('agent.stalePlan'));
        setPlan(null);
        setRunId(null);
        setStatus('failed');
        releaseMutationLock();
        return;
      }
      if (plan.operations.some((operation) => operation.requiresConfirmation)) {
        await atlasApi.confirmAgentRun(document.projectId, runId, true, locked.leaseToken);
      }
      // Confirmation and IndexedDB can both yield. Re-read the reducer-owned
      // document and lease immediately before persistence, then run the same
      // semantic CAS again. The reducer lock rejects every competing action.
      const finalContext = validateMutationLock();
      if (!finalContext) throw new Error(t('workspace.readOnly'));
      const finalSemantic = await agentSemanticFingerprint(finalContext.document);
      prepared = prepareAgentExecution({
        document: finalContext.document,
        plan,
        submittedSemanticFingerprint: submittedSemanticRef.current,
        currentSemanticFingerprint: finalSemantic,
        runId,
        idempotencyKey: intentKeyRef.current,
        historyNodeId: prepared.ledger.pendingReceipts[0]?.historyNodeId ?? crypto.randomUUID(),
      });
      if (!prepared) throw new Error(t('agent.stalePlan'));
      // Commit the document and receipt ledger in one transaction before the
      // exact same document becomes visible in React.
      await commitAgentExecution(userId, prepared.nextDocument, prepared.ledger);
      ledgerRef.current = prepared.ledger;
      setExecutionStarted(true);
      dispatch({ type: 'commit-agent-document', document: prepared.nextDocument });
      await continueExecution(prepared.ledger, finalContext.leaseToken);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('agent.failed');
      setError(message);
      setStatus('failed');
      if (message === t('agent.stalePlan')) {
        await clearAgentIntent(userId, document.projectId, intentKeyRef.current ?? undefined).catch(() => undefined);
        setPlan(null);
        setRunId(null);
      }
      releaseMutationLock();
    }
  };

  const cancel = async () => {
    requestGenerationRef.current += 1;
    sourceRef.current?.close();
    pollingRef.current?.abort();
    if (runId) await atlasApi.cancelAgentRun(document.projectId, runId).catch(() => undefined);
    await clearAgentIntent(userId, document.projectId, intentKeyRef.current ?? undefined).catch(() => undefined);
    setStatus('idle');
    setPlan(null);
    setRunId(null);
    setExecutionStarted(false);
    releaseMutationLock();
  };

  return (
    <aside className="atlas-agent-panel" aria-label={t('agent.title')}>
      <div className="atlas-agent-panel__glow" aria-hidden="true" />
      <header><span className="atlas-agent-mark"><Icon name="agent" /></span><div><h2>{t('agent.title')}</h2><p>{t('agent.subtitle')}</p></div><span className={`atlas-agent-status atlas-agent-status--${status}`} /></header>
      <div className="atlas-agent-panel__body">
        {status === 'idle' && !plan && <div className="atlas-agent-empty"><Icon name="spark" /><strong>{t('agent.emptyTitle')}</strong><p>{t('agent.emptyBody')}</p></div>}
        {(status === 'connecting' || status === 'thinking') && <div className="atlas-agent-thinking"><span className="atlas-agent-orbit"><i /><i /><i /></span><strong>{status === 'connecting' ? t('agent.connecting') : t('agent.thinking')}</strong></div>}
        {plan && (
          <div className="atlas-agent-plan">
            <span className="atlas-eyebrow"><Icon name="check" />{t('agent.planReady')}</span>
            <p>{plan.summary}</p>
            <ol>{plan.operations.map((operation, index) => <li key={operation.operationKey}><span>{String(index + 1).padStart(2, '0')}</span><strong>{agentToolLabel(operation.tool, t)}</strong>{operation.requiresConfirmation && <Icon name="warning" />}</li>)}</ol>
            <small>{plan.operations.length} {t('agent.operationCount')}</small>
            {plan.operations.some((operation) => operation.requiresConfirmation) && <div className="atlas-agent-warning"><Icon name="warning" />{t('agent.destructiveWarning')}</div>}
          </div>
        )}
        {status === 'completed' && <div className="atlas-agent-result"><Icon name="check" /><strong>{t('agent.completed')}</strong></div>}
        {error && <div className="atlas-agent-error" role="alert"><Icon name="warning" /><span>{error}</span></div>}
      </div>
      <footer>
        <label><span className="sr-only">{t('agent.placeholder')}</span><textarea value={instruction} disabled={!enabled || ['connecting', 'thinking', 'applying'].includes(status)} onChange={(event) => setInstruction(event.target.value)} placeholder={enabled ? t('agent.placeholder') : t('app.notAvailable')} rows={3} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void submit(); }} /></label>
        <div>
          {(status === 'connecting' || status === 'thinking') && <button className="atlas-button atlas-button--quiet" type="button" onClick={() => void cancel()}>{t('agent.cancelRun')}</button>}
          {plan ? <><button className="atlas-button atlas-button--quiet" type="button" disabled={status === 'applying'} onClick={() => void cancel()}>{t('agent.discardPlan')}</button><button className="atlas-button atlas-button--agent" type="button" disabled={!enabled || status === 'applying'} onClick={() => void apply()}><Icon name="spark" />{executionStarted ? t('agent.retryReceipt') : plan.operations.some((operation) => operation.requiresConfirmation) ? t('agent.confirmPlan') : t('agent.applyPlan')}</button></> : <button className="atlas-button atlas-button--agent" type="button" disabled={!enabled || !instruction.trim() || status === 'connecting' || status === 'thinking'} onClick={() => void submit()}><Icon name="arrow-left" />{t('agent.send')}</button>}
        </div>
      </footer>
    </aside>
  );
}

export interface AgentExportRequest {
  onCompleted: (asset: AtlasAsset) => Promise<void>;
  onFailed: (reason: 'EXPORT_FAILED' | 'EXPORT_CANCELLED') => Promise<void>;
}

export interface AgentMutationContext {
  document: AtlasDocument;
  leaseToken: string;
}

/**
 * Polling remains bounded, but a visible tab or restored network wakes it
 * immediately instead of making the user wait for the next backoff interval.
 */
function waitForAgentRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      window.removeEventListener('online', finish);
      globalThis.document.removeEventListener('visibilitychange', onVisible);
      resolve();
    };
    const onVisible = () => { if (globalThis.document.visibilityState === 'visible') finish(); };
    const timer = window.setTimeout(finish, globalThis.document.visibilityState === 'hidden' ? Math.max(15_000, delayMs) : delayMs);
    signal.addEventListener('abort', finish, { once: true });
    window.addEventListener('online', finish, { once: true });
    globalThis.document.addEventListener('visibilitychange', onVisible);
  });
}

type Translate = (key: MessageKey) => string;

function agentErrorMessage(code: string | undefined, t: Translate) {
  if (code === 'AGENT_PROVIDER_TIMEOUT' || code === 'AGENT_POLL_TIMEOUT') return t('agent.errorTimeout');
  if (code === 'AGENT_PROVIDER_RATE_LIMITED') return t('agent.errorRateLimited');
  if (code === 'AGENT_STALE_REVISION' || code === 'AGENT_REVISION_CONFLICT') return t('agent.stalePlan');
  if (code === 'AGENT_CANCELLED') return t('agent.cancelled');
  return t('agent.failed');
}

function agentToolLabel(tool: string, t: Translate) {
  const labels: Record<string, MessageKey> = {
    split_clip: 'agent.toolSplit', trim_clip: 'agent.toolTrim', move_clip: 'agent.toolMove', reorder_clips: 'agent.toolReorder',
    delete_clip: 'agent.toolDelete', insert_project_asset: 'agent.toolInsert', create_track: 'agent.toolCreateTrack',
    set_track_muted: 'agent.toolTrackMute', set_clip_volume: 'agent.toolVolume', set_transform: 'agent.toolTransform',
    add_transition: 'agent.toolAddTransition', remove_transition: 'agent.toolRemoveTransition', request_export: 'agent.toolExport',
  };
  return t(labels[tool] ?? 'agent.unsupportedOperation');
}
