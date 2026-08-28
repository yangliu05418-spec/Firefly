import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type AtlasAsset, type AtlasClip } from '../model';
import { resolvePreviewState } from './PreviewPanel';

const transform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1 };
const asset = (id: string, kind: AtlasAsset['kind'] = 'video'): AtlasAsset => ({
  id, name: id, kind, mimeType: kind === 'audio' ? 'audio/mpeg' : 'video/mp4', size: 1, duration: 10, status: 'ready', source: 'firefly', mediaUrl: `/media/${id}`,
});
const clip = (id: string, assetId: string, trackId: string, startTime: number): AtlasClip => ({
  id, assetId, trackId, name: id, startTime, duration: 5, inPoint: 0, outPoint: 5, volume: .7, muted: false, transitionIn: 'none', transform,
});

describe('preview timeline resolver', () => {
  it('switches visual clips continuously at the playhead and includes active audio', () => {
    const document = createEmptyDocument('project', '片场');
    const videoTrack = document.tracks.find((track) => track.kind === 'video')!;
    const audioTrack = document.tracks.find((track) => track.kind === 'audio')!;
    const first = clip('first', 'a', videoTrack.id, 0);
    const second = clip('second', 'b', videoTrack.id, 5);
    const bed = { ...clip('bed', 'sound', audioTrack.id, 0), duration: 10, outPoint: 10 };
    document.assets = [asset('a'), asset('b'), asset('sound', 'audio')];
    document.clips = [first, second, bed];
    expect(resolvePreviewState(document, 4.9).visualLayers.at(-1)?.clip.id).toBe('first');
    const next = resolvePreviewState(document, 5.1);
    expect(next.visualLayers.at(-1)?.clip.id).toBe('second');
    expect(next.audio[0]?.clip.id).toBe('bed');
  });

  it('returns outgoing and incoming layers only during a valid transition window', () => {
    const document = createEmptyDocument('project', '片场');
    const track = document.tracks.find((item) => item.kind === 'video')!;
    const first = clip('first', 'a', track.id, 0);
    const second = { ...clip('second', 'b', track.id, 5), transitionIn: 'wipe-left' as const, transitionFromClipId: 'first', transitionDuration: 1 };
    document.assets = [asset('a'), asset('b')];
    document.clips = [first, second];
    const transition = resolvePreviewState(document, 5.25);
    expect(transition.visualLayers.map((layer) => layer.role)).toEqual(['outgoing', 'incoming']);
    expect(transition.visualLayers[1]?.progress).toBe(.25);
    expect(resolvePreviewState(document, 6.1).visualLayers).toHaveLength(1);
  });
});
