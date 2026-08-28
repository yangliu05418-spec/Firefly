import type { Composition, MediaState } from '../../types';
import type { Keyframe } from '../../../../types/keyframes';
import { useTimelineStore } from '../../../timeline';

/**
 * Adjust clip transforms when a composition is resized so content stays at
 * the same pixel position (more canvas space around it, no scaling).
 */
export function adjustClipTransformsOnResize(
  get: () => MediaState,
  compId: string,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  updates: Partial<Composition>,
): void {
  const scaleX = oldW / newW;
  const scaleY = oldH / newH;

  const { activeCompositionId } = get();

  if (compId === activeCompositionId) {
    const timelineStore = useTimelineStore.getState();
    const { clips, clipKeyframes } = timelineStore;

    const updatedClips = clips.map(clip => ({
      ...clip,
      transform: {
        ...clip.transform,
        position: {
          x: clip.transform.position.x * scaleX,
          y: clip.transform.position.y * scaleY,
          z: clip.transform.position.z,
        },
        scale: {
          x: clip.transform.scale.x * scaleX,
          y: clip.transform.scale.y * scaleY,
        },
      },
    }));

    const updatedKeyframes = new Map<string, Keyframe[]>();
    clipKeyframes.forEach((keyframes: Keyframe[], clipId: string) => {
      updatedKeyframes.set(clipId, keyframes.map(kf => {
        if (kf.property === 'position.x' || kf.property === 'scale.x') {
          return { ...kf, value: kf.value * scaleX };
        }
        if (kf.property === 'position.y' || kf.property === 'scale.y') {
          return { ...kf, value: kf.value * scaleY };
        }
        return kf;
      }));
    });

    useTimelineStore.setState({ clips: updatedClips, clipKeyframes: updatedKeyframes });
  } else {
    const comp = get().compositions.find(c => c.id === compId);
    if (!comp?.timelineData) return;

    const updatedClips = comp.timelineData.clips.map(clip => ({
      ...clip,
      transform: {
        ...clip.transform,
        position: {
          x: clip.transform.position.x * scaleX,
          y: clip.transform.position.y * scaleY,
          z: clip.transform.position.z,
        },
        scale: {
          x: clip.transform.scale.x * scaleX,
          y: clip.transform.scale.y * scaleY,
        },
      },
      keyframes: clip.keyframes?.map(kf => {
        if (kf.property === 'position.x' || kf.property === 'scale.x') {
          return { ...kf, value: kf.value * scaleX };
        }
        if (kf.property === 'position.y' || kf.property === 'scale.y') {
          return { ...kf, value: kf.value * scaleY };
        }
        return kf;
      }),
    }));

    updates.timelineData = { ...comp.timelineData, clips: updatedClips };
  }
}
