import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { RootApp } from '../RootApp';
import { AtlasBrand } from './components/Brand';
import { Icon } from './components/Icon';
import { Modal } from './components/Modal';
import { ProjectDashboard } from './components/ProjectDashboard';
import { useI18n } from './i18n';
import {
  FireflyProjectApiError,
  fireflyProjectApi,
  type FireflyAtlasBootstrap,
  type FireflyAtlasProject,
  type FireflyProjectLease,
} from './projectApi';
import {
  FireflyProjectLeaseController,
  type FireflyProjectLeaseSnapshot,
} from './useFireflyProjectLease';

type AppPhase = 'booting' | 'dashboard' | 'opening' | 'workspace' | 'failed';
type RecoveryPreference = 'fail-on-conflict' | 'prefer-local' | 'prefer-cloud';

interface OpenIssue {
  kind: 'lease-locked' | 'local-cloud-conflict';
  project: FireflyAtlasProject;
}

type FireflyEditorAdapter = typeof import('./FireflyEditorAdapter');

const createDeviceId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const deviceStorageKey = (userId: string) => `firefly:atlas:${userId}:device-id`;
const leaseStorageKey = (userId: string, projectId: string) =>
  `firefly:atlas:${userId}:projects:${projectId}:lease-token`;

const getDeviceId = (userId: string): string => {
  const key = deviceStorageKey(userId);
  try {
    const existing = window.localStorage.getItem(key);
    if (existing && existing.length >= 8) return existing;
    const created = createDeviceId();
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return createDeviceId();
  }
};

const readLeaseToken = (userId: string, projectId: string): string | null => {
  try {
    return window.sessionStorage.getItem(leaseStorageKey(userId, projectId));
  } catch {
    return null;
  }
};

const writeLeaseToken = (userId: string, projectId: string, token: string | null): void => {
  try {
    const key = leaseStorageKey(userId, projectId);
    if (token) window.sessionStorage.setItem(key, token);
    else window.sessionStorage.removeItem(key);
  } catch {
    // A blocked Storage API must not prevent local editing.
  }
};

