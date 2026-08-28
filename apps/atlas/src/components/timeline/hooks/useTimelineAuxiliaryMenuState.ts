import { useCallback, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { InOutContextMenuState, InOutPointType } from '../InOutContextMenu';
import type { MarkerContextMenuState } from '../MarkerContextMenu';
import type { TrackContextMenuState } from '../TrackContextMenu';
import { useClipContextMenu } from '../useClipContextMenu';
import type {
  ContextMenuState,
  TimelineEmptyContextMenuState,
} from '../types';

interface UseTimelineAuxiliaryMenuStateProps {
  selectedClipIds: Set<string>;
  selectClip: (clipId: string) => void;
  isExporting: boolean;
  setInPoint: (time: number | null) => void;
  setOutPoint: (time: number | null) => void;
}

export function useTimelineAuxiliaryMenuState({
  selectedClipIds,
  selectClip,
  isExporting,
  setInPoint,
  setOutPoint,
}: UseTimelineAuxiliaryMenuStateProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [emptyContextMenu, setEmptyContextMenu] =
    useState<TimelineEmptyContextMenuState | null>(null);
  const [trackContextMenu, setTrackContextMenu] =
    useState<TrackContextMenuState | null>(null);
  const [markerContextMenu, setMarkerContextMenu] =
    useState<MarkerContextMenuState | null>(null);
  const [inOutContextMenu, setInOutContextMenu] =
    useState<InOutContextMenuState | null>(null);
  const [multicamDialogOpen, setMulticamDialogOpen] = useState(false);

  const setClipContextMenu = useCallback((menu: ContextMenuState | null) => {
    setEmptyContextMenu(null);
    setContextMenu(menu);
  }, []);

  const openClipContextMenu = useClipContextMenu(
    selectedClipIds,
    selectClip,
    setClipContextMenu,
  );

  const closeTimelineContextMenus = useCallback(() => {
    setContextMenu(null);
    setEmptyContextMenu(null);
    setTrackContextMenu(null);
    setMarkerContextMenu(null);
    setInOutContextMenu(null);
  }, []);

  const handleInOutMarkerContextMenu = useCallback((
    event: ReactMouseEvent,
    type: InOutPointType,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (isExporting) return;

    closeTimelineContextMenus();
    setInOutContextMenu({
      x: event.clientX,
      y: event.clientY,
      type,
    });
  }, [closeTimelineContextMenus, isExporting]);

  const handleTimelineMarkerContextMenu = useCallback((
    event: ReactMouseEvent,
    markerId: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    closeTimelineContextMenus();
    setMarkerContextMenu({
      x: event.clientX,
      y: event.clientY,
      markerId,
    });
  }, [closeTimelineContextMenus]);

  const handleDeleteInOutPoint = useCallback((type: InOutPointType) => {
    if (type === 'in') {
      setInPoint(null);
    } else {
      setOutPoint(null);
    }
  }, [setInPoint, setOutPoint]);

  return {
    contextMenu,
    setContextMenu,
    emptyContextMenu,
    setEmptyContextMenu,
    trackContextMenu,
    setTrackContextMenu,
    markerContextMenu,
    setMarkerContextMenu,
    inOutContextMenu,
    setInOutContextMenu,
    multicamDialogOpen,
    setMulticamDialogOpen,
    openClipContextMenu,
    closeTimelineContextMenus,
    handleInOutMarkerContextMenu,
    handleTimelineMarkerContextMenu,
    handleDeleteInOutPoint,
  };
}
