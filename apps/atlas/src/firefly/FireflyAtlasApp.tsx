import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, atlasApi, redirectToFeishu } from './api';
import { createEmptyDocument, stripRuntimeUrls, type AtlasBootstrap, type AtlasDocument, type AtlasProjectSummary } from './model';
import { deleteLocalProject, listLocalProjects, loadLocalProject, saveLocalProject } from './storage';
import { useI18n } from './i18n';
import { AtlasBrand } from './components/Brand';
import { Icon } from './components/Icon';
import { ProjectDashboard } from './components/ProjectDashboard';
import { Workspace } from './components/Workspace';
import { Modal } from './components/Modal';
import { reconcileProjectAssets } from './asset-reconciliation';

type AppPhase = 'booting' | 'dashboard' | 'opening' | 'workspace' | 'failed';

export function FireflyAtlasApp() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<AppPhase>('booting');
  const [bootstrap, setBootstrap] = useState<AtlasBootstrap | null>(null);
  const [projects, setProjects] = useState<AtlasProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectsError, setProjectsError] = useState<string>();
  const [activeDocument, setActiveDocument] = useState<AtlasDocument | null>(null);
  const [openConflict, setOpenConflict] = useState<{ project: AtlasProjectSummary; local: AtlasDocument } | null>(null);
  const [openConflictPending, setOpenConflictPending] = useState(false);
  const [openConflictError, setOpenConflictError] = useState<string | null>(null);
  const openRequestRef = useRef(0);
  const openConflictActionRef = useRef(false);

  const loadProjects = useCallback(async (session: AtlasBootstrap) => {
    setProjectsLoading(true);
    setProjectsError(undefined);
    const local = await listLocalProjects(session.user.id).catch(() => []);
    try {
      const cloud = await atlasApi.listProjects();
      setProjects(mergeCloudAuthoritativeProjects(cloud, local));
    } catch {
      setProjects(local);
      setProjectsError(navigator.onLine ? t('bootstrap.failedBody') : t('app.offline'));
    } finally {
      setProjectsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      try {
        const session = await atlasApi.bootstrap();
        if (cancelled) return;
        setBootstrap(session);
        setPhase('dashboard');
        await loadProjects(session);
        const requestedProject = new URLSearchParams(window.location.search).get('project');
        if (requestedProject) {
          const project = (await atlasApi.listProjects()).find((candidate) => candidate.id === requestedProject);
          if (project && !cancelled) await openProject(session, project, false);
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToFeishu();
          return;
        }
        setPhase('failed');
      }
    };
    void boot();
    return () => { cancelled = true; };
    // bootstrap runs exactly once; later refreshes use the explicit retry path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProject = async (session: AtlasBootstrap, project: AtlasProjectSummary, forceCloud = false) => {
    const requestId = ++openRequestRef.current;
    setPhase('opening');
    try {
      const localPromise = loadLocalProject(session.user.id, project.id).catch(() => null);
      const cloudProjectPromise = atlasApi.getProject(project.id).catch((error) => {
        if (error instanceof ApiError && error.status === 401) redirectToFeishu();
        return null;
      });
      const projectAssetsPromise = atlasApi.listProjectAssets(project.id).catch(() => []);
      const [local, cloudProject] = await Promise.all([localPromise, cloudProjectPromise]);
      if (requestId !== openRequestRef.current) return;
      const effectiveProject = cloudProject ?? project;
      const cloudDocument = effectiveProject.hasCheckpoint
        ? await atlasApi.loadCheckpoint(project.id).then((value) => ({ ...value, title: effectiveProject.title, revision: effectiveProject.revision })).catch((error) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        })
        : null;
      const decision = resolveProjectOpen({ local, cloud: cloudDocument, project: effectiveProject, forceCloud, cloudKnown: Boolean(cloudProject) });
      if (requestId !== openRequestRef.current) return;
      if (decision.kind === 'conflict') {
        setOpenConflictError(null);
        setOpenConflict({ project: effectiveProject, local: decision.local });
        setActiveDocument(null);
        setPhase('dashboard');
        return;
      }
      const document = reconcileProjectAssets(decision.document, await projectAssetsPromise);
      if (requestId !== openRequestRef.current) return;
      void saveLocalProject(session.user.id, document).catch(() => undefined);
      setActiveDocument(document);
      setPhase('workspace');
      window.history.replaceState(null, '', `/studio/atlas/?project=${encodeURIComponent(project.id)}`);
    } catch {
      if (requestId !== openRequestRef.current) return;
      setPhase('dashboard');
      setProjectsError(t('bootstrap.failedBody'));
    }
  };

  const returnToDashboard = () => {
    openRequestRef.current += 1;
    setActiveDocument(null);
    setPhase('dashboard');
    window.history.replaceState(null, '', '/studio/atlas/');
    if (bootstrap) void loadProjects(bootstrap);
  };

  const resolveOpenConflict = async (choice: 'copy' | 'cloud') => {
    if (!openConflict || openConflictActionRef.current) return;
    openConflictActionRef.current = true;
    setOpenConflictPending(true);
    setOpenConflictError(null);
    const conflict = openConflict;
    try {
      if (choice === 'copy') {
        const copyProject = await atlasApi.createProject(`${conflict.local.title} · 副本`);
        const copy = { ...conflict.local, projectId: copyProject.id, title: copyProject.title, revision: copyProject.revision };
        await saveLocalProject(bootstrap!.user.id, copy);
        setProjects((current) => [copyProject, ...current]);
        setOpenConflict(null);
        await openProject(bootstrap!, copyProject);
      } else {
        setOpenConflict(null);
        await openProject(bootstrap!, conflict.project, true);
      }
    } catch (error) {
      setOpenConflict(conflict);
      setOpenConflictError(error instanceof Error ? error.message : t('projects.operationFailed'));
    } finally {
      openConflictActionRef.current = false;
      setOpenConflictPending(false);
    }
  };

  if (phase === 'booting' || phase === 'opening') {
    return <LoadingScreen title={phase === 'opening' ? t('app.loading') : t('bootstrap.title')} body={t('bootstrap.body')} />;
  }

  if (phase === 'failed' || !bootstrap) {
    return (
      <div className="atlas-fatal">
        <AtlasBrand />
        <span className="atlas-fatal__icon"><Icon name="warning" /></span>
        <h1>{t('bootstrap.failedTitle')}</h1>
        <p>{t('bootstrap.failedBody')}</p>
        <button className="atlas-button atlas-button--primary" type="button" onClick={() => window.location.reload()}><Icon name="refresh" />{t('app.retry')}</button>
      </div>
    );
  }

  if (phase === 'workspace' && activeDocument) {
    return (
      <Workspace
        key={activeDocument.projectId}
        bootstrap={bootstrap}
        initialDocument={activeDocument}
        onBack={returnToDashboard}
        onProjectUpdated={(project) => setProjects((current) => mergeCloudAuthoritativeProjects([project], current.filter((candidate) => candidate.id !== project.id)))}
        onOpenProject={(project) => void openProject(bootstrap, project)}
      />
    );
  }

  return (
    <>
    <ProjectDashboard
      bootstrap={bootstrap}
      projects={projects}
      loading={projectsLoading}
      error={projectsError}
      onRefresh={() => void loadProjects(bootstrap)}
      onCreate={async (title) => {
        const project = await atlasApi.createProject(title);
        const document = createEmptyDocument(project.id, project.title, project.revision);
        await saveLocalProject(bootstrap.user.id, document);
        setProjects((current) => [project, ...current]);
        await openProject(bootstrap, project);
      }}
      onOpen={(project, restore) => void openProject(bootstrap, project, restore)}
      onRename={async (project, title) => {
        const updated = await atlasApi.renameProject(project.id, title, project.revision);
        setProjects((current) => current.map((candidate) => candidate.id === project.id ? { ...candidate, ...updated, title } : candidate));
        const local = await loadLocalProject(bootstrap.user.id, project.id);
        if (local) await saveLocalProject(bootstrap.user.id, { ...local, title, updatedAt: new Date().toISOString() });
      }}
      onDelete={async (project) => {
        if (!project.localOnly) await atlasApi.deleteProject(project.id);
        await deleteLocalProject(bootstrap.user.id, project.id);
        setProjects((current) => current.filter((candidate) => candidate.id !== project.id));
      }}
    />
    {openConflict && (
      <Modal
        title={t('workspace.conflictTitle')}
        onClose={() => setOpenConflict(null)}
        closeDisabled={openConflictPending}
        actions={<>
          <button className="atlas-button atlas-button--quiet" type="button" disabled={openConflictPending} onClick={() => setOpenConflict(null)}>{t('app.cancel')}</button>
          <button className="atlas-button atlas-button--soft" type="button" disabled={openConflictPending} onClick={() => void resolveOpenConflict('copy')}>{t('workspace.keepCopy')}</button>
          <button className="atlas-button atlas-button--primary" type="button" disabled={openConflictPending} onClick={() => void resolveOpenConflict('cloud')}>{t('workspace.reloadCloud')}</button>
        </>}
      >
        <p>{t('workspace.conflictBody')}</p>
        {openConflictError && <div className="atlas-inline-alert atlas-inline-alert--error" role="alert"><Icon name="warning" /><span><strong>{openConflictError}</strong></span></div>}
      </Modal>
    )}
    </>
  );
}

