import { useCallback, useEffect, useMemo, useState } from 'react';
import { audioRoutingManager } from '../../../services/audioRoutingManager';
import { useUiSettingsStore, type AudioLatencyHint } from '../../../stores/uiSettingsStore';

const latencyOptions: { id: AudioLatencyHint; label: string }[] = [
  { id: 'interactive', label: 'Interactive' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'playback', label: 'Playback' },
];

const IS_FIREFLY_VARIANT = import.meta.env.VITE_APP_VARIANT === 'firefly';
const ui = (zh: string, en: string) => IS_FIREFLY_VARIANT ? zh : en;

function getOutputRoutingSupport(): string {
  const audioContextProto = globalThis.AudioContext?.prototype as { setSinkId?: unknown } | undefined;
  const mediaProto = globalThis.HTMLMediaElement?.prototype as { setSinkId?: unknown } | undefined;
  if (typeof audioContextProto?.setSinkId === 'function') return 'AudioContext output routing';
  if (typeof mediaProto?.setSinkId === 'function') return 'Media element output routing';
  return 'Browser default output only';
}

function getDeviceLabel(device: MediaDeviceInfo, fallback: string): string {
  return device.label || fallback;
}

export function AudioSettings() {
  const audioOutputDeviceId = useUiSettingsStore((s) => s.audioOutputDeviceId);
  const setAudioOutputDeviceId = useUiSettingsStore((s) => s.setAudioOutputDeviceId);
  const audioInputDeviceId = useUiSettingsStore((s) => s.audioInputDeviceId);
  const setAudioInputDeviceId = useUiSettingsStore((s) => s.setAudioInputDeviceId);
  const audioLatencyHint = useUiSettingsStore((s) => s.audioLatencyHint);
  const setAudioLatencyHint = useUiSettingsStore((s) => s.setAudioLatencyHint);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [permissionState, setPermissionState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [refreshTick, setRefreshTick] = useState(0);

  const canEnumerateDevices = Boolean(navigator.mediaDevices?.enumerateDevices);
  const inputDevices = useMemo(() => devices.filter(device => device.kind === 'audioinput'), [devices]);
  const outputDevices = useMemo(() => devices.filter(device => device.kind === 'audiooutput'), [devices]);
  const activeContext = audioRoutingManager.getActiveContext();
  const outputSupport = getOutputRoutingSupport();

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const nextDevices = await navigator.mediaDevices.enumerateDevices();
    setDevices(nextDevices);
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      void refreshDevices();
    }, 0);
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) {
      return () => window.clearTimeout(initialRefresh);
    }
    const handleDeviceChange = () => {
      void refreshDevices();
      setRefreshTick(tick => tick + 1);
    };
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => {
      window.clearTimeout(initialRefresh);
      mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [refreshDevices]);

  const requestInputPermission = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    setPermissionState('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      setPermissionState('granted');
      await refreshDevices();
    } catch {
      setPermissionState('denied');
    }
  }, [refreshDevices]);

  return (
    <div className="settings-category-content">
      <h2>{ui('音频', 'Audio')}</h2>

      <div className="settings-group">
        <div className="settings-group-title">{ui('设备', 'Devices')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('输出设备', 'Output device')}</span>
          <select
            value={audioOutputDeviceId}
            onChange={(event) => setAudioOutputDeviceId(event.target.value)}
            className="settings-select"
            disabled={!canEnumerateDevices || outputDevices.length === 0}
          >
            <option value="">{ui('系统默认', 'System default')}</option>
            {outputDevices.map((device, index) => (
              <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                {getDeviceLabel(device, ui(`输出设备 ${index + 1}`, `Output ${index + 1}`))}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-row">
          <span className="settings-label">{ui('录音输入', 'Recording input')}</span>
          <select
            value={audioInputDeviceId}
            onChange={(event) => setAudioInputDeviceId(event.target.value)}
            className="settings-select"
            disabled={!canEnumerateDevices || inputDevices.length === 0}
          >
            <option value="">{ui('系统默认', 'System default')}</option>
            {inputDevices.map((device, index) => (
              <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                {getDeviceLabel(device, ui(`输入设备 ${index + 1}`, `Input ${index + 1}`))}
              </option>
            ))}
          </select>
        </label>

        <div className="settings-row-actions">
          <button
            type="button"
            className="settings-button"
            onClick={requestInputPermission}
            disabled={!navigator.mediaDevices?.getUserMedia || permissionState === 'requesting'}
          >
            {permissionState === 'requesting' ? ui('正在请求…', 'Requesting...') : ui('显示设备名称', 'Unlock device names')}
          </button>
          <button
            type="button"
            className="settings-button"
            onClick={() => {
              void refreshDevices();
              setRefreshTick(tick => tick + 1);
            }}
            disabled={!canEnumerateDevices}
          >
            {ui('刷新', 'Refresh')}
          </button>
        </div>
        <p className="settings-hint">
          {ui('浏览器会在授予麦克风权限前隐藏具体设备名称。', 'Browser privacy hides exact device names until microphone permission is granted.')}
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{ui('浏览器音频链路', 'Browser Audio Pipeline')}</div>

        <label className="settings-row">
          <span className="settings-label">{ui('延迟模式', 'Latency mode')}</span>
          <select
            value={audioLatencyHint}
            onChange={(event) => setAudioLatencyHint(event.target.value as AudioLatencyHint)}
            className="settings-select"
          >
            {latencyOptions.map(option => (
              <option key={option.id} value={option.id}>{IS_FIREFLY_VARIANT ? ({ interactive: '低延迟', balanced: '平衡', playback: '播放优先' } as Record<AudioLatencyHint, string>)[option.id] : option.label}</option>
            ))}
          </select>
        </label>

        <div className="settings-status">
          <span className={`status-indicator ${canEnumerateDevices ? 'connected' : 'disconnected'}`} />
          <span className="status-text">{ui('设备接口', 'Device API')}: {canEnumerateDevices ? ui('可用', 'available') : ui('不可用', 'not available')}</span>
        </div>
        <div className="settings-status">
          <span className={`status-indicator ${outputSupport !== 'Browser default output only' ? 'connected' : 'disconnected'}`} />
          <span className="status-text">{ui('输出路由', 'Output routing')}: {IS_FIREFLY_VARIANT ? (outputSupport === 'Browser default output only' ? '仅浏览器默认输出' : outputSupport === 'AudioContext output routing' ? 'AudioContext 输出路由' : '媒体元素输出路由') : outputSupport}</span>
        </div>
        <div className="settings-status">
          <span className={`status-indicator ${activeContext ? 'connected' : 'disconnected'}`} />
          <span className="status-text">
            AudioContext: {activeContext ? `${activeContext.state}, ${activeContext.sampleRate} Hz` : ui('尚未创建', 'not created yet')}
          </span>
        </div>
        {activeContext && (
          <p className="settings-hint">
            {ui('基础延迟', 'Base latency')}: {Math.round((activeContext.baseLatency ?? 0) * 1000)} ms
            {' | '}
            {ui('输出延迟', 'Output latency')}: {Math.round(((activeContext as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000)} ms
            {' | '}
            {ui('路由', 'Routes')}: {audioRoutingManager.activeRouteCount}
            {' | '}
            {ui('刷新计数', 'Refresh')}: {refreshTick}
          </p>
        )}
      </div>
    </div>
  );
}
