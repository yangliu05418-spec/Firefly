import { useCallback, type ChangeEvent } from 'react';
import {
  MAX_SHORTCUT_DISPLAY_SCALE,
  MIN_SHORTCUT_DISPLAY_SCALE,
  useSettingsStore,
  type AutosaveInterval,
  type SaveMode,
  type PreviewQuality,
  type GPUPowerPreference,
  type TimelineZoomAnchor,
} from '../../../stores/settingsStore';
// AutosaveInterval used in interval select onChange cast
import { useIsMobile } from '../../../hooks/useIsMobile';
import { requestShortcutDisplayPreview } from '../shortcutDisplayPreview';
import { OutputSettings } from './OutputSettings';
import { AIFeaturesSettings } from './AIFeaturesSettings';

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const ui = (zh: string, en: string) => IS_FIREFLY_VARIANT ? zh : en;

export function GeneralSettings() {
  const {
    saveMode,
    autosaveInterval,
    copyMediaToProject,
    forceDesktopMode,
    timelineZoomAnchor,
    showShortcutDisplay,
    shortcutDisplayScale,
    previewQuality,
    gpuPowerPreference,
    setSaveMode,
    setAutosaveInterval,
    setCopyMediaToProject,
    setForceDesktopMode,
    setTimelineZoomAnchor,
    setShowShortcutDisplay,
    setShortcutDisplayScale,
    setPreviewQuality,
    setGpuPowerPreference,
  } = useSettingsStore();

  const isMobileDevice = useIsMobile();

  const handleSwitchToMobile = useCallback(() => {
    setForceDesktopMode(false);
    window.location.reload();
  }, [setForceDesktopMode]);

  const handleShortcutDisplayToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setShowShortcutDisplay(event.target.checked);
    requestShortcutDisplayPreview();
  }, [setShowShortcutDisplay]);

  const handleShortcutDisplayScaleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setShortcutDisplayScale(Number(event.target.value));
    requestShortcutDisplayPreview();
  }, [setShortcutDisplayScale]);

  const shortcutDisplayScalePercent = Math.round(shortcutDisplayScale * 100);

  return (
    <div className="settings-category-content">
      <h2>{ui('常规', 'General')}</h2>

      {/* Import */}
      <div className="settings-group">
        <div className="settings-group-title">{ui('导入', 'Import')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('将媒体复制到项目文件夹', 'Copy media to project folder')}</span>
          <input
            type="checkbox"
            checked={copyMediaToProject}
            onChange={(e) => setCopyMediaToProject(e.target.checked)}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          {ui('导入素材时保存项目副本，便于离线编辑和恢复。', "When importing clips, copy them to the project's Raw folder for easier relinking.")}
        </p>
      </div>

      {/* Save Mode */}
      <div className="settings-group">
        <div className="settings-group-title">{ui('保存', 'Save')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('保存方式', 'Save Mode')}</span>
          <select
            value={saveMode}
            onChange={(e) => setSaveMode(e.target.value as SaveMode)}
            className="settings-select"
          >
            <option value="continuous">{ui('持续保存（每次更改）', 'Continuous (every change)')}</option>
            <option value="interval">{ui('定时保存', 'Interval (timed)')}</option>
          </select>
        </label>
        <p className="settings-hint">
          {saveMode === 'continuous'
            ? ui('每次修改都会自动保存，无需手动操作。', 'Project is saved automatically after every change. You never have to think about saving.')
            : ui('项目会按固定间隔保存，也可以使用 Ctrl+S 手动保存。', 'Project is saved on a timer interval. You can also save manually with Ctrl+S.')}
        </p>

        {saveMode === 'interval' && (
          <>
            <label className="settings-row">
              <span className="settings-label">{ui('保存间隔', 'Save Interval')}</span>
              <select
                value={autosaveInterval}
                onChange={(e) => setAutosaveInterval(Number(e.target.value) as AutosaveInterval)}
                className="settings-select"
              >
                <option value={1}>{ui('1 分钟', '1 minute')}</option>
                <option value={2}>{ui('2 分钟', '2 minutes')}</option>
                <option value={5}>{ui('5 分钟', '5 minutes')}</option>
                <option value={10}>{ui('10 分钟', '10 minutes')}</option>
              </select>
            </label>
          </>
        )}
      </div>

      {isMobileDevice && forceDesktopMode && (
        <div className="settings-group">
          <div className="settings-group-title">{ui('视图模式', 'View Mode')}</div>
          <p className="settings-description">
            {ui('你正在移动设备上使用桌面界面。', "You're viewing the desktop interface on a mobile device.")}
          </p>
          <button className="settings-button" onClick={handleSwitchToMobile}>
            {ui('切换到移动视图', 'Switch to Mobile View')}
          </button>
        </div>
      )}

      {/* Timeline */}
      <div className="settings-group">
        <div className="settings-group-title">{ui('时间线', 'Timeline')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('缩放中心', 'Zoom Anchor')}</span>
          <select
            value={timelineZoomAnchor}
            onChange={(e) => setTimelineZoomAnchor(e.target.value as TimelineZoomAnchor)}
            className="settings-select"
          >
            <option value="mouse">{ui('鼠标指针', 'Mouse Pointer')}</option>
            <option value="playhead">{ui('播放头', 'Playhead')}</option>
          </select>
        </label>
        <p className="settings-hint">
          {ui('设置 Ctrl/Alt + 滚轮缩放时以鼠标还是播放头为中心。', 'Controls whether Ctrl/Alt+scroll zooms toward the cursor or the playhead.')}
        </p>
      </div>

      {/* Input Display */}
      <div className="settings-group">
        <div className="settings-group-title">{ui('输入提示', 'Input Display')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('显示快捷键和鼠标操作', 'Show shortcuts and mouse clicks')}</span>
          <input
            type="checkbox"
            checked={showShortcutDisplay}
            onChange={handleShortcutDisplayToggle}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          {ui('最近的按键、点击、拖动和滚轮操作会显示在界面左下角。', 'Recent key presses, clicks, drags, and wheel gestures appear near the bottom-left of the app.')}
        </p>

        <label className="settings-row shortcut-display-size-row">
          <span className="settings-label">{ui('大小', 'Size')}</span>
          <span className="shortcut-display-size-control">
            <input
              type="range"
              min={MIN_SHORTCUT_DISPLAY_SCALE}
              max={MAX_SHORTCUT_DISPLAY_SCALE}
              step={0.05}
              value={shortcutDisplayScale}
              onChange={handleShortcutDisplayScaleChange}
              onFocus={() => requestShortcutDisplayPreview()}
              onPointerDown={() => requestShortcutDisplayPreview(5000)}
              onPointerUp={() => requestShortcutDisplayPreview()}
              className="settings-range"
            />
            <span className="shortcut-display-size-value">{shortcutDisplayScalePercent}%</span>
          </span>
        </label>
      </div>

      {/* Output */}
      <OutputSettings embedded />

      {/* Preview */}
      <div className="settings-group">
        <div className="settings-group-title">{ui('预览', 'Preview')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('预览画质', 'Preview Resolution')}</span>
          <select
            value={previewQuality}
            onChange={(e) => setPreviewQuality(Number(e.target.value) as PreviewQuality)}
            className="settings-select"
          >
            <option value={1}>{ui('原画（100%）', 'Full (100%)')}</option>
            <option value={0.5}>{ui('清晰（50%）', 'Half (50%)')}</option>
            <option value={0.25}>{ui('流畅（25%）', 'Quarter (25%)')}</option>
            <option value={0.125}>{ui('低清（12.5%）', 'Low (12.5%)')}</option>
          </select>
        </label>
        <p className="settings-hint">{ui('降低预览画质可以提升播放流畅度，不影响导出质量。', 'Lower resolution improves playback performance.')}</p>

        <p className="settings-hint">
          {ui('预览画质只影响编辑器显示，不会修改或预转码源文件。', 'Preview quality affects the editor only and does not modify source media.')}
        </p>
      </div>

      {/* Performance */}
      <div className="settings-group">
        <div className="settings-group-title">{ui('性能', 'Performance')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('GPU 性能偏好', 'GPU Power Preference')}</span>
          <select
            value={gpuPowerPreference}
            onChange={(e) => setGpuPowerPreference(e.target.value as GPUPowerPreference)}
            className="settings-select"
          >
            <option value="high-performance">{ui('高性能（独立显卡）', 'High Performance (Discrete GPU)')}</option>
            <option value="low-power">{ui('节能（集成显卡）', 'Low Power (Integrated GPU)')}</option>
          </select>
        </label>
        <p className="settings-hint">
          {ui('更改后需要刷新页面才能生效。', 'Requires page reload to take effect.')}
        </p>
      </div>

      {/* AI Features */}
      {!IS_FIREFLY_VARIANT && <AIFeaturesSettings embedded />}
    </div>
  );
}
