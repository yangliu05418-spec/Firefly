import { useTimelineStore } from '../../../../stores/timeline';
import type { FixtureTimelineClip } from './clipSegments';

type TimelineStoreState = ReturnType<typeof useTimelineStore.getState>;
type AnimatableProperty = Parameters<TimelineStoreState['addKeyframe']>[1];
type ClipMask = NonNullable<FixtureTimelineClip['masks']>[number];
type MaskVertex = ClipMask['vertices'][number];

export function updateClipVisuals(clipId: string, updates: Partial<FixtureTimelineClip>): void {
  useTimelineStore.getState().updateClip(clipId, updates);
  useTimelineStore.getState().invalidateCache();
}

export function addEffect(clipId: string, type: string, params: Record<string, string | number | boolean>): string {
  const timelineStore = useTimelineStore.getState();
  const effectId = timelineStore.addClipEffect(clipId, type);
  timelineStore.updateClipEffect(clipId, effectId, params);
  return effectId;
}

export function addNumericKeyframes(
  clipId: string,
  property: AnimatableProperty,
  values: Array<{ time: number; value: number; easing?: string }>
): void {
  const timelineStore = useTimelineStore.getState();
  for (const entry of values) {
    timelineStore.addKeyframe(clipId, property, entry.value, entry.time, entry.easing ?? 'ease-in-out');
  }
}

function createMaskVertex(x: number, y: number, suffix: string): MaskVertex {
  return {
    id: `fixture-vertex-${Date.now()}-${suffix}-${Math.random().toString(36).slice(2, 6)}`,
    x,
    y,
    handleIn: { x: 0, y: 0 },
    handleOut: { x: 0, y: 0 },
    handleMode: 'none',
  };
}

export function addPolygonMask(
  clipId: string,
  name: string,
  points: Array<{ x: number; y: number }>,
  options?: Partial<Pick<ClipMask, 'feather' | 'featherQuality' | 'opacity' | 'mode' | 'position' | 'inverted'>>
): string {
  const vertices = points.map((point, index) => createMaskVertex(point.x, point.y, `${index}`));
  const maskId = useTimelineStore.getState().addMask(clipId, {
    name,
    vertices,
    closed: true,
    visible: true,
    enabled: true,
    feather: options?.feather ?? 18,
    featherQuality: options?.featherQuality ?? 70,
    opacity: options?.opacity ?? 1,
    mode: options?.mode ?? 'add',
    position: options?.position ?? { x: 0, y: 0 },
    inverted: options?.inverted ?? false,
  });
  useTimelineStore.getState().invalidateCache();
  return maskId;
}
