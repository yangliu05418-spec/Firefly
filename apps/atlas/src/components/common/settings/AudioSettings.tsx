import { useCallback, useEffect, useMemo, useState } from 'react';
import { audioRoutingManager } from '../../../services/audioRoutingManager';
import { useUiSettingsStore, type AudioLatencyHint } from '../../../stores/uiSettingsStore';

const latencyOptions: { id: AudioLatencyHint; label: string }[] = [
  { id: 'interactive', label: 'Interactive' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'playback', label: 'Playback' },
];

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
      <h2>Audio</h2>

      <div className="settings-group">
        <div className="settings-group-title">Devices</div>

        <label className="settings-row">
          <span className="settings-label">Output device</span>
          <select
            value={audioOutputDeviceId}
            onChange={(event) => setAudioOutputDeviceId(event.target.value)}
            className="settings-select"
            disabled={!canEnumerateDevices || outputDevices.length === 0}
          >
            <option value="">System default</option>
            {outputDevices.map((device, index) => (
              <option key={device.deviceId || `output-${index}`} value={device.deviceId}>
                {getDeviceLabel(device, `Output ${index + 1}`)}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-row">
          <span className="settings-label">Recording input</span>
          <select
            value={audioInputDeviceId}
            onChange={(event) => setAudioInputDeviceId(event.target.value)}
            className="settings-select"
            disabled={!canEnumerateDevices || inputDevices.length === 0}
          >
            <option value="">System default</option>
            {inputDevices.map((device, index) => (
              <option key={device.deviceId || `input-${index}`} value={device.deviceId}>
                {getDeviceLabel(device, `Input ${index + 1}`)}
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
            {permissionState === 'requesting' ? 'Requesting...' : 'Unlock device names'}
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
            Refresh
          </button>
        </div>
        <p className="settings-hint">
          Browser privacy hides exact device names until microphone permission is granted.
        </p>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Browser Audio Pipeline</div>

        <label className="settings-row">
          <span className="settings-label">Latency mode</span>
          <select
            value={audioLatencyHint}
            onChange={(event) => setAudioLatencyHint(event.target.value as AudioLatencyHint)}
            className="settings-select"
          >
            {latencyOptions.map(option => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>

        <div className="settings-status">
          <span className={`status-indicator ${canEnumerateDevices ? 'connected' : 'disconnected'}`} />
          <span className="status-text">Device API: {canEnumerateDevices ? 'available' : 'not available'}</span>
        </div>
        <div className="settings-status">
          <span className={`status-indicator ${outputSupport !== 'Browser default output only' ? 'connected' : 'disconnected'}`} />
          <span className="status-text">Output routing: {outputSupport}</span>
        </div>
        <div className="settings-status">
          <span className={`status-indicator ${activeContext ? 'connected' : 'disconnected'}`} />
          <span className="status-text">
            AudioContext: {activeContext ? `${activeContext.state}, ${activeContext.sampleRate} Hz` : 'not created yet'}
          </span>
        </div>
        {activeContext && (
          <p className="settings-hint">
            Base latency: {Math.round((activeContext.baseLatency ?? 0) * 1000)} ms
            {' | '}
            Output latency: {Math.round(((activeContext as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000)} ms
            {' | '}
            Routes: {audioRoutingManager.activeRouteCount}
            {' | '}
            Refresh: {refreshTick}
          </p>
        )}
      </div>
    </div>
  );
}
