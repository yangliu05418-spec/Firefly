import type { SceneVector3 } from '../../engine/scene/types';

export const EDIT_CAMERA_ORTHO_MIN_SCALE = 0.05;
export const EDIT_CAMERA_ORTHO_MAX_SCALE = 10000;

export type EditCameraViewMode = 'camera' | 'front' | 'side' | 'top';
export type EditCameraOrthoViewMode = Exclude<EditCameraViewMode, 'camera'>;

export function getSharedSceneDefaultCameraDistance(fovDegrees: number): number {
  const worldHeight = 2.0;
  const fovRadians = (Math.max(fovDegrees, 1) * Math.PI) / 180;
  return worldHeight / (2 * Math.tan(fovRadians * 0.5));
}

export function cloneSceneVector(vector: SceneVector3): SceneVector3 {
  return { x: vector.x, y: vector.y, z: vector.z };
}

export function addSceneVectors(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleSceneVector(vector: SceneVector3, scale: number): SceneVector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

export function getSceneBoundsCenter(
  bounds: { min: [number, number, number]; max: [number, number, number] } | undefined,
): SceneVector3 {
  if (!bounds) return { x: 0, y: 0, z: 0 };
  return {
    x: (bounds.min[0] + bounds.max[0]) * 0.5,
    y: (bounds.min[1] + bounds.max[1]) * 0.5,
    z: (bounds.min[2] + bounds.max[2]) * 0.5,
  };
}

export function clampEditCameraOrthoScale(scale: number): number {
  if (!Number.isFinite(scale)) return 2;
  return Math.max(EDIT_CAMERA_ORTHO_MIN_SCALE, Math.min(EDIT_CAMERA_ORTHO_MAX_SCALE, scale));
}

export function getEditCameraOrthoBasis(mode: EditCameraOrthoViewMode): {
  eyeDirection: SceneVector3;
  right: SceneVector3;
  up: SceneVector3;
} {
  switch (mode) {
    case 'side':
      return {
        eyeDirection: { x: 1, y: 0, z: 0 },
        right: { x: 0, y: 0, z: -1 },
        up: { x: 0, y: 1, z: 0 },
      };
    case 'top':
      return {
        eyeDirection: { x: 0, y: 1, z: 0 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 0, z: -1 },
      };
    case 'front':
    default:
      return {
        eyeDirection: { x: 0, y: 0, z: 1 },
        right: { x: 1, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      };
  }
}
