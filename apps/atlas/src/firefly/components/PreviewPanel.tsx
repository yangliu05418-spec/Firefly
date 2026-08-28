import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AtlasAsset, AtlasClip, AtlasDocument, AtlasTrack, TransitionKind } from '../model';
import { documentDuration } from '../model';
import { useI18n } from '../i18n';
import { Icon } from './Icon';

type PreviewLayer = { asset: AtlasAsset; clip: AtlasClip; track: AtlasTrack; role: 'single' | 'outgoing' | 'incoming'; transition: TransitionKind; transitionDuration: number; progress: number };
export interface PreviewState { visualLayers: PreviewLayer[]; audio: Array<{ asset: AtlasAsset; clip: AtlasClip; track: AtlasTrack }> }
export interface PreviewPanelProps {
  document?: AtlasDocument;
  asset?: AtlasAsset;
  clip?: AtlasClip;
  playhead: number;
  playing?: boolean;
  onPlayingChange?: (playing: boolean) => void;
  onPlayheadChange?: (time: number) => void;
}

const contains = (clip: AtlasClip, time: number) => time >= clip.startTime && time < clip.startTime + clip.duration;

export function resolvePreviewState(document: AtlasDocument, playhead: number): PreviewState {
  const assets = new Map(document.assets.map((asset) => [asset.id, asset]));
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  const visual = document.clips
    .filter((clip) => tracks.get(clip.trackId)?.kind === 'video' && contains(clip, playhead))
    .sort((left, right) => document.tracks.findIndex((track) => track.id === left.trackId) - document.tracks.findIndex((track) => track.id === right.trackId))
    .at(-1);
  const visualAsset = visual ? assets.get(visual.assetId) : undefined;
  const visualTrack = visual ? tracks.get(visual.trackId) : undefined;
  let visualLayers: PreviewLayer[] = visual && visualAsset && visualTrack ? [{ asset: visualAsset, clip: visual, track: visualTrack, role: 'single', transition: 'none', transitionDuration: 0, progress: 1 }] : [];

  const transitionDuration = visual?.transitionDuration ?? 0;
  const elapsed = visual ? playhead - visual.startTime : Infinity;
  if (visual && visualAsset && visual.transitionIn !== 'none' && visual.transitionFromClipId && transitionDuration > 0 && elapsed < transitionDuration) {
    const outgoing = document.clips.find((clip) => clip.id === visual.transitionFromClipId && clip.trackId === visual.trackId);
    const outgoingAsset = outgoing ? assets.get(outgoing.assetId) : undefined;
    if (outgoing && outgoingAsset && Math.abs(outgoing.startTime + outgoing.duration - visual.startTime) <= 0.01) {
      const progress = Math.max(0, Math.min(1, elapsed / transitionDuration));
      visualLayers = [
        { asset: outgoingAsset, clip: outgoing, track: visualTrack!, role: 'outgoing', transition: visual.transitionIn, transitionDuration, progress },
        { asset: visualAsset, clip: visual, track: visualTrack!, role: 'incoming', transition: visual.transitionIn, transitionDuration, progress },
      ];
    }
  }

  const audio = document.clips.flatMap((clip) => {
    const track = tracks.get(clip.trackId);
    const item = assets.get(clip.assetId);
    return track?.kind === 'audio' && item && contains(clip, playhead) ? [{ asset: item, clip, track }] : [];
  });
  return { visualLayers, audio };
}

