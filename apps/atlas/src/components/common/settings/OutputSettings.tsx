import { useSettingsStore } from '../../../stores/settingsStore';
import { useMediaStore } from '../../../stores/mediaStore';

interface OutputSettingsProps {
  embedded?: boolean;
}

const FRAME_RATE_OPTIONS = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60];

function formatFrameRate(frameRate: number): string {
  return Number.isInteger(frameRate)
    ? String(frameRate)
    : frameRate.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

export function OutputSettings({ embedded }: OutputSettingsProps) {
  const { outputResolution, fps: legacyFps, setResolution } = useSettingsStore();
  const { activeCompositionId, compositions, updateComposition } = useMediaStore();
  const activeComposition = compositions?.find((composition) => composition.id === activeCompositionId);
  const currentFrameRate = activeComposition?.frameRate ?? legacyFps;
  const currentFrameRateLabel = Number.isFinite(currentFrameRate)
    ? formatFrameRate(currentFrameRate)
    : 'n/a';
  const frameRateOptions = FRAME_RATE_OPTIONS.includes(currentFrameRate)
    ? FRAME_RATE_OPTIONS
    : [...FRAME_RATE_OPTIONS, currentFrameRate].toSorted((a, b) => a - b);

  const handleFrameRateChange = (value: string) => {
    if (!activeComposition) return;
    const frameRate = Number(value);
    if (!Number.isFinite(frameRate) || frameRate <= 0) return;
    updateComposition(activeComposition.id, { frameRate });
  };

  const content = (
    <>
      <div className="settings-group">
        <div className="settings-group-title">{embedded ? 'Output — Default Resolution' : 'Default Resolution (New Compositions)'}</div>
        <p className="settings-hint">
          Applies only to newly created compositions. Active composition resolution is set per composition in the Media Panel.
        </p>

        <label className="settings-row">
          <span className="settings-label">Width</span>
          <input
            type="number"
            value={outputResolution.width}
            onChange={(e) => setResolution(Number(e.target.value), outputResolution.height)}
            className="settings-input settings-input-number"
            min={1}
            max={7680}
          />
        </label>

        <label className="settings-row">
          <span className="settings-label">Height</span>
          <input
            type="number"
            value={outputResolution.height}
            onChange={(e) => setResolution(outputResolution.width, Number(e.target.value))}
            className="settings-input settings-input-number"
            min={1}
            max={4320}
          />
        </label>

        <div className="preset-buttons">
          <button className="preset-btn" onClick={() => setResolution(1920, 1080)}>1080p</button>
          <button className="preset-btn" onClick={() => setResolution(2560, 1440)}>1440p</button>
          <button className="preset-btn" onClick={() => setResolution(3840, 2160)}>4K</button>
          <button className="preset-btn" onClick={() => setResolution(1080, 1920)}>9:16</button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Frame Rate</div>
        <p className="settings-hint">
          Current: {currentFrameRateLabel} FPS (active composition)
        </p>
        <label className="settings-row">
          <span className="settings-label">Active Composition FPS</span>
          <select
            value={currentFrameRate}
            onChange={(e) => handleFrameRateChange(e.target.value)}
            className="settings-input"
            disabled={!activeComposition}
          >
            {frameRateOptions.map((frameRate) => (
              <option key={frameRate} value={frameRate}>
                {formatFrameRate(frameRate)} fps
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );

  if (embedded) return content;

  return (
    <div className="settings-category-content">
      <h2>Output</h2>
      {content}
    </div>
  );
}
