// Preview bottom-left controls: transparency grid toggle + quality selector

import React from 'react';
import type { PreviewQuality } from '../../stores/settingsStore';
import { originalUi } from '../../firefly/i18n/originalUi';

interface PreviewBottomControlsProps {
  showTransparencyGrid: boolean;
  onToggleTransparency: () => void;
  previewQuality: PreviewQuality;
  setPreviewQuality: (q: PreviewQuality) => void;
  qualityOpen: boolean;
  setQualityOpen: (v: boolean) => void;
  qualityDropdownRef: React.RefObject<HTMLDivElement | null>;
}

export function PreviewBottomControls({
  showTransparencyGrid,
  onToggleTransparency,
  previewQuality,
  setPreviewQuality,
  qualityOpen,
  setQualityOpen,
  qualityDropdownRef,
}: PreviewBottomControlsProps) {
  return (
    <div className="preview-controls-bottom">
      <button
        className={`preview-transparency-toggle ${showTransparencyGrid ? 'active' : ''}`}
        onClick={onToggleTransparency}
        title={originalUi('original.previewTransparency', 'Toggle transparency grid (checkerboard)')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="0" y="0" width="4" height="4" opacity="0.6" />
          <rect x="8" y="0" width="4" height="4" opacity="0.6" />
          <rect x="4" y="4" width="4" height="4" opacity="0.6" />
          <rect x="12" y="4" width="4" height="4" opacity="0.6" />
          <rect x="0" y="8" width="4" height="4" opacity="0.6" />
          <rect x="8" y="8" width="4" height="4" opacity="0.6" />
          <rect x="4" y="12" width="4" height="4" opacity="0.6" />
          <rect x="12" y="12" width="4" height="4" opacity="0.6" />
        </svg>
      </button>

      <div className="preview-quality-dropdown-wrapper" ref={qualityDropdownRef}>
        <button
          className="preview-quality-dropdown-btn"
          onClick={() => setQualityOpen(!qualityOpen)}
          title={originalUi('original.previewQuality', 'Preview quality (affects performance)')}
        >
          <span className="preview-quality-label">
            {previewQuality === 1
              ? originalUi('original.previewFull', 'Full')
              : previewQuality === 0.5
                ? originalUi('original.previewHalf', 'Half')
                : originalUi('original.previewQuarter', 'Quarter')}
          </span>
          <span className="preview-comp-arrow">▼</span>
        </button>
        {qualityOpen && (
          <div className="preview-quality-dropdown">
            {([
              { value: 1 as PreviewQuality, label: originalUi('original.previewFull', 'Full'), desc: '100%' },
              { value: 0.5 as PreviewQuality, label: originalUi('original.previewHalf', 'Half'), desc: '50%' },
              { value: 0.25 as PreviewQuality, label: originalUi('original.previewQuarter', 'Quarter'), desc: '25%' },
            ]).map(({ value, label, desc }) => (
              <button
                key={value}
                className={`preview-quality-option ${previewQuality === value ? 'active' : ''}`}
                onClick={() => {
                  setPreviewQuality(value);
                  setQualityOpen(false);
                }}
              >
                {label} <span className="preview-quality-desc">{desc}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
