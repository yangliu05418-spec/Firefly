import type { ModelStatus } from '../../../services/sam2/types';

export type MaskMode = 'paint' | 'sam2';

type MaskCreationSectionProps = {
  maskMode: MaskMode;
  setMaskMode: (mode: MaskMode) => void;
  isPainting: boolean;
  brushSize: number;
  isEraser: boolean;
  hasPaintedMask: boolean;
  sam2Status: ModelStatus;
  sam2Active: boolean;
  sam2Processing: boolean;
  sam2PointCount: number;
  hasLiveMask: boolean;
  maskOpacity: number;
  sam2DownloadProgress: number;
  onPaintToggle: () => void;
  onClearPaint: () => void;
  onBrushSizeChange: (value: number) => void;
  onEraserChange: (enabled: boolean) => void;
  onSam2Toggle: () => void;
  onSam2AutoDetect: () => void;
  onSam2Download: () => void;
  onClearMask: () => void;
  onMaskOpacityChange: (value: number) => void;
};

export function MaskCreationSection({
  maskMode,
  setMaskMode,
  isPainting,
  brushSize,
  isEraser,
  hasPaintedMask,
  sam2Status,
  sam2Active,
  sam2Processing,
  sam2PointCount,
  hasLiveMask,
  maskOpacity,
  sam2DownloadProgress,
  onPaintToggle,
  onClearPaint,
  onBrushSizeChange,
  onEraserChange,
  onSam2Toggle,
  onSam2AutoDetect,
  onSam2Download,
  onClearMask,
  onMaskOpacityChange,
}: MaskCreationSectionProps) {
  return (
    <div className="sam2-section">
      <div className="sam2-section-title">Step 1: Create Mask</div>

      <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
        <button
          className={`sam2-btn ${maskMode === 'paint' ? 'active' : ''}`}
          onClick={() => setMaskMode('paint')}
          style={{ flex: 1, fontSize: 11 }}
        >
          Paint (no download)
        </button>
        <button
          className={`sam2-btn ${maskMode === 'sam2' ? 'active' : ''}`}
          onClick={() => setMaskMode('sam2')}
          style={{ flex: 1, fontSize: 11 }}
        >
          SAM2 (auto)
        </button>
      </div>

      {maskMode === 'paint' ? (
        <>
          <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            Paint roughly over the subject. MatAnyone2 will refine the edges.
          </p>

          <div className="sam2-actions">
            <button
              className={`sam2-btn ${isPainting ? 'active' : ''}`}
              onClick={onPaintToggle}
              style={{ flex: 1 }}
            >
              {isPainting ? 'Stop Painting' : 'Start Painting'}
            </button>
            {hasPaintedMask && (
              <button className="sam2-btn danger" onClick={onClearPaint} style={{ flex: 'none' }}>
                Clear
              </button>
            )}
          </div>

          {isPainting && (
            <div style={{ marginTop: 6 }}>
              <div className="sam2-slider-row">
                <span className="sam2-slider-label">Brush</span>
                <input
                  type="range"
                  min={5}
                  max={150}
                  step={1}
                  value={brushSize}
                  onChange={e => onBrushSizeChange(parseInt(e.target.value))}
                />
                <span className="sam2-slider-value">{brushSize}px</span>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', marginTop: 4, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={isEraser}
                  onChange={e => onEraserChange(e.target.checked)}
                />
                Eraser mode
              </label>
            </div>
          )}

          {hasPaintedMask && !isPainting && (
            <span style={{ fontSize: 11, color: 'var(--success)', marginTop: 4, display: 'block' }}>
              Mask ready
            </span>
          )}
        </>
      ) : (
        <>
          {sam2Status === 'ready' ? (
            <>
              <div className="sam2-actions">
                <button
                  className={`sam2-btn ${sam2Active ? 'active' : ''}`}
                  onClick={onSam2Toggle}
                >
                  {sam2Active ? 'Active' : 'Activate'}
                </button>
                <button
                  className="sam2-btn primary"
                  onClick={onSam2AutoDetect}
                  disabled={sam2Processing}
                >
                  {sam2Processing ? '...' : 'Auto-Detect'}
                </button>
              </div>

              {sam2PointCount > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {sam2PointCount} point{sam2PointCount !== 1 ? 's' : ''}
                  </span>
                  <button className="sam2-btn danger" onClick={onClearMask} style={{ flex: 'none', padding: '2px 8px', fontSize: 11 }}>
                    Clear
                  </button>
                </div>
              )}

              {hasLiveMask && (
                <div className="sam2-slider-row" style={{ marginTop: 4 }}>
                  <span className="sam2-slider-label">Opacity</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={maskOpacity}
                    onChange={e => onMaskOpacityChange(parseFloat(e.target.value))}
                  />
                  <span className="sam2-slider-value">{Math.round(maskOpacity * 100)}%</span>
                </div>
              )}
            </>
          ) : sam2Status === 'downloading' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="sam2-progress-bar">
                <div className="sam2-progress-fill" style={{ width: `${sam2DownloadProgress}%` }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Downloading SAM2... {Math.round(sam2DownloadProgress)}%
              </span>
            </div>
          ) : (
            <>
              <p style={{ margin: '0 0 6px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                Click to place points on the subject. More precise than paint but requires model download.
              </p>
              <button className="sam2-btn" onClick={onSam2Download} style={{ fontSize: 11 }}>
                Download SAM2 Model (~103 MB)
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
