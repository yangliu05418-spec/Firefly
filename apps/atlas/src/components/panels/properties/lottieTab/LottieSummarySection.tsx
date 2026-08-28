import type { VectorAnimationClipSettings, VectorAnimationMetadata } from '../../../../types/vectorAnimation';
import type { LottieSettingsUpdater } from './lottieTabTypes';

interface LottieSummarySectionProps {
  clipName: string;
  metadata: VectorAnimationMetadata | undefined;
  providerName: string;
  settings: VectorAnimationClipSettings;
  updateSettings: LottieSettingsUpdater;
}

export function LottieSummarySection({
  clipName,
  metadata,
  providerName,
  settings,
  updateSettings,
}: LottieSummarySectionProps) {
  return (
    <div className="properties-section lottie-summary-section">
      <div className="lottie-summary">
        <div className="lottie-summary-text">
          <div className="lottie-title" title={clipName}>{clipName}</div>
          <div className="lottie-meta">
            {metadata?.width && metadata?.height ? `${metadata.width} x ${metadata.height}` : `${providerName} canvas animation`}
            {metadata?.fps ? ` - ${metadata.fps.toFixed(2)} fps` : ''}
          </div>
        </div>
        <label className="lottie-loop-toggle">
          <input
            type="checkbox"
            checked={settings.loop}
            onChange={(event) => updateSettings({ loop: event.target.checked })}
          />
          <span>Loop</span>
        </label>
      </div>
    </div>
  );
}
