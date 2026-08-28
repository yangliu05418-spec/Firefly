import { useCallback, useEffect, useRef, useState } from 'react';
import { canExport, inspectExportCapabilities, type ExportCapability } from '../capabilities';
import { AtlasExporter, type ExportProgress } from '../exporter';
import type { AtlasAsset, AtlasDocument } from '../model';
import { useI18n, type MessageKey } from '../i18n';
import { Icon } from './Icon';
import { Modal } from './Modal';

const capabilityLabels: Record<ExportCapability['id'], MessageKey> = {
  webcodecs: 'export.webCodecs', h264: 'export.h264', audio: 'export.audio', isolation: 'export.isolation', storage: 'export.storage',
};
const phaseLabels: Record<ExportProgress['phase'], MessageKey> = {
  preparing: 'export.preparing', encoding: 'export.encoding', uploading: 'export.uploading', finalizing: 'export.finalizing', completed: 'export.completed',
};

export function ExportPanel({ open, document, userId, onClose, onComplete, onFailed }: {
  open: boolean;
  document: AtlasDocument;
  userId: string;
  onClose: () => void;
  onComplete: (asset: AtlasAsset) => void | Promise<void>;
  onFailed?: (reason: 'EXPORT_FAILED' | 'EXPORT_CANCELLED') => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [capabilities, setCapabilities] = useState<ExportCapability[]>([]);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exporterRef = useRef<AtlasExporter | null>(null);
  const settledRef = useRef(false);

  const inspect = useCallback(async () => {
    setChecking(true);
    try { setCapabilities(await inspectExportCapabilities()); } finally { setChecking(false); }
  }, []);

  useEffect(() => { if (open) { settledRef.current = false; void inspect(); } }, [inspect, open]);
  useEffect(() => () => exporterRef.current?.cancel(), []);

  const start = async () => {
    if (!canExport(capabilities)) return;
    setError(null);
    const exporter = new AtlasExporter(document.projectId, userId, setProgress);
    exporterRef.current = exporter;
    let asset: AtlasAsset;
    try {
      asset = await exporter.start(document, 1920, 1080, 30);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('export.failed'));
      if (!settledRef.current) {
        settledRef.current = true;
        await onFailed?.('EXPORT_FAILED');
      }
      exporterRef.current = null;
      return;
    }
    // Encoding, multipart completion and TOS registration have succeeded. A
    // later UI/Agent receipt sync failure must never emit a contradictory
    // EXPORT_FAILED result for this same immutable export operation.
    settledRef.current = true;
    exporterRef.current = null;
    try {
      await onComplete(asset);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('agent.failed'));
    }
  };

  const close = () => {
    if (progress && progress.phase !== 'completed') exporterRef.current?.cancel();
    if (!settledRef.current && onFailed) {
      settledRef.current = true;
      void onFailed('EXPORT_CANCELLED');
    }
    onClose();
  };

  const cancel = () => {
    exporterRef.current?.cancel();
    setProgress(null);
    if (!settledRef.current && onFailed) {
      settledRef.current = true;
      void onFailed('EXPORT_CANCELLED');
    }
  };

  if (!open) return null;
  const ready = canExport(capabilities);
  return (
    <Modal title={t('export.title')} onClose={close} actions={!progress || progress.phase === 'completed' ? <><button className="atlas-button atlas-button--quiet" type="button" onClick={close}>{t('app.close')}</button><button className="atlas-button atlas-button--primary" type="button" disabled={!ready || checking || Boolean(progress)} onClick={() => void start()}><Icon name="export" />{t('export.start')}</button></> : <button className="atlas-button atlas-button--danger" type="button" onClick={cancel}>{t('export.cancel')}</button>}>
      <p className="atlas-modal-note">{t('export.subtitle')}</p>
      <div className="atlas-export-settings"><span><small>{t('export.format')}</small><strong>MP4 · H.264 / AAC</strong></span><span><small>{t('export.resolution')}</small><strong>1920 × 1080</strong></span><span><small>{t('export.frameRate')}</small><strong>30 fps</strong></span></div>
      <section className="atlas-preflight">
        <header><h3>{t('export.preflight')}</h3><button className="atlas-button atlas-button--quiet" type="button" disabled={checking || Boolean(progress)} onClick={() => void inspect()}><Icon name="refresh" />{t('export.refresh')}</button></header>
        <ul>{capabilities.map((capability) => <li key={capability.id}><span>{t(capabilityLabels[capability.id])}{capability.detail && <small>{capability.detail}</small>}</span><strong className={capability.supported === true ? 'is-ready' : capability.supported === false ? 'is-blocked' : ''}>{capability.supported === true ? <><Icon name="check" />{t('export.supported')}</> : capability.supported === false ? <><Icon name="warning" />{t('export.unsupported')}</> : t('export.unknown')}</strong></li>)}</ul>
      </section>
      {progress ? <div className="atlas-export-progress" role="status"><div><strong>{t(phaseLabels[progress.phase])}</strong><span>{progress.progress}%</span></div><progress max="100" value={progress.progress} /></div> : <div className={`atlas-export-readiness ${ready ? 'is-ready' : ''}`}><Icon name={ready ? 'check' : 'warning'} /><span><strong>{ready ? t('export.ready') : t('export.blocked')}</strong>{!ready && <small>{t('export.notReadyBody')}</small>}</span></div>}
      {error && <div className="atlas-inline-alert atlas-inline-alert--error" role="alert"><Icon name="warning" /><span><strong>{t('export.failed')}</strong><small>{error}</small></span></div>}
    </Modal>
  );
}
