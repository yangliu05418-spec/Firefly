import { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ClippyMascot } from './ClippyMascot';
import {
  FIREFLY_SHORTCUT_ONBOARDING_PRESETS,
  type FireflyShortcutPresetId,
} from '../../../firefly/shortcutOnboarding';
import './TutorialSetupOverlay.css';

interface TutorialSetupOverlayProps {
  onCancel: () => void;
  onComplete: (presetId: FireflyShortcutPresetId) => void;
  required?: boolean;
}

export function TutorialSetupOverlay({
  onCancel,
  onComplete,
  required = false,
}: TutorialSetupOverlayProps) {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<FireflyShortcutPresetId | null>(null);
  const setUserBackground = useSettingsStore((state) => state.setUserBackground);
  const setActiveShortcutPreset = useSettingsStore((state) => state.setActiveShortcutPreset);

  const chooseBackground = useCallback((id: FireflyShortcutPresetId) => {
    const choice = FIREFLY_SHORTCUT_ONBOARDING_PRESETS.find((candidate) => candidate.id === id);
    setUserBackground(id);
    setActiveShortcutPreset(id);
    setSelectedPresetId(id);
    setSelectedLabel(choice?.label ?? id);
  }, [setActiveShortcutPreset, setUserBackground]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (required) return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel, required]);

  return (
    <div
      className="tutorial-setup-backdrop"
      onContextMenu={(event) => {
        event.preventDefault();
        if (selectedLabel) setSelectedLabel(null);
      }}
    >
      <section className="tutorial-setup-card" aria-modal="true" role="dialog">
        <div className="tutorial-setup-clippy" aria-hidden="true">
          <ClippyMascot isClosing={false} />
        </div>

        <div className="tutorial-setup-progress">
          <span>快捷键设置</span>
          <span>{selectedLabel ? '2 / 2' : '1 / 2'}</span>
        </div>

        <div className="tutorial-setup-content">
          {selectedLabel ? (
            <>
            <h1>快捷键已切换</h1>
            <p>
              当前快捷键将沿用 <strong>{selectedLabel}</strong> 的操作习惯。
              你可以随时在“偏好设置 → 快捷键”中修改。
            </p>
            <div className="tutorial-setup-confirmation">
              <span className="tutorial-setup-confirmation-mark">✓</span>
              <div>
                <strong>{selectedLabel}</strong>
                <span>快捷键方案已启用</span>
              </div>
            </div>
            </>
          ) : (
            <>
            <h1>你之前使用哪款剪辑软件？</h1>
            <p>Atlas 会自动映射你熟悉的快捷键，减少重新适应的成本。</p>
            <div className="tutorial-setup-grid">
              {FIREFLY_SHORTCUT_ONBOARDING_PRESETS.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="tutorial-setup-choice"
                  onClick={() => chooseBackground(choice.id)}
                >
                  <span
                    aria-hidden="true"
                    className={`tutorial-setup-choice-icon tutorial-setup-choice-icon--${choice.id}`}
                  >
                    {choice.monogram}
                  </span>
                  <span>{choice.label}</span>
                </button>
              ))}
            </div>
            </>
          )}
        </div>

        <footer className="tutorial-setup-footer">
          {!required && <div className="tutorial-setup-footer-exit">
            <button
              type="button"
              className="tutorial-setup-exit"
              onClick={onCancel}
            >
              暂时跳过
            </button>
            <span>按 Esc 可随时关闭</span>
          </div>}
          {selectedLabel && (
            <div className="tutorial-setup-actions">
              <button
                type="button"
                className="tutorial-setup-button tutorial-setup-button--quiet"
                onClick={() => {
                  setSelectedLabel(null);
                  setSelectedPresetId(null);
                }}
              >
                返回
              </button>
              <button
                type="button"
                className="tutorial-setup-button tutorial-setup-button--primary"
                onClick={() => {
                  if (selectedPresetId) onComplete(selectedPresetId);
                }}
              >
                开始使用
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
