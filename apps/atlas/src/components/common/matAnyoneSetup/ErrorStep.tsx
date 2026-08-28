import { styles } from './styles';

type ErrorStepProps = {
  setupLog: string[];
  errorMessage: string | null;
  onClose: () => void;
  onRetry: () => void;
};

export function ErrorStep({ setupLog, errorMessage, onClose, onRetry }: ErrorStepProps) {
  const recentLogs = setupLog.slice(-10);

  return (
    <>
      <div style={styles.body}>
        <div style={styles.errorBox}>
          <p style={styles.errorTitle}>Setup failed</p>
          {errorMessage && <p style={styles.errorMessage}>{errorMessage}</p>}
        </div>

        {recentLogs.length > 0 && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.4)', marginBottom: 6 }}>
              Recent log output
            </div>
            <div style={styles.logArea}>
              {recentLogs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={styles.footer}>
        <button
          style={styles.btnSecondary}
          onClick={onClose}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
        >
          Close
        </button>
        <button
          style={styles.btnDanger}
          onClick={onRetry}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.18)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
        >
          Retry
        </button>
      </div>
    </>
  );
}
