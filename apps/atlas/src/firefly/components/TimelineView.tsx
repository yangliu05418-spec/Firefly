import { useMemo, type Dispatch } from 'react';
import { documentDuration, type AtlasDocument } from '../model';
import type { EditorAction } from '../timeline';
import { formatTimecode } from '../media';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

const PIXELS_PER_SECOND = 28;

export function TimelineView({ document, selectedClipId, onSelectClip, dispatch, readOnly, playhead, onPlayheadChange }: {
  document: AtlasDocument;
  selectedClipId: string | null;
  onSelectClip: (clipId: string | null) => void;
  dispatch: Dispatch<EditorAction>;
  readOnly: boolean;
  playhead?: number;
  onPlayheadChange?: (time: number) => void;
}) {
  const { t } = useI18n();
  const currentPlayhead = playhead ?? document.playhead;
  const duration = Math.max(30, Math.ceil(documentDuration(document) + 2));
  const canvasWidth = Math.max(900, duration * PIXELS_PER_SECOND);
  const rulerTicks = useMemo(() => Array.from({ length: Math.ceil(duration / 5) + 1 }, (_, index) => index * 5), [duration]);

  const handleLaneDrop = (event: React.DragEvent<HTMLDivElement>, trackId: string) => {
    event.preventDefault();
    const track = document.tracks.find((candidate) => candidate.id === trackId);
    if (readOnly || !track || track.locked) return;
    const payload = event.dataTransfer.getData('text/plain');
    const bounds = event.currentTarget.getBoundingClientRect();
    const startTime = Math.max(0, (event.clientX - bounds.left) / PIXELS_PER_SECOND);
    if (payload.startsWith('asset:')) dispatch({ type: 'add-clip', assetId: payload.slice(6), trackId, startTime });
    if (payload.startsWith('clip:')) dispatch({ type: 'move-clip', clipId: payload.slice(5), trackId, startTime });
  };

  return (
    <section className="atlas-timeline" aria-label={t('timeline.title')}>
      <header className="atlas-timeline__toolbar">
        <div className="atlas-panel-heading"><div><span className="atlas-panel-heading__index">03</span><h2>{t('timeline.title')}</h2></div><span className="atlas-timecode">{formatTimecode(currentPlayhead)}</span></div>
        <div className="atlas-toolbar-group">
          <button className="atlas-icon-button" type="button" disabled={readOnly} onClick={() => dispatch({ type: 'undo' })} aria-label={t('workspace.undo')}><Icon name="undo" /></button>
          <button className="atlas-icon-button" type="button" disabled={readOnly} onClick={() => dispatch({ type: 'redo' })} aria-label={t('workspace.redo')}><Icon name="redo" /></button>
          <span className="atlas-toolbar-separator" />
          <button className="atlas-button atlas-button--quiet" type="button" disabled={readOnly || !selectedClipId} onClick={() => selectedClipId && dispatch({ type: 'split-clip', clipId: selectedClipId, time: currentPlayhead })}><Icon name="scissors" />{t('timeline.split')}</button>
          <button className="atlas-icon-button atlas-icon-button--danger" type="button" disabled={readOnly || !selectedClipId} onClick={() => selectedClipId && dispatch({ type: 'delete-clip', clipId: selectedClipId })} aria-label={t('timeline.delete')}><Icon name="trash" /></button>
          <span className="atlas-toolbar-separator" />
          <button className="atlas-button atlas-button--quiet" type="button" disabled={readOnly} onClick={() => dispatch({ type: 'add-track', kind: 'video' })}><Icon name="plus" />{t('timeline.videoTrack')}</button>
          <button className="atlas-button atlas-button--quiet" type="button" disabled={readOnly} onClick={() => dispatch({ type: 'add-track', kind: 'audio' })}><Icon name="plus" />{t('timeline.audioTrack')}</button>
        </div>
      </header>
      <div className="atlas-timeline__body">
        <div className="atlas-track-labels">
          <div className="atlas-track-labels__ruler" />
          {document.tracks.map((track) => (
            <div className="atlas-track-label" key={track.id}>
              <Icon name={track.kind === 'video' ? 'video' : 'audio'} />
              <span title={track.name}>{track.name}</span>
              <button className={`atlas-icon-button${track.muted ? ' is-active' : ''}`} type="button" disabled={readOnly} onClick={() => dispatch({ type: 'toggle-track-muted', trackId: track.id })} aria-label={track.muted ? t('timeline.unmute') : t('timeline.mute')}><Icon name={track.muted ? 'mute' : 'volume'} /></button>
              <button className={`atlas-icon-button${track.locked ? ' is-active' : ''}`} type="button" disabled={readOnly} onClick={() => dispatch({ type: 'toggle-track-locked', trackId: track.id })} aria-label={track.locked ? t('timeline.unlock') : t('timeline.lock')} title={track.locked ? t('timeline.locked') : undefined}><Icon name={track.locked ? 'lock' : 'unlock'} /></button>
            </div>
          ))}
        </div>
        <div className="atlas-timeline__scroll">
          <div className="atlas-timeline__canvas" style={{ width: canvasWidth }}>
            <button
              className="atlas-timeline__ruler"
              type="button"
              aria-label={t('timeline.playhead')}
              onClick={(event) => {
                const bounds = event.currentTarget.getBoundingClientRect();
                const next = Math.min(duration, Math.max(0, (event.clientX - bounds.left) / PIXELS_PER_SECOND));
                if (onPlayheadChange) onPlayheadChange(next);
                else dispatch({ type: 'set-playhead', time: next });
              }}
            >
              {rulerTicks.map((tick) => <span key={tick} style={{ left: tick * PIXELS_PER_SECOND }}>{formatTimecode(tick)}</span>)}
            </button>
            <div className="atlas-timeline__playhead" style={{ left: currentPlayhead * PIXELS_PER_SECOND }} aria-hidden="true"><i /></div>
            {document.tracks.map((track) => {
              const clips = document.clips.filter((clip) => clip.trackId === track.id).sort((a, b) => a.startTime - b.startTime);
              return (
                <div className={`atlas-track-lane${track.locked ? ' is-locked' : ''}`} key={track.id} onDragOver={(event) => { if (!readOnly && !track.locked) event.preventDefault(); }} onDrop={(event) => handleLaneDrop(event, track.id)}>
                  {!clips.length && <span className="atlas-track-lane__empty">{t('timeline.empty')}</span>}
                  {clips.map((clip) => (
                    <button
                      className={`atlas-timeline-clip atlas-timeline-clip--${track.kind}${selectedClipId === clip.id ? ' is-selected' : ''}`}
                      key={clip.id}
                      type="button"
                      draggable={!readOnly && !track.locked}
                      onDragStart={(event) => {
                        if (readOnly || track.locked) { event.preventDefault(); return; }
                        event.dataTransfer.setData('text/plain', `clip:${clip.id}`);
                      }}
                      onClick={() => onSelectClip(clip.id)}
                      style={{ left: clip.startTime * PIXELS_PER_SECOND, width: Math.max(50, clip.duration * PIXELS_PER_SECOND) }}
                      aria-label={`${t('timeline.clip')}：${clip.name}`}
                    >
                      <span>{clip.name}</span>
                      <small>{clip.duration.toFixed(1)}s</small>
                      {clip.transitionIn !== 'none' && <i className="atlas-timeline-clip__transition" />}
                      {(clip.muted || track.muted) && <Icon name="mute" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
