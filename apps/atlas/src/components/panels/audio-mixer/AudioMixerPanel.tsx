import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import './AudioMixerPanel.css';
import './wood-theme/wood-theme.css';
import './wood-theme/wood-center-well.css';
import { useTimelineStore } from '../../../stores/timeline';
import { useSettingsStore } from '../../../stores/settingsStore';
import { AudioExportPipeline } from '../../../engine/audio/AudioExportPipeline';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import { DEFAULT_MASTER_AUDIO_STATE, formatSeconds, MASTER_FOCUS_ID } from './audioMixerMath';
import type { FxWindowTarget, TrackColorMenuTarget } from './audioMixerTypes';
import { MasterMixerStrip } from './MasterMixerStrip';
import type { MixerFaderResizeHandleProps } from './MixerFaderResizeHandle';
import { MixerFxWindow } from './MixerFxWindow';
import { MixerTrackColorMenu } from './MixerTrackColorMenu';
import { TrackMixerStrip } from './TrackMixerStrip';

type AudioMixerPanelStyle = CSSProperties & {
  '--audio-mixer-fader-area-fr'?: string;
};

const MIXER_FADER_AREA_STORAGE_KEY = 'masterselects.audioMixer.faderAreaFr';
const MIXER_FADER_AREA_DEFAULT_FR = 2;
const MIXER_FADER_AREA_MIN_FR = 1.25;
const MIXER_FADER_AREA_MAX_FR = 3.4;
const MIXER_FADER_AREA_STEP_FR = 0.15;
const MIXER_FADER_AREA_DRAG_PX_PER_FR = 120;

function clampMixerFaderAreaFr(value: number): number {
  if (!Number.isFinite(value)) return MIXER_FADER_AREA_DEFAULT_FR;
  return Math.min(MIXER_FADER_AREA_MAX_FR, Math.max(MIXER_FADER_AREA_MIN_FR, value));
}

function readStoredMixerFaderAreaFr(): number {
  if (typeof window === 'undefined') return MIXER_FADER_AREA_DEFAULT_FR;
  try {
    const stored = window.localStorage?.getItem(MIXER_FADER_AREA_STORAGE_KEY);
    return stored ? clampMixerFaderAreaFr(Number(stored)) : MIXER_FADER_AREA_DEFAULT_FR;
  } catch {
    return MIXER_FADER_AREA_DEFAULT_FR;
  }
}

