import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { OutputSettings } from '../../src/components/common/settings/OutputSettings';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedUseMediaStore = useMediaStore as unknown as Mock;
const mockedUseSettingsStore = useSettingsStore as unknown as Mock;

function mockSettingsStore(fps: number) {
  mockedUseSettingsStore.mockImplementation(() => ({
    outputResolution: { width: 1920, height: 1080 },
    fps,
    setResolution: vi.fn(),
  }));
}

function mockMediaStore(frameRate: number | null, updateComposition = vi.fn()) {
  mockedUseMediaStore.mockImplementation(() => ({
    activeCompositionId: frameRate === null ? null : 'comp-active',
    compositions: frameRate === null
      ? []
      : [{ id: 'comp-active', frameRate }],
    updateComposition,
  }));
  return updateComposition;
}

describe('OutputSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the active composition frame rate instead of the stale global fps setting', () => {
    mockSettingsStore(20);
    mockMediaStore(24);

    render(<OutputSettings embedded />);

    expect(screen.getByText('Current: 24 FPS (active composition)')).toBeInTheDocument();
    expect(screen.queryByText('Current: 20 FPS (active composition)')).not.toBeInTheDocument();
  });

  it('falls back to the legacy settings fps when no composition is active', () => {
    mockSettingsStore(20);
    mockMediaStore(null);

    render(<OutputSettings embedded />);

    expect(screen.getByText('Current: 20 FPS (active composition)')).toBeInTheDocument();
  });

  it('updates the active composition frame rate from the output settings control', () => {
    mockSettingsStore(20);
    const updateComposition = mockMediaStore(30);

    render(<OutputSettings embedded />);

    fireEvent.change(screen.getByLabelText('Active Composition FPS'), {
      target: { value: '60' },
    });

    expect(updateComposition).toHaveBeenCalledWith('comp-active', { frameRate: 60 });
  });
});
