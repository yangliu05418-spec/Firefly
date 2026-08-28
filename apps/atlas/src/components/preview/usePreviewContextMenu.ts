import { useCallback, type MouseEvent as ReactMouseEvent } from 'react';

interface UsePreviewContextMenuOptions {
  editCameraOrthoViewActive: boolean;
  isCanvasInteractionTarget: (target: EventTarget | null) => boolean;
  sceneNavEnabled: boolean;
}

interface PreviewContextMenuHandlers {
  handleAuxClick: (event: ReactMouseEvent) => void;
  handleContextMenu: (event: ReactMouseEvent) => void;
}

export function usePreviewContextMenu({
  editCameraOrthoViewActive,
  isCanvasInteractionTarget,
  sceneNavEnabled,
}: UsePreviewContextMenuOptions): PreviewContextMenuHandlers {
  const shouldSuppressBrowserAction = useCallback(
    (target: EventTarget | null) => (
      (sceneNavEnabled || editCameraOrthoViewActive) &&
      isCanvasInteractionTarget(target)
    ),
    [editCameraOrthoViewActive, isCanvasInteractionTarget, sceneNavEnabled],
  );

  const handleContextMenu = useCallback((event: ReactMouseEvent) => {
    if (shouldSuppressBrowserAction(event.target)) {
      event.preventDefault();
    }
  }, [shouldSuppressBrowserAction]);

  const handleAuxClick = useCallback((event: ReactMouseEvent) => {
    if (shouldSuppressBrowserAction(event.target)) {
      event.preventDefault();
    }
  }, [shouldSuppressBrowserAction]);

  return {
    handleAuxClick,
    handleContextMenu,
  };
}
