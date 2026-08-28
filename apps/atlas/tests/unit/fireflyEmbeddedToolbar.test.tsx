import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  legacyNew: vi.fn(),
  legacyOpen: vi.fn(),
  restoreLastProject: vi.fn(async () => true),
  setupAutoSync: vi.fn(),
}));

vi.mock('../../src/services/logger', () => ({
  Logger: { create: () => ({ info: vi.fn(), error: vi.fn() }) },
}));

vi.mock('../../src/hooks/useEngine', () => ({
  useEngine: () => ({ isEngineReady: true, createOutputWindow: vi.fn() }),
}));

vi.mock('../../src/stores/dockStore', () => {
  const state = {
    resetLayout: vi.fn(),
    isPanelTypeVisible: vi.fn(() => true),
    activatePanelType: vi.fn(),
    hidePanelType: vi.fn(),
    saveLayoutAsDefault: vi.fn(),
    saveNamedLayout: vi.fn(),
    saveCurrentNamedLayout: vi.fn(),
    loadSavedLayout: vi.fn(),
    savedLayouts: [],
    defaultSavedLayoutId: null,
    activeSavedLayoutId: null,
    setDefaultSavedLayout: vi.fn(),
    toggleFavoriteSavedLayout: vi.fn(),
  };
  return {
    CAN_EDIT_FACTORY_DOCK_LAYOUTS: false,
    useDockStore: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock('../../src/stores/settingsStore', () => {
  const state = {
    isSettingsOpen: false,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    saveMode: 'continuous',
    autosaveEnabled: true,
    setAutosaveEnabled: vi.fn(),
    autosaveInterval: 2,
    setAutosaveInterval: vi.fn(),
  };
  return { useSettingsStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

vi.mock('../../src/stores/renderTargetStore', () => {
  const state = { targets: new Map() };
  return { useRenderTargetStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

vi.mock('../../src/stores/accountStore', () => {
  const state = {
    session: { authenticated: true },
    user: { email: 'legacy@example.com' },
    openAccountDialog: vi.fn(),
    openAuthDialog: vi.fn(),
  };
  return { useAccountStore: (selector: (value: typeof state) => unknown) => selector(state) };
});

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: { getState: () => ({ newProject: vi.fn(), setProjectName: vi.fn() }) },
}));

vi.mock('../../src/services/projectFileService', () => ({
  RECENT_PROJECTS_CHANGED_EVENT: 'recent-projects-changed',
  projectFileService: {
    getProjectData: () => ({ name: 'Firefly 剪辑' }),
    getRecentProjects: () => [],
    hasUnsavedChanges: () => false,
    isProjectOpen: () => true,
    needsPermission: () => false,
    getPendingProjectName: () => null,
    restoreLastProject: mocks.restoreLastProject,
  },
}));

vi.mock('../../src/services/projectSync', () => ({
  loadProjectToStores: vi.fn(),
  saveCurrentProject: vi.fn(async () => true),
  setProjectLoadProgress: vi.fn(),
  setupAutoSync: mocks.setupAutoSync,
}));

vi.mock('../../src/components/common/toolbar/useToolbarProjectActions', () => ({
  useToolbarProjectActions: () => ({
    handleClearRecentProjects: vi.fn(),
    handleNameSubmit: vi.fn(),
    handleNew: mocks.legacyNew,
    handleOpen: mocks.legacyOpen,
    handleOpenRecent: vi.fn(),
    handleProjectNameSubmit: vi.fn(),
    handleRestorePermission: vi.fn(),
    handleSave: vi.fn(),
    handleSaveAs: vi.fn(),
  }),
}));

vi.mock('../../src/components/common/toolbar/useToolbarProjectShortcuts', () => ({
  useToolbarProjectShortcuts: vi.fn(),
}));
vi.mock('../../src/components/common/toolbar/useToolbarEditActions', () => ({
  useToolbarEditActions: () => ({
    handleCopy: vi.fn(), handlePaste: vi.fn(), handleOpenSettings: vi.fn(),
  }),
}));
vi.mock('../../src/components/common/toolbar/useToolbarViewActions', () => ({
  useToolbarViewActions: () => ({
    activeSavedLayout: null,
    activeSavedLayoutProtected: false,
    favoriteSavedLayouts: [],
    sortedSavedLayouts: [],
    handleResetLayout: vi.fn(),
    handleLoadSavedLayout: vi.fn(),
    handleSaveLayoutAsDefault: vi.fn(),
    handleSaveCurrentNamedLayout: vi.fn(),
    handleSaveNamedLayout: vi.fn(),
    handleSetDefaultSavedLayout: vi.fn(),
    handleToggleFavoriteSavedLayout: vi.fn(),
    handleToggleViewPanelType: vi.fn(),
  }),
}));
vi.mock('../../src/components/common/toolbar/useDevChatNotification', () => ({
  useDevChatNotification: () => ({ markMessagesSeen: vi.fn(), unreadCount: 0 }),
}));

vi.mock('../../src/services/capture/ScreenCaptureService', () => ({
  screenCaptureService: {
    getSnapshot: () => ({ phase: 'idle' }),
    subscribe: () => vi.fn(),
  },
}));

vi.mock('../../src/components/common/toolbar/FileMenu', () => ({
  FileMenu: ({ onNew, onOpen }: { onNew: () => void; onOpen: () => void }) => (
    <>
      <button type="button" onClick={onNew}>mock-new</button>
      <button type="button" onClick={onOpen}>mock-open</button>
    </>
  ),
}));

vi.mock('../../src/components/common/toolbar/EditMenu', () => ({
  EditMenu: () => <div>legacy-menu</div>,
}));
vi.mock('../../src/components/common/toolbar/InfoMenu', () => ({
  InfoMenu: () => <div>original-tutorial-menu</div>,
}));
vi.mock('../../src/components/common/toolbar/HelpMenu', () => ({
  HelpMenu: () => <div>legacy-help</div>,
}));
vi.mock('../../src/components/common/toolbar/OutputMenu', () => ({ OutputMenu: () => null }));
vi.mock('../../src/components/common/toolbar/ViewMenu', () => ({ ViewMenu: () => null }));

vi.mock('../../src/components/common/NativeHelperStatus', () => ({
  NativeHelperStatus: () => <div>legacy-native-helper</div>,
}));
vi.mock('../../src/components/common/CreditBurnMeter', () => ({
  CreditBurnMeter: () => <div>legacy-credit-meter</div>,
}));
vi.mock('../../src/components/common/SettingsDialog', () => ({ SettingsDialog: () => null }));
vi.mock('../../src/components/common/SavedToast', () => ({ SavedToast: () => null }));
vi.mock('../../src/components/common/InfoDialog', () => ({ InfoDialog: () => null }));
vi.mock('../../src/components/common/DevChatDialog', () => ({ DevChatDialog: () => null }));
vi.mock('../../src/components/common/LeaveNoteDialog', () => ({ LeaveNoteDialog: () => null }));
vi.mock('../../src/components/common/LegalDialog', () => ({ LegalDialog: () => null }));
vi.mock('../../src/components/common/ProjectNameDialog', () => ({ ProjectNameDialog: () => null }));
vi.mock('../../src/components/outputManager/OutputManagerBoot', () => ({ openOutputManager: vi.fn() }));
vi.mock('../../src/components/common/toolbar/shortcutLabels', () => ({
  getToolbarShortcutLabels: () => ({ new: '', open: '', save: '', saveAs: '' }),
}));

import { Toolbar } from '../../src/components/common/Toolbar';

describe('Firefly embedded Toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes project navigation to Firefly and suppresses legacy commercial chrome', async () => {
    const onBackToProjects = vi.fn();
    render(
      <Toolbar
        fireflyEmbedded={{
          user: { name: '九久', email: 'jiujiu@dokuai.tv' },
          onBackToProjects,
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '返回 Atlas 项目' }));
    await waitFor(() => expect(onBackToProjects).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'mock-new' }));
    await waitFor(() => expect(onBackToProjects).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'mock-open' }));

    await waitFor(() => expect(onBackToProjects).toHaveBeenCalledTimes(3));
    expect(mocks.legacyNew).not.toHaveBeenCalled();
    expect(mocks.legacyOpen).not.toHaveBeenCalled();
    expect(screen.getByText('九久')).toHaveAttribute('title', 'jiujiu@dokuai.tv');
    expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
    expect(screen.queryByText('legacy-credit-meter')).not.toBeInTheDocument();
    expect(screen.queryByText('legacy-native-helper')).not.toBeInTheDocument();
    expect(screen.getByText('original-tutorial-menu')).toBeInTheDocument();
    expect(screen.queryByText('legacy-help')).not.toBeInTheDocument();

    await waitFor(() => expect(mocks.setupAutoSync).toHaveBeenCalledOnce());
    expect(mocks.restoreLastProject).not.toHaveBeenCalled();
  });
});