const redirectToFeishu = (): void => {
  const returnTo = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/auth/feishu/start?returnTo=${encodeURIComponent(returnTo)}`);
};

const displayError = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const structuredErrorCode = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;

export function FireflyAtlasApp() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<AppPhase>('booting');
  const [bootstrap, setBootstrap] = useState<FireflyAtlasBootstrap | null>(null);
  const [projects, setProjects] = useState<FireflyAtlasProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string>();
  const [activeProject, setActiveProject] = useState<FireflyAtlasProject | null>(null);
  const [openIssue, setOpenIssue] = useState<OpenIssue | null>(null);
  const [openIssuePending, setOpenIssuePending] = useState(false);
  const [openIssueError, setOpenIssueError] = useState<string>();
  const [leaseSnapshot, setLeaseSnapshot] = useState<FireflyProjectLeaseSnapshot | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string>();
  const openRequestRef = useRef(0);
  const autoOpenAttemptedRef = useRef(false);
  const leaseControllerRef = useRef<FireflyProjectLeaseController | null>(null);
  const leaseUnsubscribeRef = useRef<(() => void) | null>(null);
  const editorAdapterRef = useRef<FireflyEditorAdapter | null>(null);
  const backgroundCloseRef = useRef<{ projectId: string; promise: Promise<void> } | null>(null);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    setProjectsError(undefined);
    try {
      setProjects(await fireflyProjectApi.listProjects({ limit: 100 }));
    } catch (error) {
      setProjectsError(displayError(error, t('bootstrap.failedBody')));
    } finally {
      setProjectsLoading(false);
    }
  }, [t]);

  const attachLeaseController = useCallback((controller: FireflyProjectLeaseController) => {
    leaseControllerRef.current = controller;
    leaseUnsubscribeRef.current?.();
    setLeaseSnapshot(controller.getSnapshot());
    leaseUnsubscribeRef.current = controller.subscribe(() => {
      setLeaseSnapshot(controller.getSnapshot());
    });
  }, []);

  const openProject = useCallback(async (
    session: FireflyAtlasBootstrap,
    project: FireflyAtlasProject,
    options: { takeover?: boolean; recoveryPreference?: RecoveryPreference } = {},
  ) => {
    const requestId = ++openRequestRef.current;
    setPhase('opening');
    setProjectsError(undefined);
    setOpenIssue(null);
    setOpenIssueError(undefined);
    setWorkspaceError(undefined);

    const backgroundClose = backgroundCloseRef.current;
    if (backgroundClose?.projectId === project.id) {
      await backgroundClose.promise;
      if (requestId !== openRequestRef.current) return;
    }

    const controller = new FireflyProjectLeaseController({
      projectId: project.id,
      deviceId: getDeviceId(session.user.id),
      onTokenChange: (token) => {
        writeLeaseToken(session.user.id, project.id, token);
        if (token) editorAdapterRef.current?.updateEditorLeaseToken(token);
      },
      onLost: (error) => {
        if (leaseControllerRef.current === controller) setWorkspaceError(error.message);
      },
    });

    try {
      let lease: FireflyProjectLease | undefined;
      const resumedToken = readLeaseToken(session.user.id, project.id);
      if (resumedToken && !options.takeover) lease = await controller.resume(resumedToken);
      if (!lease) lease = await controller.start(options.takeover === true);
      if (requestId !== openRequestRef.current) {
        await controller.release();
        return;
      }
      if (!lease) {
        const snapshot = controller.getSnapshot();
        await controller.release();
        if (snapshot.status === 'locked') {
          setOpenIssue({ kind: 'lease-locked', project });
          setPhase('dashboard');
          return;
        }
        throw snapshot.error ?? new Error('无法取得项目编辑租约');
      }

      const editor = await import('./FireflyEditorAdapter');
      editorAdapterRef.current = editor;
      const opened = await editor.openEditorProject({
        userId: session.user.id,
        projectId: project.id,
        title: project.title,
        cloudRevision: project.revision,
        leaseToken: lease.token,
        recoveryPreference: options.recoveryPreference ?? 'fail-on-conflict',
      });
      if (!opened) throw new Error('无法打开项目工作区');
      if (requestId !== openRequestRef.current) {
        editor.closeEditorProject();
        await controller.release();
        return;
      }

      attachLeaseController(controller);
      setActiveProject(project);
      setPhase('workspace');
      window.history.replaceState(null, '', `/studio/atlas/?project=${encodeURIComponent(project.id)}`);
    } catch (error) {
      await controller.release();
      if (requestId !== openRequestRef.current) return;
      if (structuredErrorCode(error) === 'ATLAS_LOCAL_CLOUD_CONFLICT') {
        setOpenIssue({ kind: 'local-cloud-conflict', project });
        setPhase('dashboard');
        return;
      }
      if (error instanceof FireflyProjectApiError && error.status === 401) {
        redirectToFeishu();
        return;
      }
      editorAdapterRef.current?.closeEditorProject();
      editorAdapterRef.current = null;
      setPhase('dashboard');
      setProjectsError(displayError(error, t('projects.operationFailed')));
    }
  }, [attachLeaseController, t]);

  useEffect(() => {
    const abort = new AbortController();
    const boot = async () => {
      try {
        const session = await fireflyProjectApi.bootstrap({ signal: abort.signal });
        if (abort.signal.aborted) return;
        setBootstrap(session);
        setPhase('dashboard');
        void navigator.storage?.persist?.().catch(() => false);
        await loadProjects();
      } catch (error) {
        if (abort.signal.aborted) return;
        if (error instanceof FireflyProjectApiError && error.status === 401) {
          redirectToFeishu();
          return;
        }
        setPhase('failed');
      }
    };
    void boot();
    return () => abort.abort();
  }, [loadProjects]);

  useEffect(() => {
    if (!bootstrap || phase !== 'dashboard' || projectsLoading || autoOpenAttemptedRef.current) return;
    autoOpenAttemptedRef.current = true;
    const requestedProjectId = new URLSearchParams(window.location.search).get('project');
    if (!requestedProjectId) return;
    const openRequested = async () => {
      try {
        const project = projects.find((candidate) => candidate.id === requestedProjectId)
          ?? await fireflyProjectApi.getProject(requestedProjectId);
        await openProject(bootstrap, project);
      } catch (error) {
        setProjectsError(displayError(error, t('projects.operationFailed')));
      }
    };
    void openRequested();
  }, [bootstrap, openProject, phase, projects, projectsLoading, t]);

  useEffect(() => {
    const releaseOnPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) void leaseControllerRef.current?.release();
    };
    window.addEventListener('pagehide', releaseOnPageHide);
    return () => {
      window.removeEventListener('pagehide', releaseOnPageHide);
      leaseUnsubscribeRef.current?.();
      void leaseControllerRef.current?.release();
      editorAdapterRef.current?.disposeEditorRuntime();
    };
  }, []);

  const returnToDashboard = useCallback(async () => {
    if (!bootstrap || !activeProject) return;
    setWorkspaceError(undefined);
    try {
      const editor = editorAdapterRef.current;
      if (!editor) throw new Error('编辑器尚未完成初始化');
      const savedLocally = await editor.saveEditorProjectLocally();
      if (!savedLocally) throw new Error('项目未能保存到本机，请重试');

      const controller = leaseControllerRef.current;
      leaseControllerRef.current = null;
      leaseUnsubscribeRef.current?.();
      leaseUnsubscribeRef.current = null;
      setLeaseSnapshot(null);

      const cloudSave = editor.flushEditorProjectCloud();
      editor.closeEditorProject();
      editorAdapterRef.current = null;
      setActiveProject(null);
      setPhase('dashboard');
      window.history.replaceState(null, '', '/studio/atlas/');

      const completion = cloudSave.then((cloudStatus) => {
        if (cloudStatus.status === 'error') {
          setProjectsError(cloudStatus.errorMessage ?? t('workspace.saveFailed'));
        }
      }).catch((error) => {
        setProjectsError(displayError(error, t('workspace.saveFailed')));
      }).finally(async () => {
        await controller?.release();
        if (backgroundCloseRef.current?.promise === completion) backgroundCloseRef.current = null;
        await loadProjects();
      });
      backgroundCloseRef.current = { projectId: activeProject.id, promise: completion };
      void loadProjects();
    } catch (error) {
      setWorkspaceError(displayError(error, t('workspace.saveFailed')));
    }
  }, [activeProject, bootstrap, loadProjects, t]);

  const embeddedContext = useMemo(() => bootstrap ? {
    user: bootstrap.user,
    projectId: activeProject?.id ?? '',
    capabilities: { agent: bootstrap.capabilities.agent, generate: bootstrap.capabilities.generate },
    getLeaseToken: () => leaseControllerRef.current?.getSnapshot().lease?.token ?? null,
    onBackToProjects: returnToDashboard,
  } : undefined, [activeProject?.id, bootstrap, returnToDashboard]);

  const retryLostLease = useCallback(async () => {
    const controller = leaseControllerRef.current;
    if (!controller) return;
    setOpenIssuePending(true);
    setOpenIssueError(undefined);
    try {
      const lease = await controller.takeover();
      if (!lease) throw controller.getSnapshot().error ?? new Error('无法恢复编辑租约');
      editorAdapterRef.current?.updateEditorLeaseToken(lease.token);
      setWorkspaceError(undefined);
    } catch (error) {
      setOpenIssueError(displayError(error, '无法恢复编辑租约'));
    } finally {
      setOpenIssuePending(false);
    }
  }, []);

  if (phase === 'workspace' && activeProject && bootstrap && embeddedContext) {
    const leaseLost = leaseSnapshot?.lost === true || leaseSnapshot?.status === 'lost';
    return (
      <>
        <RootApp initialExperience="editor" fireflyEmbedded={embeddedContext} />
        {(workspaceError || leaseLost) && (
          <div className="firefly-atlas-shell firefly-atlas-editor-overlay-host">
            {leaseLost ? (
              <Modal
                title="编辑租约已失效"
                onClose={() => undefined}
                closeDisabled
                actions={(
                  <button className="atlas-button atlas-button--primary" disabled={openIssuePending} onClick={() => void retryLostLease()} type="button">
                    {t('workspace.takeOver')}
                  </button>
                )}
              >
                <p>项目仍安全保存在本机。重新接管后才会继续写入云端。</p>
                {openIssueError && <p role="alert">{openIssueError}</p>}
              </Modal>
            ) : (
              <div className="atlas-workspace-notice" role="alert">
                <Icon name="warning" />
                <span>{workspaceError}</span>
                <button className="atlas-button atlas-button--quiet" onClick={() => setWorkspaceError(undefined)} type="button">
                  {t('app.close')}
                </button>
              </div>
            )}
          </div>
        )}
      </>
    );
  }

  if (phase === 'booting' || phase === 'opening') {
    return (
      <div className="firefly-atlas-shell">
        <LoadingScreen title={phase === 'opening' ? t('app.loading') : t('bootstrap.title')} body={t('bootstrap.body')} />
      </div>
    );
  }

  if (phase === 'failed' || !bootstrap) {
    return (
      <div className="firefly-atlas-shell">
        <div className="atlas-fatal">
          <AtlasBrand />
          <span className="atlas-fatal__icon"><Icon name="warning" /></span>
          <h1>{t('bootstrap.failedTitle')}</h1>
          <p>{t('bootstrap.failedBody')}</p>
          <button className="atlas-button atlas-button--primary" type="button" onClick={() => window.location.reload()}>
            <Icon name="refresh" />{t('app.retry')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="firefly-atlas-shell">
      <ProjectDashboard
        bootstrap={bootstrap}
        projects={projects}
        loading={projectsLoading}
        error={projectsError}
        onRefresh={() => void loadProjects()}
        onCreate={async (title) => {
          const project = await fireflyProjectApi.createProject(title);
          setProjects((current) => [project, ...current]);
          await openProject(bootstrap, project);
        }}
        onOpen={(project, restoreCloud) => void openProject(bootstrap, project, {
          recoveryPreference: restoreCloud ? 'prefer-cloud' : 'fail-on-conflict',
        })}
        onRename={async (project, title) => {
          const updated = await fireflyProjectApi.renameProject(project.id, title, project.revision);
          setProjects((current) => current.map((candidate) => candidate.id === project.id ? updated : candidate));
        }}
        onDelete={async (project) => {
          await fireflyProjectApi.deleteProject(project.id);
          setProjects((current) => current.filter((candidate) => candidate.id !== project.id));
        }}
      />

      {openIssue && (
        <Modal
          title={openIssue.kind === 'lease-locked' ? '项目正在另一窗口编辑' : t('workspace.conflictTitle')}
          onClose={() => setOpenIssue(null)}
          closeDisabled={openIssuePending}
          actions={(
            <>
              <button className="atlas-button atlas-button--quiet" disabled={openIssuePending} onClick={() => setOpenIssue(null)} type="button">
                {t('app.cancel')}
              </button>
              {openIssue.kind === 'lease-locked' ? (
                <button
                  className="atlas-button atlas-button--primary"
                  disabled={openIssuePending}
                  onClick={() => {
                    setOpenIssuePending(true);
                    void openProject(bootstrap, openIssue.project, { takeover: true })
                      .finally(() => setOpenIssuePending(false));
                  }}
                  type="button"
                >
                  {t('workspace.takeOver')}
                </button>
              ) : (
                <>
                  <button
                    className="atlas-button atlas-button--soft"
                    disabled={openIssuePending}
                    onClick={() => void openProject(bootstrap, openIssue.project, { recoveryPreference: 'prefer-local' })}
                    type="button"
                  >
                    保留本地草稿
                  </button>
                  <button
                    className="atlas-button atlas-button--primary"
                    disabled={openIssuePending}
                    onClick={() => void openProject(bootstrap, openIssue.project, { recoveryPreference: 'prefer-cloud' })}
                    type="button"
                  >
                    {t('workspace.reloadCloud')}
                  </button>
                </>
              )}
            </>
          )}
        >
          <p>{openIssue.kind === 'lease-locked' ? '为防止覆盖，第二个窗口默认不会进入编辑状态。' : t('workspace.conflictBody')}</p>
          {openIssueError && <p role="alert">{openIssueError}</p>}
        </Modal>
      )}
    </div>
  );
}

function LoadingScreen({ title, body }: { title: string; body: string }) {
  return (
    <div className="atlas-loading-screen" aria-live="polite" aria-busy="true">
      <AtlasBrand />
      <div className="atlas-loading-orbit" aria-hidden="true"><span /><i /><i /></div>
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}
