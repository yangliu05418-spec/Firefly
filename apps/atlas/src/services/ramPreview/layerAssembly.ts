import type { Layer } from '../../types/layers';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';

export function sortRamPreviewLayersByTrackOrder(
  layers: Layer[],
  clipsAtTime: TimelineClip[],
  videoTracks: TimelineTrack[]
): void {
  const trackOrder = new Map(videoTracks.map((track, index) => [track.id, index]));
  layers.sort((a, b) => {
    const clipA = clipsAtTime.find((clip) => clip.id === a.id);
    const clipB = clipsAtTime.find((clip) => clip.id === b.id);
    const orderA = clipA ? (trackOrder.get(clipA.trackId) ?? 0) : 0;
    const orderB = clipB ? (trackOrder.get(clipB.trackId) ?? 0) : 0;
    return orderA - orderB;
  });
}

export function clipToRamPreviewLayer(
  clip: TimelineClip,
  source: Layer['source'],
  idOverride?: string
): Layer {
  const pos = clip.transform?.position ?? { x: 0, y: 0, z: 0 };
  const scl = clip.transform?.scale ?? { x: 1, y: 1 };
  const rot = clip.transform?.rotation ?? { x: 0, y: 0, z: 0 };

  return {
    id: idOverride ?? clip.id,
    name: clip.name,
    visible: true,
    opacity: clip.transform?.opacity ?? 1,
    blendMode: clip.transform?.blendMode ?? 'normal',
    source,
    effects: clip.effects || [],
    position: { x: pos.x, y: pos.y, z: pos.z },
    scale: { x: scl.x, y: scl.y },
    rotation: degreesToRadians(rot),
  };
}

function degreesToRadians(deg: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const f = Math.PI / 180;
  return { x: deg.x * f, y: deg.y * f, z: deg.z * f };
}
