import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialSetupOverlay } from '../../src/components/common/tutorial/TutorialSetupOverlay';
import { useSettingsStore } from '../../src/stores/settingsStore';

describe('TutorialSetupOverlay', () => {
  const setUserBackground = vi.fn();
  const setActiveShortcutPreset = vi.fn();

  beforeEach(() => {
    vi.mocked(useSettingsStore).mockImplementation(((selector: (state: unknown) => unknown) => (
      selector({ setActiveShortcutPreset, setUserBackground })
    )) as typeof useSettingsStore);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('switches the shortcut preset and continues into the walkthrough', () => {
    const onComplete = vi.fn();
    render(<TutorialSetupOverlay onCancel={vi.fn()} onComplete={onComplete} />);

    expect(screen.getByText('你之前使用哪款剪辑软件？')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'DaVinci Resolve' }));

    expect(setUserBackground).toHaveBeenCalledWith('davinci');
    expect(setActiveShortcutPreset).toHaveBeenCalledWith('davinci');
    expect(screen.getByText('快捷键已切换')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    expect(onComplete).toHaveBeenCalledWith('davinci');
  });

  it('can be ended from every setup state', () => {
    const onCancel = vi.fn();
    render(<TutorialSetupOverlay onCancel={onCancel} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '暂时跳过' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('requires a professional preset in Firefly onboarding mode', () => {
    const onCancel = vi.fn();
    render(<TutorialSetupOverlay required onCancel={onCancel} onComplete={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '暂时跳过' })).toBeNull();
    expect(screen.queryByRole('button', { name: /第一次使用/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(4);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
