import { useSettingsStore, type ThemeMode } from '../../../stores/settingsStore';
import {
  MAX_INTERFACE_TEXT_SCALE,
  MIN_INTERFACE_TEXT_SCALE,
  useUiSettingsStore,
  type InterfaceFontFamily,
} from '../../../stores/uiSettingsStore';

const themeOptions: { id: ThemeMode; label: string; bg: string; bar: string; accent: string }[] = [
  { id: 'dark',     label: 'Dark',     bg: '#1e1e1e', bar: '#0f0f0f', accent: '#2D8CEB' },
  { id: 'light',    label: 'Light',    bg: '#f5f5f5', bar: '#dedede', accent: '#1a73e8' },
  { id: 'midnight', label: 'Midnight', bg: '#000000', bar: '#111111', accent: '#3d9df5' },
  { id: 'system',   label: 'System',   bg: 'linear-gradient(135deg, #1e1e1e 50%, #f5f5f5 50%)', bar: '#333', accent: '#2D8CEB' },
  { id: 'crazy',    label: 'Crazy You', bg: 'linear-gradient(135deg, #e91e63 0%, #9c27b0 33%, #2196f3 66%, #4caf50 100%)', bar: 'linear-gradient(90deg, #ff9800, #e91e63)', accent: '#ffeb3b' },
  { id: 'custom',   label: 'Custom',   bg: 'linear-gradient(135deg, hsl(210,30%,12%) 0%, hsl(210,30%,22%) 100%)', bar: 'hsl(210,30%,8%)', accent: 'hsl(210,70%,55%)' },
];

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const ui = (zh: string, en: string) => IS_FIREFLY_VARIANT ? zh : en;
const themeLabel = (theme: ThemeMode, fallback: string) => IS_FIREFLY_VARIANT
  ? ({ dark: '深色', light: '浅色', midnight: '午夜', system: '跟随系统', crazy: '彩色', custom: '自定义' } as Record<ThemeMode, string>)[theme]
  : fallback;

/** Convert hue to a CSS color for the preview swatch */
function hueToPreviewBg(hue: number, brightness: number): string {
  const isLight = brightness > 50;
  const l = isLight ? 85 + (brightness - 50) * 0.3 : 4 + brightness * 0.28;
  return `linear-gradient(135deg, hsl(${hue},15%,${l}%) 0%, hsl(${hue},15%,${l + (isLight ? -8 : 8)}%) 100%)`;
}

