import { useCallback, useMemo } from 'react';

import { endBatch, startBatch } from '../../../../stores/historyStore';
import {
  getNextMaskVertexHandleMode,
  inferMaskVertexHandleMode,
} from '../../../../utils/maskVertexHandles';
import type { ClipMask, MaskVertexHandleMode } from "../../../../types/masks";

interface UseMaskVertexHandleInteractionsOptions {
  activeMask: ClipMask | null;
  clipId: string;
  selectedVertexIds: Set<string>;
  setVertexHandleMode: (
    clipId: string,
    maskId: string,
    vertexIds: string[],
    mode: MaskVertexHandleMode,
  ) => void;
}

export function useMaskVertexHandleInteractions({
  activeMask,
  clipId,
  selectedVertexIds,
  setVertexHandleMode,
}: UseMaskVertexHandleInteractionsOptions) {
  const selectedVertices = useMemo(
    () => activeMask?.vertices.filter(vertex => selectedVertexIds.has(vertex.id)) || [],
    [activeMask, selectedVertexIds],
  );
  const selectedHandleMode = useMemo<MaskVertexHandleMode | 'mixed' | null>(() => {
    if (selectedVertices.length === 0) return null;
    const modes = selectedVertices.map(vertex => inferMaskVertexHandleMode(vertex));
    const firstMode = modes[0] ?? 'none';
    return modes.every(mode => mode === firstMode) ? firstMode : 'mixed';
  }, [selectedVertices]);

  const setSelectedHandles = useCallback((mode: MaskVertexHandleMode) => {
    if (!activeMask || selectedVertices.length === 0) return;
    startBatch('Change mask vertex handles');
    setVertexHandleMode(clipId, activeMask.id, selectedVertices.map(vertex => vertex.id), mode);
    endBatch();
  }, [activeMask, clipId, selectedVertices, setVertexHandleMode]);

  const cycleSelectedHandles = useCallback(() => {
    if (!selectedHandleMode || selectedHandleMode === 'mixed') {
      setSelectedHandles('mirrored');
      return;
    }
    setSelectedHandles(getNextMaskVertexHandleMode(selectedHandleMode));
  }, [selectedHandleMode, setSelectedHandles]);

  return {
    cycleSelectedHandles,
    selectedHandleMode,
    selectedVertices,
    setSelectedHandles,
  };
}
