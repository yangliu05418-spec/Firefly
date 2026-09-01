import { useEffect, useRef, useState } from 'react';
import { saveCurrentProject } from '../services/projectSync';
import { projectFileService } from '../services/projectFileService';
import { useFireflyEmbedding } from './FireflyEmbeddingContext';
import {
  originalAtlasAgentApi,
  type AtlasAgentPlan,
  type AtlasAgentRun,
} from './OriginalAtlasAgentClient';
import {
  applyOriginalAtlasAgentPlan,
  createOriginalAtlasAgentSnapshot,
  originalAtlasAgentSemanticFingerprint,
  validateOriginalAtlasAgentPlan,
} from './OriginalAtlasAgentRuntime';
import './OriginalAtlasAgentPanel.css';
import { ATLAS_AGENT_CATALOGS } from './atlas-agent-catalog.generated';
import { BloubAvatar } from './avatar/BloubAvatar';
import type { StateId } from './avatar/bloub/states';

type PanelStatus = 'idle' | 'saving' | 'planning' | 'ready' | 'applying' | 'reporting' | 'completed' | 'failed';

const operationLabels: Record<string, string> = {
  splitClip: '切割片段', trimClip: '修剪片段', moveClip: '移动片段', reorderClips: '重排片段', deleteClip: '删除片段', deleteClips: '删除多个片段',
  createTrack: '创建轨道', deleteTrack: '删除轨道', setTrackMuted: '设置轨道静音', setTrackVisibility: '设置轨道可见性', setClipSpeed: '调整片段速度',
  setTransform: '调整画面', addTransition: '添加转场', removeTransition: '移除转场', addMarker: '添加标记', removeMarker: '移除标记', addClipSegment: '插入项目素材', requestFireflyExport: '打开导出',
};
const operationLabel = (plan: AtlasAgentPlan, tool: string) => {
  if (operationLabels[tool]) return operationLabels[tool];
  const catalog = Object.values(ATLAS_AGENT_CATALOGS).find((item) => item.digest === plan.catalogDigest);
  const definition = catalog?.tools.find((item) => item.name === tool);
  return definition ? `${definition.categoryLabel}操作` : '剪辑操作';
};

const errorMessage = (code?: string) => ({
  AGENT_PROVIDER_TIMEOUT: 'Agent 响应超时，请重试。',
  AGENT_PROVIDER_RATE_LIMITED: 'Agent 当前请求较多，请稍后重试。',
  AGENT_LEASE_LOST: '项目编辑权已失效，请重新接管。',
  AGENT_REVISION_CONFLICT: '时间线已发生变化，请重新生成计划。',
  OPERATION_REPLAY_CONFLICT: '操作回执冲突，已停止执行以保护项目。',
} as Record<string, string>)[code ?? ''] ?? 'Atlas Agent 暂时无法完成该操作。';

const avatarStateFor = (status: PanelStatus): StateId => ({
  idle: 'idle',
  saving: 'orbit',
  planning: 'thinking',
  ready: 'notify',
  applying: 'play',
  reporting: 'thinking',
  completed: 'wink',
  failed: 'alert',
})[status] as StateId;

const statusLabel = (status: PanelStatus) => ({
  idle: '待命',
  saving: '保存中',
  planning: '正在理解时间线',
  ready: '计划待确认',
  applying: '正在执行',
  reporting: '正在校验',
  completed: '已完成',
  failed: '需要处理',
})[status];

