import { SuccessBigIcon } from './icons';
import { styles } from './styles';
import { formatGpuMemory } from './viewMapping';

type CompleteStepProps = {
  pythonVersion: string | null;
  cudaAvailable: boolean;
  cudaVersion: string | null;
  gpuName: string | null;
  vramMb: number | null;
  modelDownloaded: boolean;
  onClose: () => void;
};

export function CompleteStep({
  pythonVersion,
  cudaAvailable,
  cudaVersion,
  gpuName,
  vramMb,
  modelDownloaded,
  onClose,
}: CompleteStepProps) {
  return (
    <>
      <div style={styles.body}>
        <div style={styles.successCenter}>
          <SuccessBigIcon />
          <p style={styles.successTitle}>Setup complete! MatAnyone2 is ready.</p>

          <div style={styles.infoGrid}>
            {pythonVersion && (
              <>
                <span style={styles.infoLabel}>Python</span>
                <span style={styles.infoValue}>{pythonVersion}</span>
              </>
            )}
            {cudaAvailable && cudaVersion && (
              <>
                <span style={styles.infoLabel}>CUDA</span>
                <span style={styles.infoValue}>{cudaVersion}</span>
              </>
            )}
            {gpuName && (
              <>
                <span style={styles.infoLabel}>GPU</span>
                <span style={styles.infoValue}>
                  {gpuName}
                  {formatGpuMemory(vramMb)}
                </span>
              </>
            )}
            {modelDownloaded && (
              <>
                <span style={styles.infoLabel}>Model</span>
                <span style={styles.infoValue}>MatAnyone2</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div style={styles.footer}>
        <button
          style={{ ...styles.btnPrimary, padding: '10px 28px' }}
          onClick={onClose}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 1)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(99, 102, 241, 0.9)'; }}
        >
          Close
        </button>
      </div>
    </>
  );
}
