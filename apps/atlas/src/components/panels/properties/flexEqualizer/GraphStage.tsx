import type { MouseEventHandler, PointerEventHandler, RefObject } from 'react';

interface GraphStageProps {
  ariaLabel: string;
  stageRef: RefObject<HTMLDivElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  handlePointerDown: PointerEventHandler<HTMLCanvasElement>;
  handlePointerMove: PointerEventHandler<HTMLCanvasElement>;
  finishPointer: PointerEventHandler<HTMLCanvasElement>;
  handlePointerLeave: PointerEventHandler<HTMLCanvasElement>;
  handleContextMenu: MouseEventHandler<HTMLCanvasElement>;
}

/** The EQ display: just the graph canvas; the stage is sized by CSS. */
export function GraphStage({
  ariaLabel,
  stageRef,
  canvasRef,
  handlePointerDown,
  handlePointerMove,
  finishPointer,
  handlePointerLeave,
  handleContextMenu,
}: GraphStageProps) {
  return (
    <div ref={stageRef} className="flex-eq-stage">
      <canvas
        ref={canvasRef}
        className="flex-eq-canvas"
        aria-label={ariaLabel}
        role="img"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onPointerLeave={handlePointerLeave}
        onContextMenu={handleContextMenu}
      />
    </div>
  );
}