export function AudioMixerPanel() {
  const tracks = useTimelineStore(state => state.tracks);
  const duration = useTimelineStore(state => state.duration);
  const inPoint = useTimelineStore(state => state.inPoint);
  const outPoint = useTimelineStore(state => state.outPoint);
  const masterAudioState = useTimelineStore(state => state.masterAudioState);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const runAudioExportPreflight = useTimelineStore(state => state.runAudioExportPreflight);
  const [recordingState, setRecordingState] = useState(audioRecordingService.getSnapshot());
  const [preflightMeasuring, setPreflightMeasuring] = useState(false);
  const [focusedStripId, setFocusedStripId] = useState<string>(MASTER_FOCUS_ID);
  const [fxWindowTarget, setFxWindowTarget] = useState<FxWindowTarget | null>(null);
  const [trackColorMenuTarget, setTrackColorMenuTarget] = useState<TrackColorMenuTarget | null>(null);
  const [compactHeight, setCompactHeight] = useState(false);
  const [faderAreaFr, setFaderAreaFr] = useState(readStoredMixerFaderAreaFr);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const faderResizeDragRef = useRef<{
    pointerId: number;
    startClientY: number;
    startFaderAreaFr: number;
  } | null>(null);
  const woodMixerEnabled = useSettingsStore(state => state.audioMixerWoodThemeEnabled);

  useEffect(() => audioRecordingService.subscribe(setRecordingState), []);

  useEffect(() => {
    try {
      window.localStorage?.setItem(MIXER_FADER_AREA_STORAGE_KEY, String(faderAreaFr));
    } catch {
      // Some restricted browser contexts disable localStorage.
    }
  }, [faderAreaFr]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return;

    const updateCompactHeight = () => {
      setCompactHeight(panel.getBoundingClientRect().height <= 430);
    };

    updateCompactHeight();
    const resizeObserver = new ResizeObserver(updateCompactHeight);
    resizeObserver.observe(panel);
    return () => resizeObserver.disconnect();
  }, []);

  // MIDI tracks appear as mixer channel strips too (issue #182): their synth is
  // routed through a per-track volume/pan/meter bus, so they behave like audio.
  const audioTracks = useMemo(
    () => tracks.filter(track => track.type === 'audio' || track.type === 'midi'),
    [tracks],
  );
  useEffect(() => {
    const hasFocusedTrack = audioTracks.some(track => track.id === focusedStripId);
    if (focusedStripId !== MASTER_FOCUS_ID && !hasFocusedTrack) {
      setFocusedStripId(audioTracks[0]?.id ?? MASTER_FOCUS_ID);
    }
  }, [audioTracks, focusedStripId]);

  useEffect(() => {
    if (propertiesSelection?.kind === 'track') {
      if (audioTracks.some(track => track.id === propertiesSelection.trackId)) {
        setFocusedStripId(propertiesSelection.trackId);
      }
      return;
    }
    if (propertiesSelection?.kind === 'master') {
      setFocusedStripId(MASTER_FOCUS_ID);
    }
  }, [audioTracks, propertiesSelection]);

  useEffect(() => {
    if (fxWindowTarget?.scope === 'track' && !audioTracks.some(track => track.id === fxWindowTarget.trackId)) {
      setFxWindowTarget(null);
    }
  }, [audioTracks, fxWindowTarget]);

  const masterAudio = masterAudioState ?? DEFAULT_MASTER_AUDIO_STATE;
  const recoveryEntries = recordingState.recoveryEntries ?? audioRecordingService.listRecoveryEntries();

  const handleStaticPreflight = useCallback(() => {
    runAudioExportPreflight(inPoint ?? 0, outPoint ?? duration);
  }, [duration, inPoint, outPoint, runAudioExportPreflight]);

  const handleRenderedPreflight = useCallback(async () => {
    if (preflightMeasuring) return;
    setPreflightMeasuring(true);
    try {
      const start = inPoint ?? 0;
      const end = outPoint ?? duration;
      runAudioExportPreflight(start, end);
      const pipeline = new AudioExportPipeline({ sampleRate: 48000, normalize: false });
      const renderedBuffer = await pipeline.exportRawAudio(start, end);
      runAudioExportPreflight(start, end, renderedBuffer);
    } catch (error) {
      useTimelineStore.getState().updateMasterAudioState({
        exportPreflight: {
          lastCheckedAt: Date.now(),
          warnings: [{
            code: 'audio-mixer-rendered-preflight-failed',
            message: error instanceof Error ? error.message : 'Rendered audio preflight failed.',
            severity: 'error',
          }],
        },
      });
    } finally {
      setPreflightMeasuring(false);
    }
  }, [duration, inPoint, outPoint, preflightMeasuring, runAudioExportPreflight]);

  const handleFocusTrack = useCallback((trackId: string) => {
    setFocusedStripId(trackId);
    useTimelineStore.getState().selectTrackProperties(trackId);
  }, []);

  const handleFocusMaster = useCallback(() => {
    setFocusedStripId(MASTER_FOCUS_ID);
    useTimelineStore.getState().selectMasterProperties();
  }, []);

  const handleOpenTrackColorMenu = useCallback((event: ReactMouseEvent, trackId: string) => {
    event.preventDefault();
    event.stopPropagation();
    handleFocusTrack(trackId);
    setTrackColorMenuTarget({
      x: event.clientX,
      y: event.clientY,
      trackId,
    });
  }, [handleFocusTrack]);

  const handleCommitRecovery = useCallback(async (sessionId: string) => {
    try {
      await audioRecordingService.commitRecoveryEntry(sessionId);
    } catch (error) {
      useTimelineStore.getState().updateMasterAudioState({
        exportPreflight: {
          lastCheckedAt: Date.now(),
          warnings: [{
            code: 'audio-recording-recovery-commit-failed',
            message: error instanceof Error ? error.message : 'Recovered recording commit failed.',
            severity: 'error',
          }],
        },
      });
    }
  }, []);

  const commitFaderAreaFr = useCallback((nextValue: number) => {
    setFaderAreaFr(clampMixerFaderAreaFr(nextValue));
  }, []);

  const handleFaderResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    faderResizeDragRef.current = {
      pointerId: event.pointerId,
      startClientY: event.clientY,
      startFaderAreaFr: faderAreaFr,
    };
    event.currentTarget.dataset.dragging = 'true';
    event.currentTarget.focus({ preventScroll: true });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events do not always create a capturable pointer.
    }
  }, [faderAreaFr]);

  const handleFaderResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = faderResizeDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const deltaY = event.clientY - dragState.startClientY;
    commitFaderAreaFr(dragState.startFaderAreaFr - (deltaY / MIXER_FADER_AREA_DRAG_PX_PER_FR));
  }, [commitFaderAreaFr]);

  const handleFaderResizePointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = faderResizeDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    faderResizeDragRef.current = null;
    delete event.currentTarget.dataset.dragging;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore non-captured synthetic pointers.
    }
  }, []);

  const handleFaderResizeDoubleClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    commitFaderAreaFr(MIXER_FADER_AREA_DEFAULT_FR);
  }, [commitFaderAreaFr]);

  const handleFaderResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    let nextValue: number | null = null;
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        nextValue = faderAreaFr + MIXER_FADER_AREA_STEP_FR;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        nextValue = faderAreaFr - MIXER_FADER_AREA_STEP_FR;
        break;
      case 'PageUp':
        nextValue = faderAreaFr + (MIXER_FADER_AREA_STEP_FR * 4);
        break;
      case 'PageDown':
        nextValue = faderAreaFr - (MIXER_FADER_AREA_STEP_FR * 4);
        break;
      case 'Home':
        nextValue = MIXER_FADER_AREA_MIN_FR;
        break;
      case 'End':
        nextValue = MIXER_FADER_AREA_MAX_FR;
        break;
      case 'Enter':
      case ' ':
        nextValue = MIXER_FADER_AREA_DEFAULT_FR;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    commitFaderAreaFr(nextValue);
  }, [commitFaderAreaFr, faderAreaFr]);

  const focusedIsMaster = focusedStripId === MASTER_FOCUS_ID;
  const panelClassName = `audio-mixer-panel${woodMixerEnabled ? ' wood' : ''}${compactHeight ? ' compact-height' : ''}`;
  const panelStyle = useMemo<AudioMixerPanelStyle>(() => ({
    '--audio-mixer-fader-area-fr': `${faderAreaFr.toFixed(2)}fr`,
  }), [faderAreaFr]);
  const faderResizeHandleProps = useMemo<MixerFaderResizeHandleProps>(() => ({
    onResizePointerDown: handleFaderResizePointerDown,
    onResizePointerMove: handleFaderResizePointerMove,
    onResizePointerEnd: handleFaderResizePointerEnd,
    onResizeDoubleClick: handleFaderResizeDoubleClick,
    onResizeKeyDown: handleFaderResizeKeyDown,
  }), [
    handleFaderResizeDoubleClick,
    handleFaderResizeKeyDown,
    handleFaderResizePointerDown,
    handleFaderResizePointerEnd,
    handleFaderResizePointerMove,
  ]);

  return (
    <div ref={panelRef} className={panelClassName} style={panelStyle}>
      {recoveryEntries.length > 0 && (
        <div className="audio-mixer-recovery-list">
          {recoveryEntries.slice(0, 4).map(entry => (
            <div key={entry.sessionId} className={`audio-mixer-recovery-item ${entry.status}`}>
              <span>{entry.status}</span>
              <p>
                {entry.targetTrackIds.length} track{entry.targetTrackIds.length === 1 ? '' : 's'} at {formatSeconds(entry.startTime)}
                {entry.punchOutTime !== undefined ? ` -> ${formatSeconds(entry.punchOutTime)}` : ''}
                {entry.message ? ` / ${entry.message}` : ''}
              </p>
              {entry.status === 'stopped' && entry.assets && entry.assets.length > 0 && (
                <button
                  type="button"
                  onClick={() => void handleCommitRecovery(entry.sessionId)}
                  title="Commit recovered recording"
                >
                  Add
                </button>
              )}
              <button
                type="button"
                onClick={() => void audioRecordingService.dismissRecoveryEntry(entry.sessionId)}
                title="Dismiss recovery entry"
              >
                X
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="audio-mixer-body">
        <div className="audio-mixer-console">
          <div className="audio-mixer-track-scroll">
            <div className="audio-mixer-strip-grid">
              {audioTracks.map((track, index) => (
                <TrackMixerStrip
                  key={track.id}
                  track={track}
                  index={index}
                  focused={focusedStripId === track.id}
                  onFocus={() => handleFocusTrack(track.id)}
                  onOpenFx={setFxWindowTarget}
                  onOpenColorMenu={handleOpenTrackColorMenu}
                  faderResizeHandleProps={faderResizeHandleProps}
                />
              ))}
              <div className="audio-mixer-center-well" aria-hidden="true" />
            </div>
          </div>

          <div className="audio-mixer-master-bay">
            <MasterMixerStrip
              masterAudio={masterAudio}
              focused={focusedIsMaster}
              preflightMeasuring={preflightMeasuring}
              leatherIndex={audioTracks.length}
              onFocus={handleFocusMaster}
              onOpenFx={setFxWindowTarget}
              onStaticPreflight={handleStaticPreflight}
              onRenderedPreflight={handleRenderedPreflight}
              faderResizeHandleProps={faderResizeHandleProps}
            />
          </div>
        </div>

        <MixerFxWindow
          target={fxWindowTarget}
          tracks={audioTracks}
          masterAudio={masterAudio}
          onClose={() => setFxWindowTarget(null)}
        />
        <MixerTrackColorMenu
          target={trackColorMenuTarget}
          tracks={audioTracks}
          onClose={() => setTrackColorMenuTarget(null)}
        />
      </div>
    </div>
  );
}