function layerStyle(layer: PreviewLayer): CSSProperties {
  const { clip, role, transition, progress } = layer;
  let opacity = clip.transform.opacity;
  let clipPath: string | undefined;
  if (role === 'outgoing' && transition === 'crossfade') opacity *= 1 - progress;
  if (role === 'incoming' && transition === 'crossfade') opacity *= progress;
  if (transition === 'dip-black') opacity *= role === 'outgoing' ? Math.max(0, 1 - progress * 2) : Math.max(0, progress * 2 - 1);
  if (role === 'incoming' && transition.startsWith('wipe-')) {
    if (transition === 'wipe-left') clipPath = `inset(0 ${100 - progress * 100}% 0 0)`;
    if (transition === 'wipe-right') clipPath = `inset(0 0 0 ${100 - progress * 100}%)`;
    if (transition === 'wipe-up') clipPath = `inset(0 0 ${100 - progress * 100}% 0)`;
    if (transition === 'wipe-down') clipPath = `inset(${100 - progress * 100}% 0 0 0)`;
  }
  return {
    transform: `translate(${clip.transform.x}px, ${clip.transform.y}px) rotate(${clip.transform.rotation}deg) scale(${clip.transform.scaleX}, ${clip.transform.scaleY})`,
    opacity, clipPath, zIndex: role === 'incoming' ? 2 : 1,
  };
}