export default function OriginalAtlasAgentPanel() {
  const embedding = useFireflyEmbedding();
  const [instruction, setInstruction] = useState('');
  const [status, setStatus] = useState<PanelStatus>('idle');
  const [run, setRun] = useState<AtlasAgentRun | null>(null);
  const [plan, setPlan] = useState<AtlasAgentPlan | null>(null);
  const [error, setError] = useState('');
  const [submittedFingerprint, setSubmittedFingerprint] = useState('');
  const generationRef = useRef(0);
  const executionControllerRef = useRef<AbortController | null>(null);
  const appliedRef = useRef<{
    planDigest: string;
    historyNodeId: string;
    nextReceiptIndex: number;
    leaseToken: string;
  } | null>(null);

  useEffect(() => () => {
    generationRef.current += 1;
    executionControllerRef.current?.abort();
  }, []);

  if (!embedding?.capabilities.agent) {
    return <div className="original-atlas-agent original-atlas-agent--empty"><strong>Atlas Agent 尚未开放</strong><span>当前项目仍可正常剪辑和生成素材。</span></div>;
  }

  const poll = async (runId: string, generation: number) => {
    await new Promise<void>((resolve, reject) => {
      const source = new EventSource(originalAtlasAgentApi.eventsUrl(embedding.projectId, runId), { withCredentials: true });
      const timeout = window.setTimeout(() => { source.close(); reject(new Error('Agent 规划超时，请重试。')); }, 8 * 60_000);
      let fallback: number | undefined;
      const finish = () => { window.clearTimeout(timeout); if (fallback) window.clearInterval(fallback); source.close(); };
      const sync = async () => {
        try {
          if (generation !== generationRef.current) { finish(); resolve(); return; }
          const current = await originalAtlasAgentApi.readRun(embedding.projectId, runId); setRun(current);
          if (current.plan) { const validation = validateOriginalAtlasAgentPlan(current.plan); if (validation) throw new Error(validation); setPlan(current.plan); setStatus('ready'); finish(); resolve(); }
          else if (current.status === 'failed' || current.status === 'cancelled') { finish(); reject(new Error(errorMessage(current.errorCode))); }
        } catch (caught) { finish(); reject(caught); }
      };
      ['plan_ready', 'run_failed', 'run_cancelled'].forEach((event) => source.addEventListener(event, () => void sync()));
      source.onerror = () => { source.close(); if (!fallback) fallback = window.setInterval(() => void sync(), 2_000); };
    });
  };

  const submit = async () => {
    const normalized = instruction.trim();
    if (!normalized || ['saving', 'planning', 'applying', 'reporting'].includes(status)) return;
    const generation = ++generationRef.current;
    appliedRef.current = null;
    setError(''); setPlan(null); setRun(null); setStatus('saving');
    try {
      const saved = await saveCurrentProject({ source: 'manual', label: 'Atlas Agent 规划前保存' });
      if (!saved) throw new Error('项目未能保存到本机，请重试。');
      const cloud = await projectFileService.flushFireflyCloudSave();
      if (cloud.status === 'error') throw new Error(cloud.errorMessage ?? '云端检查点保存失败，请重试。');
      const snapshot = createOriginalAtlasAgentSnapshot(cloud.revision);
      setSubmittedFingerprint(originalAtlasAgentSemanticFingerprint(snapshot));
      setStatus('planning');
      const created = await originalAtlasAgentApi.createRun(embedding.projectId, {
        instruction: normalized,
        baseRevision: cloud.revision,
        snapshot,
        idempotencyKey: crypto.randomUUID(),
      });
      if (generation !== generationRef.current) return;
      setRun(created);
      if (created.plan) {
        const validation = validateOriginalAtlasAgentPlan(created.plan);
        if (validation) throw new Error(validation);
        setPlan(created.plan); setStatus('ready');
      } else await poll(created.id, generation);
    } catch (caught) {
      if (generation !== generationRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Atlas Agent 暂时不可用。');
      setStatus('failed');
    }
  };

  const cancel = async () => {
    if (status === 'applying') {
      executionControllerRef.current?.abort();
      return;
    }
    if (appliedRef.current) {
      setError('剪辑已经应用，当前只能继续同步执行结果或使用撤销。');
      return;
    }
    generationRef.current += 1;
    if (run && ['queued', 'planning', 'ready', 'awaiting_confirmation'].includes(run.status)) {
      await originalAtlasAgentApi.cancelRun(embedding.projectId, run.id).catch(() => undefined);
    }
    setRun(null); setPlan(null); setError(''); setStatus('idle');
  };

  const reportAppliedPlan = async (activePlan: AtlasAgentPlan, activeRun: AtlasAgentRun) => {
    const applied = appliedRef.current;
    if (!applied || applied.planDigest !== activePlan.planDigest) throw new Error('Agent 执行状态已失效，请撤销后重新规划。');
    setStatus('reporting');
    await originalAtlasAgentApi.reportExecutionResults(embedding.projectId, activeRun.id, {
      planDigest: activePlan.planDigest,
      historyNodeId: applied.historyNodeId,
      leaseToken: applied.leaseToken,
      results: activePlan.operations.map((operation) => ({
        sequence: operation.sequence,
        status: 'succeeded',
        result: operation.tool === 'requestFireflyExport'
          ? { status: 'opened', operationKey: operation.operationKey }
          : { changed: true, operationKey: operation.operationKey },
      })),
    });
    applied.nextReceiptIndex = activePlan.operations.length;
    appliedRef.current = null;
    setStatus('completed'); setInstruction(''); setPlan(null);
  };

  const apply = async () => {
    if (!plan || !run) return;
    if (appliedRef.current) {
      setError('');
      try { await reportAppliedPlan(plan, run); }
      catch (caught) { setError(caught instanceof Error ? caught.message : '执行结果同步失败。'); setStatus('failed'); }
      return;
    }
    const leaseToken = embedding.getLeaseToken?.();
    if (!leaseToken) { setError('项目处于只读状态，请先接管编辑权。'); setStatus('failed'); return; }
    setError(''); setStatus('applying');
    const executionController = new AbortController();
    executionControllerRef.current = executionController;
    let confirmed = false;
    try {
      const cloud = projectFileService.getFireflyCloudSaveState();
      if (!cloud || cloud.revision !== plan.baseRevision) throw new Error('项目版本已经变化，请重新生成计划。');
      const currentSnapshot = createOriginalAtlasAgentSnapshot(cloud.revision);
      if (originalAtlasAgentSemanticFingerprint(currentSnapshot) !== submittedFingerprint) {
        throw new Error('规划期间时间线已被修改，请重新生成计划。');
      }
      await originalAtlasAgentApi.confirmRun(embedding.projectId, run.id, true, leaseToken);
      confirmed = true;
      const transaction = await applyOriginalAtlasAgentPlan(plan, executionController.signal);
      const saved = await saveCurrentProject({ source: 'manual', label: `Atlas Agent · ${plan.summary}` });
      if (!saved) throw new Error('Agent 更改已保留在撤销记录中，但本地保存失败。请撤销或重试保存。');
      const persisted = await projectFileService.flushFireflyCloudSave();
      if (persisted.status === 'error') throw new Error(persisted.errorMessage ?? 'Agent 更改尚未同步到云端。');
      appliedRef.current = {
        planDigest: plan.planDigest,
        historyNodeId: transaction.historyNodeId,
        nextReceiptIndex: 0,
        leaseToken,
      };
      await reportAppliedPlan(plan, run);
    } catch (caught) {
      if (confirmed && !appliedRef.current) {
        await originalAtlasAgentApi.reportExecutionResults(embedding.projectId, run.id, {
          planDigest: plan.planDigest,
          leaseToken,
          results: plan.operations.map((operation) => ({
            sequence: operation.sequence,
            status: 'failed',
            result: { code: executionController.signal.aborted ? 'EXECUTION_CANCELLED' : 'EXECUTION_ROLLED_BACK' },
          })),
        }).catch(() => undefined);
      }
      setError(caught instanceof Error ? caught.message : 'Agent 计划执行失败。');
      setStatus('failed');
    } finally {
      if (executionControllerRef.current === executionController) executionControllerRef.current = null;
    }
  };

  const busy = ['saving', 'planning', 'applying', 'reporting'].includes(status);
  return <section className="original-atlas-agent" aria-busy={busy}>
    <div className="original-atlas-agent__stage">
      <div className="original-atlas-agent__intro">
        <span>ATLAS AGENT</span>
        <h1>想怎么剪？</h1>
        <p>描述你的剪辑意图。Atlas 会先给出操作计划，确认后才会修改时间线。</p>
      </div>
      <div className={`original-atlas-agent__composer is-${status}`}>
        <div className="original-atlas-agent__avatar" aria-hidden="true">
          <BloubAvatar state={avatarStateFor(status)} />
        </div>
        <label className="original-atlas-agent__input">
          <span className="sr-only">剪辑指令</span>
          <textarea
            value={instruction}
            maxLength={4_000}
            rows={1}
            disabled={busy}
            onChange={(event) => setInstruction(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            placeholder="例如：把第一个片段在 3 秒处切开，并将后半段移到下一条视频轨道"
          />
          <span className={`original-atlas-agent__status is-${status}`} aria-live="polite">{statusLabel(status)}</span>
        </label>
        <button
          type="button"
          className="original-atlas-agent__send"
          aria-label="生成操作计划"
          title="生成操作计划（Enter）"
          onClick={() => void submit()}
          disabled={busy || !instruction.trim() || Boolean(plan)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M11 6l4 4-4 4" /></svg>
        </button>
      </div>
      <div className="original-atlas-agent__body">
      {plan && <article className="original-atlas-agent__plan">
        <b>{plan.summary}</b>
        <ol>{plan.operations.map((operation) => <li key={operation.operationKey}><span>{operation.sequence}</span><strong title={operation.tool}>{operationLabel(plan, operation.tool)}</strong><em>{operation.risk === 'destructive' ? '高风险' : operation.risk === 'external' ? '外部操作' : '需要确认'}</em></li>)}</ol>
        <div className="original-atlas-agent__warning">请核对全部步骤。确认后将作为一个撤销事务执行；任一步失败都会回滚整组操作。</div>
      </article>}
      {error && <div className="original-atlas-agent__error" role="alert">{error}</div>}
      {status === 'completed' && !error && <div className="original-atlas-agent__completed" role="status">更改已应用，可使用编辑器的撤销功能恢复。</div>}
      {(plan || busy || status === 'completed' || error) && <div className="original-atlas-agent__actions">
        <button type="button" className="agent-button agent-button--quiet" onClick={() => void cancel()} disabled={status === 'reporting' || Boolean(appliedRef.current)}>{busy ? '停止' : '清空'}</button>
        {plan && <button type="button" className="agent-button agent-button--primary" onClick={() => void apply()} disabled={busy}>{appliedRef.current ? '同步执行结果' : '确认并应用'}</button>}
      </div>}
      </div>
    </div>
  </section>;
}
