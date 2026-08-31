// ShortcutRecorder — click-to-record key combo widget
// Shows current binding as keycap badges. Click to enter recording mode.

import { useState, useEffect, useCallback, useRef } from 'react';
import type { KeyCombo, ShortcutActionId } from '../../../services/shortcutTypes';
import { comboToLabel } from '../../../services/shortcutRegistry';

interface ShortcutRecorderProps {
  combos: KeyCombo[];
  actionId: ShortcutActionId;
  isOverridden: boolean;
  onRecord: (combo: KeyCombo) => void;
  onReset: () => void;
  conflictLabel?: string | null;
}

function eventToCombo(e: KeyboardEvent): KeyCombo | null {
  // Ignore bare modifier keys
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return null;
  }

  const combo: KeyCombo = {};

  // Use code for special keys
  if (e.code === 'Space' || e.code.startsWith('Numpad')) {
    combo.code = e.code;
  } else {
    combo.key = e.key.toLowerCase();
  }

  if (e.ctrlKey || e.metaKey) combo.ctrl = true;
  if (e.shiftKey) combo.shift = true;
  if (e.altKey) combo.alt = true;

  return combo;
}

export function ShortcutRecorder({
  combos,
  isOverridden,
  onRecord,
  onReset,
  conflictLabel,
}: ShortcutRecorderProps) {
  const firefly = import.meta.env.VITE_APP_VARIANT === 'firefly';
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<HTMLDivElement>(null);

  const startRecording = useCallback(() => {
    setRecording(true);
  }, []);

  const cancelRecording = useCallback(() => {
    setRecording(false);
  }, []);

  // Listen for keydown when recording
  useEffect(() => {
    if (!recording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels recording
      if (e.key === 'Escape') {
        setRecording(false);
        return;
      }

      const combo = eventToCombo(e);
      if (combo) {
        onRecord(combo);
        setRecording(false);
      }
    };

    // Click outside cancels recording
    const handleMouseDown = (e: MouseEvent) => {
      if (recorderRef.current && !recorderRef.current.contains(e.target as Node)) {
        setRecording(false);
        e.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('mousedown', handleMouseDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [recording, onRecord]);

  return (
    <div className="shortcut-recorder" ref={recorderRef}>
      <div
        className={`shortcut-keycaps ${recording ? 'recording' : ''}`}
        onClick={recording ? cancelRecording : startRecording}
        title={recording
          ? (firefly ? '请按快捷键（按 Esc 取消）' : 'Press a key combo (Esc to cancel)')
          : (firefly ? '点击修改快捷键' : 'Click to change shortcut')}
      >
        {recording ? (
          <span className="shortcut-recording-text">{firefly ? '请按快捷键…' : 'Press key...'}</span>
        ) : combos.length > 0 ? (
          combos.map((combo, i) => (
            <span key={i} className="shortcut-keycap">
              {comboToLabel(combo)}
            </span>
          ))
        ) : (
          <span className="shortcut-unbound">{firefly ? '未设置' : 'Not set'}</span>
        )}
      </div>

      {isOverridden && !recording && (
        <button
          className="shortcut-reset-btn"
          onClick={(e) => { e.stopPropagation(); onReset(); }}
          title={firefly ? '恢复预设默认值' : 'Reset to preset default'}
        >
          &#x21BA;
        </button>
      )}

      {conflictLabel && (
        <span className="shortcut-conflict">
          {firefly ? '与以下操作冲突：' : 'Conflicts with: '}{conflictLabel}
        </span>
      )}
    </div>
  );
}