function VisualLayer({ layer, playhead, playing, onDecodeError }: { layer: PreviewLayer; playhead: number; playing: boolean; onDecodeError: (failed: boolean) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const source = layer.asset.objectUrl ?? layer.asset.mediaUrl;
  const desiredTime = layer.role === 'outgoing'
    ? layer.clip.outPoint - layer.transitionDuration + layer.transitionDuration * layer.progress
    : playhead - layer.clip.startTime + layer.clip.inPoint;
  useEffect(() => {
    const media = ref.current;
    if (!media || !source) return;
    if (Math.abs(media.currentTime - desiredTime) > 0.12) {
      try { media.currentTime = Math.max(layer.clip.inPoint, Math.min(layer.clip.outPoint, desiredTime)); } catch { /* metadata pending */ }
    }
    media.muted = layer.track.muted || layer.clip.muted || layer.role === 'outgoing';
    media.volume = Math.max(0, Math.min(1, layer.clip.volume));
    if (playing) void media.play().catch(() => undefined);
    else media.pause();
  }, [desiredTime, layer.clip.inPoint, layer.clip.muted, layer.clip.outPoint, layer.clip.volume, layer.role, layer.track.muted, playing, source]);
  if (!source) return null;
  const style = layerStyle(layer);
  return layer.asset.kind === 'image'
    ? <img className="atlas-preview__layer" src={source} alt={layer.asset.name} style={style} />
    : <video className="atlas-preview__layer" ref={ref} src={source} playsInline preload="metadata" style={style} onCanPlay={() => onDecodeError(false)} onError={() => onDecodeError(true)} />;
}

function AudioLayer({ item, playhead, playing }: { item: PreviewState['audio'][number]; playhead: number; playing: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const source = item.asset.objectUrl ?? item.asset.mediaUrl;
  const desiredTime = playhead - item.clip.startTime + item.clip.inPoint;
  useEffect(() => {
    const audio = ref.current;
    if (!audio || !source) return;
    audio.muted = item.track.muted || item.clip.muted;
    audio.volume = Math.max(0, Math.min(1, item.clip.volume));
    if (Math.abs(audio.currentTime - desiredTime) > 0.12) {
      try { audio.currentTime = Math.max(item.clip.inPoint, Math.min(item.clip.outPoint, desiredTime)); } catch { /* metadata pending */ }
    }
    if (playing) void audio.play().catch(() => undefined);
    else audio.pause();
  }, [desiredTime, item.clip.inPoint, item.clip.muted, item.clip.outPoint, item.clip.volume, item.track.muted, playing, source]);
  return source ? <audio ref={ref} src={source} preload="metadata" /> : null;
}

export function PreviewPanel({ document, asset, clip, playhead, playing = false, onPlayingChange, onPlayheadChange }: PreviewPanelProps) {
  const { t } = useI18n();
  const [decodeError, setDecodeError] = useState(false);
  const frame = useMemo(() => {
    const resolved = document ? resolvePreviewState(document, playhead) : { visualLayers: [], audio: [] };
    if (resolved.visualLayers.length || resolved.audio.length || !asset) return resolved;
    const duration = Math.max(0.1, asset.duration || (asset.kind === 'image' ? 5 : 10));
    const fallbackClip: AtlasClip = clip ?? {
      id: `preview:${asset.id}`, assetId: asset.id, trackId: `preview:${asset.kind}`, name: asset.name,
      startTime: 0, duration, inPoint: 0, outPoint: duration, volume: 1, muted: false,
      transitionIn: 'none', transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 },
    };
    const fallbackTrack: AtlasTrack = { id: fallbackClip.trackId, name: asset.name, kind: asset.kind === 'audio' ? 'audio' : 'video', muted: false, locked: false };
    return asset.kind === 'audio'
      ? { visualLayers: [], audio: [{ asset, clip: fallbackClip, track: fallbackTrack }] }
      : { visualLayers: [{ asset, clip: fallbackClip, track: fallbackTrack, role: 'single' as const, transition: 'none' as const, transitionDuration: 0, progress: 1 }], audio: [] };
  }, [asset, clip, document, playhead]);
  const timelineDuration = document ? documentDuration(document) : 0;
  const duration = timelineDuration || frame.visualLayers[0]?.clip.duration || frame.audio[0]?.clip.duration || 0;
  const primary = frame.visualLayers.at(-1)?.asset ?? asset;
  const lastFrame = useRef<number | null>(null);
  const playheadRef = useRef(playhead);
  playheadRef.current = playhead;

  useEffect(() => setDecodeError(false), [primary?.id, primary?.objectUrl, primary?.mediaUrl]);

  useEffect(() => {
    if (!playing || !onPlayheadChange) return;
    let frameId = 0;
    const tick = (now: number) => {
      const previous = lastFrame.current ?? now;
      lastFrame.current = now;
      const next = Math.min(duration, playheadRef.current + (now - previous) / 1000);
      onPlayheadChange(next);
      if (next >= duration) onPlayingChange?.(false);
      else frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frameId); lastFrame.current = null; };
  }, [duration, onPlayheadChange, onPlayingChange, playing]);

  return (
    <section className="atlas-preview" aria-label={t('preview.title')}>
      <header className="atlas-panel-heading atlas-panel-heading--overlay"><div><span className="atlas-panel-heading__index">02</span><h2>{t('preview.title')}</h2></div>{primary && <span>{primary.width && primary.height ? `${primary.width}×${primary.height}` : primary.kind.toUpperCase()}</span>}</header>
      <div className={`atlas-preview__stage${frame.visualLayers.length > 1 ? ' is-transitioning' : ''}`}>
        {!frame.visualLayers.length ? <div className="atlas-preview__empty"><span><Icon name={frame.audio.length ? 'audio' : 'play'} /></span><h2>{frame.audio[0]?.asset.name ?? t('preview.emptyTitle')}</h2><p>{frame.audio.length ? t('media.audio') : t('preview.emptyBody')}</p></div>
          : frame.visualLayers.map((layer) => <VisualLayer key={`${layer.clip.id}:${layer.role}`} layer={layer} playhead={playhead} playing={playing} onDecodeError={setDecodeError} />)}
        {frame.audio.map((item) => <AudioLayer key={item.clip.id} item={item} playhead={playhead} playing={playing} />)}
        {frame.visualLayers.length > 1 && <span className="atlas-preview__transition-badge">{t('preview.transitioning')}</span>}
        {decodeError && <div className="atlas-preview__decode-error" role="alert"><Icon name="warning" /><strong>{t('preview.unsupported')}</strong>{(primary?.mediaUrl || primary?.objectUrl) && <a className="atlas-button atlas-button--quiet" href={primary.mediaUrl ?? primary.objectUrl} target="_blank" rel="noreferrer">{t('preview.downloadOriginal')}</a>}</div>}
      </div>
      <footer className="atlas-preview__footer"><span>{primary?.name ?? '—'}</span><div className="atlas-preview__transport">
        <button type="button" className="atlas-icon-button" disabled={!duration || !onPlayingChange} onClick={() => onPlayingChange?.(!playing)} aria-label={playing ? t('preview.pause') : t('preview.play')}><Icon name={playing ? 'pause' : 'play'} /></button>
        <span className="atlas-timecode">{playhead.toFixed(2)}s</span>
      </div></footer>
    </section>
  );
}
