// MatAnyoneSetupDialog - Multi-step setup wizard for MatAnyone2 AI Video Matting
// Guides the user through installation of Python env, dependencies, and model weights.

import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { useMatAnyoneStore } from '../../stores/matanyoneStore';
import { getMatAnyoneService } from '../../services/matanyone/MatAnyoneService';
import { CompleteStep } from './matAnyoneSetup/CompleteStep';
import { ErrorStep } from './matAnyoneSetup/ErrorStep';
import { ModelNeededStep } from './matAnyoneSetup/ModelNeededStep';
import { ProgressStep } from './matAnyoneSetup/ProgressStep';
import { styles } from './matAnyoneSetup/styles';
import { useMatAnyoneSetupStatusPolling } from './matAnyoneSetup/useMatAnyoneSetupStatusPolling';
import { WelcomeStep } from './matAnyoneSetup/WelcomeStep';
import { getMatAnyoneSetupView, isMatAnyoneSetupBusy } from './matAnyoneSetup/viewMapping';

interface MatAnyoneSetupDialogProps {
  onClose: () => void;
}

export function MatAnyoneSetupDialog({ onClose }: MatAnyoneSetupDialogProps) {
  const [isClosing, setIsClosing] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const {
    setupStatus,
    setupProgress,
    setupStep,
    setupLog,
    errorMessage,
    pythonVersion,
    cudaAvailable,
    cudaVersion,
    gpuName,
    vramMb,
    modelDownloaded,
  } = useMatAnyoneStore();

  useMatAnyoneSetupStatusPolling(setupLog, logEndRef);

  const isInstalling = isMatAnyoneSetupBusy(setupStatus);

  const handleClose = useCallback(() => {
    if (isClosing || isInstalling) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 120);
  }, [onClose, isClosing, isInstalling]);

  useMatAnyoneEscapeClose(handleClose);

  const handleBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleInstall = useCallback(async () => {
    const service = getMatAnyoneService();
    await service.setup();
    const currentStatus = useMatAnyoneStore.getState().setupStatus;
    if (currentStatus === 'model-needed') {
      await service.downloadModel();
    }
  }, []);

  const handleRetry = useCallback(async () => {
    useMatAnyoneStore.getState().setError(null);
    useMatAnyoneStore.getState().setSetupStatus('not-installed');
    const service = getMatAnyoneService();
    await service.setup();
    const currentStatus = useMatAnyoneStore.getState().setupStatus;
    if (currentStatus === 'model-needed') {
      await service.downloadModel();
    }
  }, []);

  const handleDownloadModel = useCallback(async () => {
    await getMatAnyoneService().downloadModel();
  }, []);

  const renderContent = () => {
    const view = getMatAnyoneSetupView(setupStatus);

    switch (view) {
      case 'welcome':
        return (
          <WelcomeStep
            setupStatus={setupStatus}
            cudaAvailable={cudaAvailable}
            cudaVersion={cudaVersion}
            gpuName={gpuName}
            vramMb={vramMb}
            onClose={handleClose}
            onInstall={handleInstall}
          />
        );
      case 'installing':
        return (
          <ProgressStep
            kind="install"
            setupProgress={setupProgress}
            setupStep={setupStep}
            setupLog={setupLog}
            logEndRef={logEndRef}
          />
        );
      case 'model-needed':
        return (
          <ModelNeededStep
            onClose={handleClose}
            onDownloadModel={handleDownloadModel}
          />
        );
      case 'downloading-model':
        return (
          <ProgressStep
            kind="model"
            setupProgress={setupProgress}
            setupStep={setupStep}
            setupLog={setupLog}
            logEndRef={logEndRef}
          />
        );
      case 'complete':
        return (
          <CompleteStep
            pythonVersion={pythonVersion}
            cudaAvailable={cudaAvailable}
            cudaVersion={cudaVersion}
            gpuName={gpuName}
            vramMb={vramMb}
            modelDownloaded={modelDownloaded}
            onClose={handleClose}
          />
        );
      case 'error':
        return (
          <ErrorStep
            setupLog={setupLog}
            errorMessage={errorMessage}
            onClose={handleClose}
            onRetry={handleRetry}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div
      style={{
        ...styles.backdrop,
        ...(isClosing ? styles.backdropClosing : {}),
      }}
      onClick={handleBackdropClick}
    >
      <div
        style={{
          ...styles.dialog,
          ...(isClosing ? styles.dialogClosing : {}),
        }}
      >
        <div style={styles.header}>
          <h2 style={styles.headerTitle}>AI Video Matting</h2>
          <p style={styles.headerSubtitle}>Powered by MatAnyone2</p>
        </div>

        {renderContent()}
      </div>
    </div>
  );
}

function useMatAnyoneEscapeClose(handleClose: () => void) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);
}
