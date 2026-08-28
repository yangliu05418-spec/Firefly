import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FileMenu } from '../../src/components/common/toolbar/FileMenu';

const baseProps = {
  autosaveEnabled: true,
  autosaveInterval: 2 as const,
  hasUnsavedChanges: () => false,
  isLoading: false,
  isProjectOpen: true,
  onClearRecentProjects: vi.fn(),
  onMenuClick: vi.fn(),
  onMenuHover: vi.fn(),
  onNew: vi.fn(),
  onOpen: vi.fn(),
  onOpenRecent: vi.fn(),
  onSave: vi.fn(),
  onSaveAs: vi.fn(),
  openMenu: 'file' as const,
  recentProjects: [{
    id: 'legacy-project',
    name: 'Legacy Project',
    backend: 'fsa' as const,
    lastOpenedAt: Date.now(),
  }],
  setAutosaveEnabled: vi.fn(),
  setAutosaveInterval: vi.fn(),
  shortcutLabels: { new: '', open: '', save: '', saveAs: '' },
};

describe('Firefly embedded File menu boundary', () => {
  it('keeps original save and autosave but removes legacy storage and destructive cache actions', () => {
    render(<FileMenu {...baseProps} fireflyEmbedded />);

    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
    expect(screen.getByText('自动保存')).toBeInTheDocument();
    expect(screen.queryByText('Open Recent')).not.toBeInTheDocument();
    expect(screen.queryByText('Save As...')).not.toBeInTheDocument();
    expect(screen.queryByText('Clear All Cache & Reload')).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy Project')).not.toBeInTheDocument();
  });

  it('maps project creation and opening to the supplied Firefly navigation actions', () => {
    const onNew = vi.fn();
    const onOpen = vi.fn();
    render(<FileMenu {...baseProps} fireflyEmbedded onNew={onNew} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole('button', { name: '返回项目列表…' }));
    fireEvent.click(screen.getByRole('button', { name: '打开其他项目…' }));
    expect(onNew).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
