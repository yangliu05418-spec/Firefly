import { useEffect } from 'react';
import type { HistoryFeedbackNotice } from '../../hooks/useGlobalHistory';
import './HistoryActionToast.css';

const HISTORY_TOAST_DURATION_MS = 1500;

interface HistoryActionToastProps {
  notice: HistoryFeedbackNotice | null;
  onDone: (id?: number) => void;
}

function formatHistoryLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : 'History change';
}

export function HistoryActionToast({ notice, onDone }: HistoryActionToastProps) {
  useEffect(() => {
    if (!notice) return;

    const timer = window.setTimeout(() => {
      onDone(notice.id);
    }, HISTORY_TOAST_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, [notice, onDone]);

  if (!notice) {
    return null;
  }

  const operationLabel = notice.operation === 'undo' ? 'Undone' : 'Redone';

  return (
    <div key={notice.id} className="history-action-toast" role="status" aria-live="polite">
      <span className="history-action-toast-operation">{operationLabel}</span>
      <span className="history-action-toast-label">{formatHistoryLabel(notice.label)}</span>
    </div>
  );
}
