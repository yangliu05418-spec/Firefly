import type { Dispatch } from 'react';
import type { AtlasClip, TransitionKind } from '../model';
import type { EditorAction } from '../timeline';
import { useI18n, type MessageKey } from '../i18n';
import { Icon } from './Icon';

const transitions: Array<{ value: TransitionKind; label: MessageKey }> = [
  { value: 'none', label: 'inspector.transitionNone' },
  { value: 'crossfade', label: 'inspector.crossfade' },
  { value: 'wipe-left', label: 'inspector.wipeLeft' },
  { value: 'wipe-right', label: 'inspector.wipeRight' },
  { value: 'wipe-up', label: 'inspector.wipeUp' },
  { value: 'wipe-down', label: 'inspector.wipeDown' },
  { value: 'dip-black', label: 'inspector.dipBlack' },
];

export function InspectorPanel({ clip, dispatch, readOnly }: { clip?: AtlasClip; dispatch: Dispatch<EditorAction>; readOnly: boolean }) {
  const { t } = useI18n();
  return (
    <aside className="atlas-inspector" aria-label={t('inspector.title')}>
      <header className="atlas-panel-heading"><div><span className="atlas-panel-heading__index">04</span><h2>{t('inspector.title')}</h2></div></header>
      {!clip ? <div className="atlas-panel-empty"><Icon name="track" /><span>{t('inspector.noSelection')}</span></div> : (
        <div className="atlas-inspector__form">
          <div className="atlas-inspector__clip"><span>{clip.name.slice(0, 1).toUpperCase()}</span><div><strong>{clip.name}</strong><small>{clip.duration.toFixed(2)}s</small></div></div>
          <fieldset disabled={readOnly}>
            <legend>{t('inspector.trim')}</legend>
            <div className="atlas-field-row">
              <label className="atlas-field"><span>{t('inspector.start')}</span><input type="number" min="0" step="0.1" value={clip.inPoint} onChange={(event) => dispatch({ type: 'update-trim', clipId: clip.id, inPoint: Number(event.target.value), outPoint: clip.outPoint })} /></label>
              <label className="atlas-field"><span>{t('inspector.end')}</span><input type="number" min="0.1" step="0.1" value={clip.outPoint} onChange={(event) => dispatch({ type: 'update-trim', clipId: clip.id, inPoint: clip.inPoint, outPoint: Number(event.target.value) })} /></label>
            </div>
          </fieldset>
          <fieldset disabled={readOnly}>
            <legend>{t('inspector.volume')}</legend>
            <label className="atlas-range"><input type="range" min="0" max="4" step="0.01" value={clip.volume} onChange={(event) => dispatch({ type: 'update-volume', clipId: clip.id, volume: Number(event.target.value) })} /><output>{Math.round(clip.volume * 100)}%</output></label>
            <button className={`atlas-button atlas-button--quiet${clip.muted ? ' is-active' : ''}`} type="button" onClick={() => dispatch({ type: 'toggle-clip-muted', clipId: clip.id })}><Icon name={clip.muted ? 'mute' : 'volume'} />{clip.muted ? t('timeline.unmute') : t('timeline.mute')}</button>
          </fieldset>
          <fieldset disabled={readOnly}>
            <legend>{t('inspector.transform')}</legend>
            <div className="atlas-field-row">
              <label className="atlas-field"><span>{t('inspector.position')} X</span><input type="number" step="1" value={clip.transform.x} onChange={(event) => dispatch({ type: 'update-transform', clipId: clip.id, patch: { x: Number(event.target.value) } })} /></label>
              <label className="atlas-field"><span>{t('inspector.position')} Y</span><input type="number" step="1" value={clip.transform.y} onChange={(event) => dispatch({ type: 'update-transform', clipId: clip.id, patch: { y: Number(event.target.value) } })} /></label>
            </div>
            <div className="atlas-field-row">
              <label className="atlas-field"><span>{t('inspector.scale')}</span><input type="number" min="0.01" max="10" step="0.05" value={clip.transform.scaleX} onChange={(event) => { const scale = Number(event.target.value); dispatch({ type: 'update-transform', clipId: clip.id, patch: { scaleX: scale, scaleY: scale } }); }} /></label>
              <label className="atlas-field"><span>{t('inspector.rotation')}</span><input type="number" step="1" value={clip.transform.rotation} onChange={(event) => dispatch({ type: 'update-transform', clipId: clip.id, patch: { rotation: Number(event.target.value) } })} /></label>
            </div>
          </fieldset>
          <label className="atlas-field"><span>{t('inspector.transition')}</span><select value={clip.transitionIn} disabled={readOnly} onChange={(event) => dispatch({ type: 'set-transition', clipId: clip.id, transition: event.target.value as TransitionKind })}>{transitions.map((transition) => <option key={transition.value} value={transition.value}>{t(transition.label)}</option>)}</select></label>
        </div>
      )}
    </aside>
  );
}
