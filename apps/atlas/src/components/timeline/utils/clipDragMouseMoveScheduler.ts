interface ClipDragMouseMoveScheduler {
  handleMouseMove: (moveEvent: MouseEvent) => void;
  flushPendingMouseMove: () => void;
  clear: () => void;
}

export function createClipDragMouseMoveScheduler(
  processMouseMove: (moveEvent: MouseEvent) => void,
): ClipDragMouseMoveScheduler {
  let pendingMoveEvent: MouseEvent | null = null;
  let moveAnimationFrameId: number | null = null;

  const cancelPendingMouseMoveFrame = () => {
    if (moveAnimationFrameId !== null) {
      window.cancelAnimationFrame(moveAnimationFrameId);
      moveAnimationFrameId = null;
    }
  };

  const flushPendingMouseMove = () => {
    cancelPendingMouseMoveFrame();
    const moveEvent = pendingMoveEvent;
    pendingMoveEvent = null;
    if (moveEvent) {
      processMouseMove(moveEvent);
    }
  };

  const handleMouseMove = (moveEvent: MouseEvent) => {
    pendingMoveEvent = moveEvent;
    if (moveAnimationFrameId !== null) return;

    moveAnimationFrameId = window.requestAnimationFrame(() => {
      moveAnimationFrameId = null;
      const latestMoveEvent = pendingMoveEvent;
      pendingMoveEvent = null;
      if (latestMoveEvent) {
        processMouseMove(latestMoveEvent);
      }
    });
  };

  return {
    handleMouseMove,
    flushPendingMouseMove,
    clear: () => {
      cancelPendingMouseMoveFrame();
      pendingMoveEvent = null;
    },
  };
}
