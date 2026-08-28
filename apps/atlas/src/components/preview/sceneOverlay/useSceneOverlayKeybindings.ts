import { useEffect } from 'react';
import type {
  PreviewSceneObject,
  SceneGizmoMode,
} from '../sceneObjectOverlayMath';

interface UseSceneOverlayKeybindingsParams {
  enabled: boolean;
  selectedObject: PreviewSceneObject | null;
  onModeChange: (mode: SceneGizmoMode) => void;
}

export function useSceneOverlayKeybindings({
  enabled,
  selectedObject,
  onModeChange,
}: UseSceneOverlayKeybindingsParams): void {
  useEffect(() => {
    if (!enabled || !selectedObject) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.code === 'KeyW') {
        event.preventDefault();
        onModeChange('move');
      } else if (event.code === 'KeyE') {
        event.preventDefault();
        onModeChange('rotate');
      } else if (event.code === 'KeyR') {
        event.preventDefault();
        onModeChange('scale');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onModeChange, selectedObject]);
}
