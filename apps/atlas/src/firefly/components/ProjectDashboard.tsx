import { useMemo, useRef, useState } from 'react';
import type {
  FireflyAtlasBootstrap,
  FireflyAtlasProject,
} from '../projectApi';
import { useI18n } from '../i18n';
import { detectBrowserSupport } from '../capabilities';
import { AtlasBrand } from './Brand';
import { Icon } from './Icon';
import { Modal } from './Modal';

export function ProjectDashboard({
  bootstrap,
  projects,
  loading,
  error,
  onRefresh,
  onCreate,
  onOpen,
  onRename,
  onDelete,
}: {
  bootstrap: FireflyAtlasBootstrap;
  projects: FireflyAtlasProject[];
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onCreate: (title: string) => Promise<void>;
  onOpen: (project: FireflyAtlasProject, restoreCloud?: boolean) => void;
  onRename: (project: FireflyAtlasProject, title: string) => Promise<void>;
  onDelete: (project: FireflyAtlasProject) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [dialog, setDialog] = useState<'create' | 'rename' | 'delete' | null>(null);
  const [target, setTarget] = useState<FireflyAtlasProject | null>(null);
  const [title, setTitle] = useState('');
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const support = useMemo(detectBrowserSupport, []);
  const browserWarning = !support.desktop || !support.chromium || !support.webCodecs;

  const openCreate = () => {
    setOperationError(null);
    setTitle(t('projects.newName'));
    setTarget(null);
    setDialog('create');
  };
  const openRename = (project: FireflyAtlasProject) => {
    setOperationError(null);
    setTitle(project.title);
    setTarget(project);
    setDialog('rename');
  };
  const openDelete = (project: FireflyAtlasProject) => {
    setOperationError(null);
    setTarget(project);
    setDialog('delete');
  };
  const submit = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      if (dialog === 'create') await onCreate(title.trim() || t('projects.newName'));
      if (dialog === 'rename' && target) await onRename(target, title.trim() || target.title);
      if (dialog === 'delete' && target) await onDelete(target);
      setDialog(null);
    } catch (failure) {
      setOperationError(failure instanceof Error ? failure.message : t('projects.operationFailed'));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="atlas-dashboard">
      <header className="atlas-dashboard__nav">
        <AtlasBrand />
        <div className="atlas-dashboard__nav-actions">
          <a className="atlas-button atlas-button--quiet" href="/studio"><Icon name="arrow-left" />{t('app.backToFirefly')}</a>
          <div className="atlas-user" title={`${t('app.account')} · ${bootstrap.user.email}`}>
            {bootstrap.user.avatarUrl ? <img src={bootstrap.user.avatarUrl} alt="" /> : <span>{bootstrap.user.name.slice(0, 1).toUpperCase()}</span>}
            <span><strong>{bootstrap.user.name}</strong><small>{bootstrap.user.email}</small></span>
          </div>
        </div>
      </header>

      <main className="atlas-dashboard__main">
        <section className="atlas-dashboard__intro">
          <div>
            <span className="atlas-eyebrow"><Icon name="device" />{t('notice.localFirst')}</span>
            <h1>{t('projects.title')}</h1>
            <p>{t('projects.subtitle')}</p>
          </div>
          <button className="atlas-button atlas-button--primary atlas-button--large" type="button" onClick={openCreate}>
            <Icon name="plus" />{t('projects.new')}
          </button>
        </section>

        {browserWarning && (
          <aside className="atlas-inline-alert" role="status">
            <Icon name="warning" />
            <span><strong>{t('browser.unsupportedTitle')}</strong><small>{t('browser.unsupportedBody')}</small></span>
          </aside>
        )}
        {error && (
          <aside className="atlas-inline-alert atlas-inline-alert--error" role="alert">
            <Icon name="warning" /><span><strong>{t('workspace.saveFailed')}</strong><small>{error}</small></span>
            <button type="button" className="atlas-button atlas-button--quiet" onClick={onRefresh}><Icon name="refresh" />{t('app.retry')}</button>
          </aside>
        )}

        {loading ? (
          <div className="atlas-project-grid" aria-busy="true" aria-label={t('app.loading')}>
            {[0, 1, 2].map((item) => <div className="atlas-project-card atlas-project-card--skeleton" key={item} />)}
          </div>
        ) : projects.length ? (
          <div className="atlas-project-grid">
            {projects.map((project, index) => (
              <article className="atlas-project-card" key={project.id}>
                <button className="atlas-project-card__cover" type="button" onClick={() => onOpen(project)} aria-label={`${t('projects.open')}：${project.title}`}>
                  <span className="atlas-project-card__index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="atlas-project-card__frames" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                  <Icon name="play" />
                </button>
                <div className="atlas-project-card__body">
                  <div>
                    <h2>{project.title}</h2>
                    <p>{t('projects.updated')} · {new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(project.updatedAt))}</p>
                  </div>
                  <div className="atlas-project-card__status">
                    <span><Icon name="cloud" />{t('projects.cloudReady')}</span>
                  </div>
                  <div className="atlas-project-card__actions">
                    <button className="atlas-button atlas-button--quiet" type="button" onClick={() => onOpen(project)}>{t('projects.open')}</button>
                    {project.hasCheckpoint && <button className="atlas-button atlas-button--quiet" type="button" onClick={() => onOpen(project, true)}>{t('projects.restore')}</button>}
                    <button className="atlas-icon-button" type="button" onClick={() => openRename(project)} aria-label={`${t('app.rename')}：${project.title}`}><Icon name="more" /></button>
                    <button className="atlas-icon-button atlas-icon-button--danger" type="button" onClick={() => openDelete(project)} aria-label={`${t('app.delete')}：${project.title}`}><Icon name="trash" /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="atlas-empty-state">
            <span className="atlas-empty-state__mark"><Icon name="timeline" /></span>
            <h2>{t('projects.emptyTitle')}</h2>
            <p>{t('projects.emptyBody')}</p>
            <button className="atlas-button atlas-button--primary" type="button" onClick={openCreate}><Icon name="plus" />{t('projects.new')}</button>
          </div>
        )}
      </main>

      {(dialog === 'create' || dialog === 'rename') && (
        <Modal
          title={dialog === 'create' ? t('projects.new') : t('projects.renameTitle')}
          onClose={() => setDialog(null)}
          closeDisabled={pending}
          actions={<><button className="atlas-button atlas-button--quiet" disabled={pending} type="button" onClick={() => setDialog(null)}>{t('app.cancel')}</button><button className="atlas-button atlas-button--primary" disabled={pending} type="button" onClick={() => void submit()}>{dialog === 'create' ? t('projects.new') : t('app.save')}</button></>}
        >
          <label className="atlas-field"><span>{t('projects.renameTitle')}</span><input value={title} maxLength={80} disabled={pending} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && !pending && void submit()} /></label>
          {operationError && <div className="atlas-inline-alert atlas-inline-alert--error" role="alert"><Icon name="warning" /><span><strong>{operationError}</strong></span></div>}
        </Modal>
      )}
      {dialog === 'delete' && target && (
        <Modal
          title={t('projects.deleteTitle')}
          onClose={() => setDialog(null)}
          closeDisabled={pending}
          actions={<><button className="atlas-button atlas-button--quiet" disabled={pending} type="button" onClick={() => setDialog(null)}>{t('app.cancel')}</button><button className="atlas-button atlas-button--danger" disabled={pending} type="button" onClick={() => void submit()}>{t('projects.deleteConfirm')}</button></>}
        >
          <p>{t('projects.deleteBody')}</p><strong>{target.title}</strong>
          {operationError && <div className="atlas-inline-alert atlas-inline-alert--error" role="alert"><Icon name="warning" /><span><strong>{operationError}</strong></span></div>}
        </Modal>
      )}
    </div>
  );
}
