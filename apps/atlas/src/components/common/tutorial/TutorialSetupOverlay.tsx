import { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ClippyMascot } from './ClippyMascot';
import './TutorialSetupOverlay.css';

const BACKGROUND_CHOICES = [
  { id: 'premiere', label: 'Premiere Pro', logo: '/logo-premiere.svg' },
  { id: 'davinci', label: 'DaVinci Resolve', logo: '/logo-davinci.svg' },
  { id: 'finalcut', label: 'Final Cut Pro', logo: '/logo-finalcut.png' },
  { id: 'aftereffects', label: 'After Effects', logo: '/logo-aftereffects.svg' },
  { id: 'beginner', label: '第一次使用剪辑软件', logo: null },
] as const;

type BackgroundId = typeof BACKGROUND_CHOICES[number]['id'];

interface TutorialSetupOverlayProps {
  onCancel: () => void;
  onComplete: () => void;
}

export function TutorialSetupOverlay({
  onCancel,
  onComplete,
}: TutorialSetupOverlayProps) {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const setUserBackground = useSettingsStore((state) => state.setUserBackground);
  const setActiveShortcutPreset = useSettingsStore((state) => state.setActiveShortcutPreset);

  const chooseBackground = useCallback((id: BackgroundId) => {
    const choice = BACKGROUND_CHOICES.find((candidate) => candidate.id === id);
    setUserBackground(id);
    setActiveShortcutPreset(id);
    setSelectedLabel(choice?.label ?? id);
  }, [setActiveShortcutPreset, setUserBackground]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel]);

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
              {BACKGROUND_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="tutorial-setup-choice"
                  onClick={() => chooseBackground(choice.id)}
                >
                  <span className="tutorial-setup-choice-icon">
                    {choice.logo ? (
                      <img src={choice.logo} alt="" draggable={false} />
                    ) : (
                      <span className="tutorial-setup-beginner">★</span>
                    )}
                  </span>
                  <span>{choice.label}</span>
                </button>
              ))}
            </div>
            </>
          )}
        </div>

        <footer className="tutorial-setup-footer">
          <div className="tutorial-setup-footer-exit">
            <button
              type="button"
              className="tutorial-setup-exit"
              onClick={onCancel}
            >
              暂时跳过
            </button>
            <span>按 Esc 可随时关闭</span>
          </div>
          {selectedLabel && (
            <div className="tutorial-setup-actions">
              <button
                type="button"
                className="tutorial-setup-button tutorial-setup-button--quiet"
                onClick={() => setSelectedLabel(null)}
              >
                返回
              </button>
              <button
                type="button"
                className="tutorial-setup-button tutorial-setup-button--primary"
                onClick={onComplete}
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
