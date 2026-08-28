import type { VectorAnimationClipSettings } from '../../../../types/vectorAnimation';
import { cleanBackgroundColor } from './lottieMappings';
import type { LottieSettingsUpdater } from './lottieTabTypes';

interface LottieBackgroundSectionProps {
  settings: VectorAnimationClipSettings;
  updateSettings: LottieSettingsUpdater;
}

export function LottieBackgroundSection({
  settings,
  updateSettings,
}: LottieBackgroundSectionProps) {
  return (
    <div className="properties-section lottie-controls-section">
      <label className="lottie-field-row">
        <span className="lottie-field-label">Background</span>
        <div className="lottie-color-row">
          <span className="lottie-color-swatch">
            <input
              type="color"
              value={settings.backgroundColor ?? '#000000'}
              onChange={(event) => updateSettings({ backgroundColor: event.target.value })}
              aria-label="Background color"
            />
          </span>
          <input
            className="lottie-input"
            type="text"
            value={settings.backgroundColor ?? ''}
            onChange={(event) => updateSettings({ backgroundColor: cleanBackgroundColor(event.target.value) })}
            placeholder="transparent"
          />
        </div>
      </label>
    </div>
  );
}