export function AppearanceSettings() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const customHue = useSettingsStore((s) => s.customHue);
  const customBrightness = useSettingsStore((s) => s.customBrightness);
  const setCustomHue = useSettingsStore((s) => s.setCustomHue);
  const setCustomBrightness = useSettingsStore((s) => s.setCustomBrightness);
  const audioMixerWoodThemeEnabled = useSettingsStore((s) => s.audioMixerWoodThemeEnabled);
  const setAudioMixerWoodThemeEnabled = useSettingsStore((s) => s.setAudioMixerWoodThemeEnabled);
  const mediaPanelWoodThemeEnabled = useSettingsStore((s) => s.mediaPanelWoodThemeEnabled);
  const setMediaPanelWoodThemeEnabled = useSettingsStore((s) => s.setMediaPanelWoodThemeEnabled);
  const interfaceTextScale = useUiSettingsStore((s) => s.interfaceTextScale);
  const setInterfaceTextScale = useUiSettingsStore((s) => s.setInterfaceTextScale);
  const interfaceFontFamily = useUiSettingsStore((s) => s.interfaceFontFamily);
  const setInterfaceFontFamily = useUiSettingsStore((s) => s.setInterfaceFontFamily);
  const highReadabilityMode = useUiSettingsStore((s) => s.highReadabilityMode);
  const setHighReadabilityMode = useUiSettingsStore((s) => s.setHighReadabilityMode);

  return (
    <div className="settings-category-content">
      <h2>{ui('外观', 'Appearance')}</h2>

      <div className="settings-group">
        <div className="settings-group-title">{ui('界面缩放', 'Interface Zoom')}</div>
        <p className="settings-group-hint" style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '0 0 8px' }}>
          {ui('为避免误触，应用内不会响应 Ctrl + 滚轮。若要缩放整个界面，请在下方区域按住 ', 'Ctrl + Scroll zoom is disabled across the app to avoid accidental zoom. To scale the whole interface, hold ')}
          <strong>Ctrl</strong>{ui(' 并滚动，Atlas 将使用浏览器原生页面缩放。', " and scroll inside the box below — it uses your browser's native page zoom.")}
        </p>
        <div
          data-browser-zoom-area
          tabIndex={0}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: 84,
            borderRadius: 8,
            border: '1px dashed var(--border-strong, #555)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: 13,
            userSelect: 'none',
            cursor: 'ns-resize',
          }}
        >
          {ui('在此按住 Ctrl 并滚动以缩放界面', 'Ctrl + Scroll here to zoom the interface')}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{ui('文字与可读性', 'Text and Readability')}</div>

        <label className="settings-row shortcut-display-size-row">
          <span className="settings-label">{ui('界面文字大小', 'Interface text size')}</span>
          <span className="shortcut-display-size-control">
            <input
              type="range"
              min={MIN_INTERFACE_TEXT_SCALE}
              max={MAX_INTERFACE_TEXT_SCALE}
              step={0.05}
              value={interfaceTextScale}
              onChange={(event) => setInterfaceTextScale(Number(event.target.value))}
              className="settings-range"
            />
            <span className="shortcut-display-size-value">{Math.round(interfaceTextScale * 100)}%</span>
          </span>
        </label>

        <label className="settings-row">
          <span className="settings-label">{ui('界面字体', 'Interface font')}</span>
          <select
            value={interfaceFontFamily}
            onChange={(event) => setInterfaceFontFamily(event.target.value as InterfaceFontFamily)}
            className="settings-select"
          >
            <option value="system">{ui('系统默认', 'System')}</option>
            <option value="segoe">Segoe UI</option>
            <option value="arial">Arial</option>
            <option value="verdana">Verdana</option>
            <option value="mono">{ui('等宽字体', 'Monospace')}</option>
          </select>
        </label>

        <label className="settings-row">
          <span className="settings-label">{ui('高可读性配色', 'High readability colors')}</span>
          <input
            type="checkbox"
            checked={highReadabilityMode}
            onChange={(event) => setHighReadabilityMode(event.target.checked)}
            className="settings-checkbox"
          />
        </label>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{ui('主题', 'Theme')}</div>
        <div className="theme-selector">
          {themeOptions.map((opt) => {
            const isCustomCard = opt.id === 'custom';
            const bg = isCustomCard ? hueToPreviewBg(customHue, customBrightness) : opt.bg;
            const bar = isCustomCard ? `hsl(${customHue},15%,${customBrightness > 50 ? 78 : 8}%)` : opt.bar;
            const accent = isCustomCard ? `hsl(${customHue},70%,${customBrightness > 50 ? 45 : 55}%)` : opt.accent;

            return (
              <label key={opt.id} className={`theme-card ${theme === opt.id ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="theme"
                  value={opt.id}
                  checked={theme === opt.id}
                  onChange={() => setTheme(opt.id)}
                />
                <div
                  className="theme-preview"
                  style={{ background: bg }}
                >
                  <div className="theme-preview-bar" style={{ background: bar }} />
                  <div className="theme-preview-accent" style={{ background: accent }} />
                </div>
                <span className="theme-card-label">{themeLabel(opt.id, opt.label)}</span>
              </label>
            );
          })}
        </div>
      </div>

      {theme === 'custom' && (
        <div className="settings-group">
          <div className="settings-group-title">{ui('自定义主题', 'Customize')}</div>

          <div className="custom-theme-controls">
            <div className="custom-theme-row">
              <label className="custom-theme-label">{ui('色相', 'Color')}</label>
              <input
                type="range"
                min={0}
                max={360}
                value={customHue}
                onChange={(e) => setCustomHue(Number(e.target.value))}
                className="custom-theme-slider custom-theme-hue-slider"
              />
              <div
                className="custom-theme-swatch"
                style={{ background: `hsl(${customHue}, 70%, 55%)` }}
              />
            </div>

            <div className="custom-theme-row">
              <label className="custom-theme-label">{ui('亮度', 'Brightness')}</label>
              <input
                type="range"
                min={0}
                max={100}
                value={customBrightness}
                onChange={(e) => setCustomBrightness(Number(e.target.value))}
                className="custom-theme-slider"
              />
              <span className="custom-theme-value">{customBrightness}</span>
            </div>
          </div>
        </div>
      )}

      <div className="settings-group">
        <div className="settings-group-title">{ui('工作台材质', 'Studio Surfaces')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('木质调音台主题', 'Wooden audio mixer theme')}</span>
          <input
            type="checkbox"
            checked={audioMixerWoodThemeEnabled}
            onChange={(event) => setAudioMixerWoodThemeEnabled(event.target.checked)}
            className="settings-checkbox"
          />
        </label>

        <label className="settings-row">
          <span className="settings-label">{ui('木质素材面板主题', 'Wooden media panel theme')}</span>
          <input
            type="checkbox"
            checked={mediaPanelWoodThemeEnabled}
            onChange={(event) => setMediaPanelWoodThemeEnabled(event.target.checked)}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          {ui('为工作台面板应用木材、皮革、黄铜与金属质感。', 'Uses the wood, leather, brass, and metal skins for studio panels.')}
        </p>
      </div>
    </div>
  );
}
