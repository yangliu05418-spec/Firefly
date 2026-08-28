import type { RefObject } from 'react';
import { SpinnerIcon } from './icons';
import { styles } from './styles';

type ProgressStepProps = {
  kind: 'install' | 'model';
  setupProgress: number;
  setupStep: string | null;
  setupLog: string[];
  logEndRef: RefObject<HTMLDivElement | null>;
};

export function ProgressStep({
  kind,
  setupProgress,
  setupStep,
  setupLog,
  logEndRef,
}: ProgressStepProps) {
  const fallbackStep = kind === 'install'
    ? 'Setting up environment...'
    : 'Downloading model weights...';

  return (
    <>
      <div style={styles.body}>
        <div style={styles.progressSection}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SpinnerIcon />
            <span style={styles.stepLabel}>{setupStep || fallbackStep}</span>
          </div>

          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${Math.max(setupProgress, 2)}%` }} />
          </div>
          {kind === 'model' ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={styles.modelInfo}>~141 MB from HuggingFace</span>
              <span style={styles.progressText}>{Math.round(setupProgress)}%</span>
            </div>
          ) : (
            <div style={styles.progressText}>{Math.round(setupProgress)}%</div>
          )}
        </div>

        {setupLog.length > 0 && (
          <div style={styles.logArea}>
            {setupLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.btnSecondary, opacity: 0.5, cursor: 'not-allowed' }}
          disabled
        >
          Cancel
        </button>
      </div>
    </>
  );
}
