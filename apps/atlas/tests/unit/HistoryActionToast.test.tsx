import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryActionToast } from '../../src/components/common/HistoryActionToast';

describe('HistoryActionToast', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the operation and action label', () => {
    render(
      <HistoryActionToast
        notice={{ id: 1, operation: 'undo', label: 'Add clip' }}
        onDone={vi.fn()}
      />
    );

    expect(screen.getByText('Undone')).toBeTruthy();
    expect(screen.getByText('Add clip')).toBeTruthy();
  });

  it('hides itself after the fade window', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();

    render(
      <HistoryActionToast
        notice={{ id: 2, operation: 'redo', label: 'Move clip' }}
        onDone={onDone}
      />
    );

    vi.advanceTimersByTime(1499);
    expect(onDone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledWith(2);
  });
});
