import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import type { ReactNode } from 'react';
import ts from 'typescript';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  bootstrap: vi.fn(),
  closeCurrentProject: vi.fn(),
  flushCloudSave: vi.fn(),
  listProjects: vi.fn(),
  loadProjectToStores: vi.fn(),
  openFireflyProject: vi.fn(),
  releaseLease: vi.fn(),
  renewLease: vi.fn(),
  saveCurrentProject: vi.fn(),
  teardownAutoSync: vi.fn(),
  updateLeaseToken: vi.fn(),
}));

const project = {
  id: 'project-1',
  title: '原 Atlas 项目',
  revision: 0,
  hasCheckpoint: false,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const resolveLocalImport = (fromFile: string, specifier: string): string | null => {
  if (!specifier.startsWith('.')) return null;
  const unresolved = resolve(dirname(fromFile), specifier);
  const candidates = [
    unresolved,
    `${unresolved}.ts`,
    `${unresolved}.tsx`,
    resolve(unresolved, 'index.ts'),
    resolve(unresolved, 'index.tsx'),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
};

const collectProductionSourceGraph = (): Set<string> => {
  const sourceRoot = resolve(process.cwd(), 'src');
  const pending = [resolve(sourceRoot, 'main.tsx')];
  const reachable = new Set<string>();
  while (pending.length > 0) {
    const file = pending.pop()!;
    const sourcePath = relative(sourceRoot, file).replaceAll('\\', '/');
    if (reachable.has(sourcePath)) continue;
    reachable.add(sourcePath);
    const source = readFileSync(file, 'utf8');
    const imports = ts.preProcessFile(source, true, true).importedFiles;
    for (const imported of imports) {
      const resolved = resolveLocalImport(file, imported.fileName);
      if (resolved) pending.push(resolved);
    }
  }
  return reachable;
};

vi.mock('../projectApi', async (importOriginal) => {
  const original = await importOriginal<typeof import('../projectApi')>();
  return {
    ...original,
    fireflyProjectApi: {
      bootstrap: mocks.bootstrap,
      listProjects: mocks.listProjects,
      createProject: vi.fn(),
      getProject: vi.fn(),
      renameProject: vi.fn(),
      deleteProject: vi.fn(),
      acquireLease: mocks.acquireLease,
      renewLease: mocks.renewLease,
      releaseLease: mocks.releaseLease,
    },
  };
});

vi.mock('../FireflyEditorAdapter', () => ({
  openEditorProject: async (options: unknown) => {
    const opened = await mocks.openFireflyProject(options);
    if (opened) await mocks.loadProjectToStores();
    return opened;
  },
  saveEditorProjectLocally: mocks.saveCurrentProject,
  flushEditorProjectCloud: mocks.flushCloudSave,
  updateEditorLeaseToken: mocks.updateLeaseToken,
  closeEditorProject: mocks.closeCurrentProject,
  disposeEditorRuntime: mocks.teardownAutoSync,
}));

vi.mock('../../RootApp', () => ({
  RootApp: ({ fireflyEmbedded }: { fireflyEmbedded?: { onBackToProjects: () => void | Promise<void> } }) => <div data-testid="original-atlas-runtime">original-atlas-runtime<button type="button" onClick={() => void fireflyEmbedded?.onBackToProjects()}>return-projects</button></div>,
}));

vi.mock('../components/ProjectDashboard', () => ({
  ProjectDashboard: ({ projects, onOpen }: {
    projects: typeof project[];
    onOpen: (value: typeof project) => void;
  }) => (
    <button type="button" onClick={() => onOpen(projects[0]!)}>open-original-project</button>
  ),
}));

vi.mock('../components/Brand', () => ({ AtlasBrand: () => <span>Atlas</span> }));
vi.mock('../components/Icon', () => ({ Icon: () => <span /> }));
vi.mock('../components/Modal', () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));

import { FireflyAtlasApp } from '../FireflyAtlasApp';
import { I18nProvider } from '../i18n';

describe('Firefly Atlas upstream runtime shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/studio/atlas/');
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocks.bootstrap.mockResolvedValue({
      user: { id: 'user-1', name: '九久', email: 'jiujiu@dokuai.tv' },
      capabilities: { agent: true, maxUploadBytes: 8_000_000, partSize: 1024, uploadConcurrency: 3 },
    });
    mocks.listProjects.mockResolvedValue([project]);
    mocks.acquireLease.mockResolvedValue({ token: 'a'.repeat(43), deviceId: 'device-1234', expiresAt: Date.now() + 45_000 });
    mocks.renewLease.mockResolvedValue({ token: 'a'.repeat(43), deviceId: 'device-1234', expiresAt: Date.now() + 45_000 });
    mocks.releaseLease.mockResolvedValue(undefined);
    mocks.openFireflyProject.mockResolvedValue(true);
    mocks.loadProjectToStores.mockResolvedValue(undefined);
    mocks.saveCurrentProject.mockResolvedValue(true);
    mocks.flushCloudSave.mockResolvedValue({ status: 'saved', revision: 1 });
  });

  it('opens the Firefly project through ProjectFileService before mounting the original RootApp', async () => {
    render(<I18nProvider locale="zh-CN"><FireflyAtlasApp /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'open-original-project' }));
    expect(await screen.findByTestId('original-atlas-runtime')).toBeInTheDocument();
    expect(mocks.openFireflyProject).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      projectId: 'project-1',
      leaseToken: 'a'.repeat(43),
    }));
    expect(mocks.loadProjectToStores).toHaveBeenCalledOnce();
  });

  it('resumes the same-tab lease after refresh instead of acquiring over itself', async () => {
    window.sessionStorage.setItem('firefly:atlas:user-1:projects:project-1:lease-token', 'a'.repeat(43));
    render(<I18nProvider locale="zh-CN"><FireflyAtlasApp /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'open-original-project' }));
    await screen.findByTestId('original-atlas-runtime');
    expect(mocks.renewLease).toHaveBeenCalledOnce();
    expect(mocks.acquireLease).not.toHaveBeenCalled();
  });

  it('keeps the original editor core reachable and the retired thin editor outside the production graph', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/firefly/FireflyAtlasApp.tsx'), 'utf8');
    const editorSource = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
    const graph = collectProductionSourceGraph();
    expect(source).not.toContain("./components/Workspace");
    expect(source).not.toContain('AtlasDocument');
    expect(source).not.toContain("from './storage'");
    expect(source).not.toContain("from './model'");
    expect(editorSource).toContain('const testMode = isFireflyEmbedded ? null');
    expect(editorSource).toContain('const showMobileUI = !isFireflyEmbedded');
    for (const originalModule of [
      'App.tsx',
      'components/dock/DockContainer.tsx',
      'components/preview/Preview.tsx',
      'components/timeline/Timeline.tsx',
      'services/project/ProjectFileService.ts',
    ]) {
      expect(graph.has(originalModule), `${originalModule} is missing from the production source graph`).toBe(true);
    }
    for (const retiredModule of [
      'firefly/api.ts',
      'firefly/exporter.ts',
      'firefly/model.ts',
      'firefly/storage.ts',
      'firefly/timeline.ts',
      'firefly/components/PreviewPanel.tsx',
      'firefly/components/TimelineView.tsx',
      'firefly/components/Workspace.tsx',
    ]) {
      expect(graph.has(retiredModule), `${retiredModule} entered the production source graph`).toBe(false);
    }
  }, 30_000);

  it('does not mount the editor before session, lease, project and stores are ready', async () => {
    let resolveOpen!: (value: boolean) => void;
    mocks.openFireflyProject.mockReturnValue(new Promise((resolve) => { resolveOpen = resolve; }));
    render(<I18nProvider locale="zh-CN"><FireflyAtlasApp /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'open-original-project' }));
    expect(screen.queryByTestId('original-atlas-runtime')).not.toBeInTheDocument();
    resolveOpen(true);
    await waitFor(() => expect(screen.getByTestId('original-atlas-runtime')).toBeInTheDocument());
  });

  it('returns after the local save without waiting for a slow cloud checkpoint', async () => {
    let resolveCloud!: (value: { status: 'saved'; revision: number }) => void;
    mocks.flushCloudSave.mockReturnValue(new Promise((resolve) => { resolveCloud = resolve; }));
    render(<I18nProvider locale="zh-CN"><FireflyAtlasApp /></I18nProvider>);

    fireEvent.click(await screen.findByRole('button', { name: 'open-original-project' }));
    fireEvent.click(await screen.findByRole('button', { name: 'return-projects' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'open-original-project' })).toBeInTheDocument());
    expect(mocks.saveCurrentProject).toHaveBeenCalledOnce();
    expect(mocks.releaseLease).not.toHaveBeenCalled();

    resolveCloud({ status: 'saved', revision: 1 });
    await waitFor(() => expect(mocks.releaseLease).toHaveBeenCalledOnce());
  });
});