export function mergeCloudAuthoritativeProjects(cloud: AtlasProjectSummary[], local: AtlasProjectSummary[]): AtlasProjectSummary[] {
  const merged = new Map(cloud.map((project) => [project.id, project]));
  for (const draft of local) {
    if (!merged.has(draft.id)) merged.set(draft.id, { ...draft, localOnly: true });
  }
  return [...merged.values()].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
}

export function resolveProjectOpen(input: {
  local: AtlasDocument | null;
  cloud: AtlasDocument | null;
  project: AtlasProjectSummary;
  forceCloud: boolean;
  cloudKnown: boolean;
}): { kind: 'open'; document: AtlasDocument } | { kind: 'conflict'; local: AtlasDocument } {
  const empty = () => createEmptyDocument(input.project.id, input.project.title, input.project.revision);
  if (input.forceCloud) return { kind: 'open', document: input.cloud ?? empty() };
  if (!input.local) return { kind: 'open', document: input.cloud ?? empty() };
  if (!input.cloudKnown) return { kind: 'open', document: input.local };
  if (input.cloud && documentsSemanticallyEqual(input.local, input.cloud)) return { kind: 'open', document: input.cloud };
  if (input.local.revision !== input.project.revision) return { kind: 'conflict', local: input.local };
  // Same base revision means the local document is a legitimate unsaved draft.
  // Keep its own revision; never rewrite it using a timestamp comparison.
  return { kind: 'open', document: input.local };
}

function documentsSemanticallyEqual(left: AtlasDocument, right: AtlasDocument): boolean {
  const comparable = (document: AtlasDocument) => {
    const stripped = stripRuntimeUrls(document);
    return { ...stripped, title: '', revision: 0, updatedAt: '' };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
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
