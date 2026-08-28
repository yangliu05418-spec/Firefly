import { useCallback } from 'react';
import type { AudioSendState } from '../../../types';
import { useTimelineStore } from '../../../stores/timeline';

export function TimelineHeaderAudioSends({
  sends,
  trackId,
}: {
  sends: readonly AudioSendState[];
  trackId: string;
}) {
  const addSend = useCallback(() => {
    useTimelineStore.getState().addTrackAudioSend(trackId);
  }, [trackId]);

  return (
    <div className="audio-send-stack">
      <div className="audio-send-stack-header">
        <span>Sends</span>
        <button type="button" onClick={addSend} title="Add send">+ Send</button>
      </div>
      {sends.length === 0 ? (
        <div className="audio-send-empty">No sends</div>
      ) : (
        <div className="audio-send-list">
          {sends.map((send, index) => (
            <div className="audio-send-row" key={send.id}>
              <button
                type="button"
                className={`audio-send-enable ${send.enabled !== false ? 'active' : ''}`}
                onClick={() => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { enabled: send.enabled === false })}
                title={send.enabled === false ? 'Enable send' : 'Bypass send'}
              >
                {index + 1}
              </button>
              <input
                className="audio-send-target"
                type="text"
                value={send.targetBusId}
                aria-label="Send target bus"
                onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { targetBusId: event.currentTarget.value })}
              />
              <input
                className="audio-send-gain"
                type="range"
                min="-60"
                max="18"
                step="0.5"
                value={send.gainDb}
                aria-label="Send gain"
                title={`${send.gainDb.toFixed(1)} dB`}
                onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { gainDb: Number(event.currentTarget.value) })}
              />
              <span className="audio-send-gain-value">{send.gainDb.toFixed(1)}</span>
              <label className="audio-send-prefader" title="Pre-fader send">
                <input
                  type="checkbox"
                  checked={send.preFader}
                  onChange={(event) => useTimelineStore.getState().updateTrackAudioSend(trackId, send.id, { preFader: event.currentTarget.checked })}
                />
                Pre
              </label>
              <button
                type="button"
                className="audio-send-remove"
                onClick={() => useTimelineStore.getState().removeTrackAudioSend(trackId, send.id)}
                title="Remove send"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
