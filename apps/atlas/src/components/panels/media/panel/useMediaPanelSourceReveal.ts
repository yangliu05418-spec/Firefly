import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { useMediaStore, type MediaFolder, type ProjectItem } from '../../../../stores/mediaStore';
import {
  getLastMediaSourceRevealRequest,
  isMediaSourceRevealEvent,
  MEDIA_SOURCE_REVEAL_EVENT,
  type MediaSourceRevealRequest,
} from '../../../../services/mediaSourceReveal';
import { MEDIA_BOARD_PAN_ZOOM_MAX, MEDIA_BOARD_PAN_ZOOM_MIN } from '../board/constants';
import type { MediaBoardNodePlacement, MediaBoardViewport } from '../board/types';
import type { MediaClassicListRowData } from '../list/types';
import type { MediaPanelViewMode } from './types';

const MEDIA_PANEL_REVEAL_PULSE_MS = 1200;
const MEDIA_PANEL_REVEAL_REQUEST_MAX_AGE_MS = 10000;

function getAncestorFolderIds(item: ProjectItem, folders: MediaFolder[]): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let parentId = item.parentId ?? null;

  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    ancestors.push(parentId);
    parentId = folders.find((folder) => folder.id === parentId)?.parentId ?? null;
  }

  return ancestors;
}

function getMediaPanelAnimatedTarget(root: HTMLElement | null, itemId: string): HTMLElement | null {
  if (!root || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    return null;
  }

  return root.querySelector<HTMLElement>(`[data-media-panel-anim-id="${CSS.escape(itemId)}"]`);
}

interface UseMediaPanelSourceRevealInput {
  allProjectItemsById: Map<string, ProjectItem>;
  boardCanvasRef: RefObject<HTMLDivElement | null>;
  classicRows: MediaClassicListRowData[];
  folders: MediaFolder[];
  gridFolderId: string | null;
  mediaBoardPlacementsById: Map<string, MediaBoardNodePlacement>;
  mediaBoardViewport: MediaBoardViewport;
  mediaPanelContentRef: RefObject<HTMLDivElement | null>;
  scrollClassicListRowIntoView: (rowIndex: number) => boolean;
  setGridFolderId: Dispatch<SetStateAction<string | null>>;
  setMediaBoardViewport: Dispatch<SetStateAction<MediaBoardViewport>>;
  setMediaSearchQuery: Dispatch<SetStateAction<string>>;
  setSelection: (ids: string[]) => void;
  viewMode: MediaPanelViewMode;
}

export function useMediaPanelSourceReveal({
  allProjectItemsById,
  boardCanvasRef,
  classicRows,
  folders,
  gridFolderId,
  mediaBoardPlacementsById,
  mediaBoardViewport,
  mediaPanelContentRef,
  scrollClassicListRowIntoView,
  setGridFolderId,
  setMediaBoardViewport,
  setMediaSearchQuery,
  setSelection,
  viewMode,
}: UseMediaPanelSourceRevealInput) {
  const lastHandledRevealRequestIdRef = useRef(0);
  const mediaRevealPulseTimerRef = useRef<number | null>(null);
  const [pendingMediaReveal, setPendingMediaReveal] = useState<MediaSourceRevealRequest | null>(null);

  useEffect(() => () => {
    if (mediaRevealPulseTimerRef.current !== null) {
      window.clearTimeout(mediaRevealPulseTimerRef.current);
      mediaRevealPulseTimerRef.current = null;
    }
  }, []);

  const pulseMediaPanelRevealTarget = useCallback((itemId: string, scrollIntoView: boolean): boolean => {
    const target = getMediaPanelAnimatedTarget(mediaPanelContentRef.current, itemId);
    if (!target) {
      return false;
    }

    if (scrollIntoView) {
      target.scrollIntoView({ block: 'center', inline: 'nearest' });
    }

    target.classList.remove('media-panel-reveal-pulse');
    void target.offsetWidth;
    target.classList.add('media-panel-reveal-pulse');

    if (mediaRevealPulseTimerRef.current !== null) {
      window.clearTimeout(mediaRevealPulseTimerRef.current);
    }
    mediaRevealPulseTimerRef.current = window.setTimeout(() => {
      target.classList.remove('media-panel-reveal-pulse');
      mediaRevealPulseTimerRef.current = null;
    }, MEDIA_PANEL_REVEAL_PULSE_MS);

    return true;
  }, [mediaPanelContentRef]);

  const prepareMediaSourceReveal = useCallback((request: MediaSourceRevealRequest) => {
    if (request.requestId <= lastHandledRevealRequestIdRef.current) {
      return;
    }

    const item = allProjectItemsById.get(request.mediaFileId);
    if (!item) {
      return;
    }

    lastHandledRevealRequestIdRef.current = request.requestId;
    setSelection([request.mediaFileId]);
    setMediaSearchQuery('');

    const ancestorFolderIds = getAncestorFolderIds(item, folders);
    if (viewMode === 'classic' && ancestorFolderIds.length > 0) {
      useMediaStore.setState((state) => ({
        expandedFolderIds: [...new Set([...state.expandedFolderIds, ...ancestorFolderIds])],
      }));
    } else if (viewMode === 'icons') {
      setGridFolderId(item.parentId ?? null);
    }

    setPendingMediaReveal(request);
  }, [allProjectItemsById, folders, setGridFolderId, setMediaSearchQuery, setSelection, viewMode]);

  useEffect(() => {
    let cancelled = false;
    const handleMediaSourceReveal = (event: Event) => {
      if (!isMediaSourceRevealEvent(event)) {
        return;
      }
      prepareMediaSourceReveal(event.detail);
    };

    window.addEventListener(MEDIA_SOURCE_REVEAL_EVENT, handleMediaSourceReveal);

    const lastRequest = getLastMediaSourceRevealRequest();
    if (
      lastRequest
      && Date.now() - lastRequest.createdAt <= MEDIA_PANEL_REVEAL_REQUEST_MAX_AGE_MS
    ) {
      queueMicrotask(() => {
        if (!cancelled) {
          prepareMediaSourceReveal(lastRequest);
        }
      });
    }

    return () => {
      cancelled = true;
      window.removeEventListener(MEDIA_SOURCE_REVEAL_EVENT, handleMediaSourceReveal);
    };
  }, [prepareMediaSourceReveal]);

  useLayoutEffect(() => {
    if (!pendingMediaReveal) {
      return;
    }

    const item = allProjectItemsById.get(pendingMediaReveal.mediaFileId);
    if (!item) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setPendingMediaReveal(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    if (viewMode === 'classic') {
      const rowIndex = classicRows.findIndex((row) => row.item.id === pendingMediaReveal.mediaFileId);
      if (!scrollClassicListRowIntoView(rowIndex)) {
        return;
      }
    } else if (viewMode === 'icons') {
      if ((item.parentId ?? null) !== gridFolderId) {
        return;
      }
    } else if (viewMode === 'board') {
      const placement = mediaBoardPlacementsById.get(pendingMediaReveal.mediaFileId);
      const canvas = boardCanvasRef.current;
      if (!placement || !canvas) {
        return;
      }

      const zoom = Math.max(MEDIA_BOARD_PAN_ZOOM_MIN, Math.min(MEDIA_BOARD_PAN_ZOOM_MAX, mediaBoardViewport.zoom || 1));
      const centerX = placement.layout.x + (placement.layout.width / 2);
      const centerY = placement.layout.y + (placement.layout.height / 2);
      const nextViewport = {
        zoom,
        panX: (canvas.clientWidth / 2) - (centerX * zoom),
        panY: (canvas.clientHeight / 2) - (centerY * zoom),
      };

      if (
        Math.abs(mediaBoardViewport.panX - nextViewport.panX) > 1
        || Math.abs(mediaBoardViewport.panY - nextViewport.panY) > 1
        || Math.abs(mediaBoardViewport.zoom - nextViewport.zoom) > 0.0001
      ) {
        setMediaBoardViewport(nextViewport);
      }
    }

    let secondFrameId: number | null = null;
    let retryTimerId: number | null = null;
    const frameId = window.requestAnimationFrame(() => {
      secondFrameId = window.requestAnimationFrame(() => {
        const pulsed = pulseMediaPanelRevealTarget(pendingMediaReveal.mediaFileId, viewMode !== 'board');
        if (pulsed) {
          setPendingMediaReveal(null);
          return;
        }

        retryTimerId = window.setTimeout(() => {
          if (pulseMediaPanelRevealTarget(pendingMediaReveal.mediaFileId, viewMode !== 'board')) {
            setPendingMediaReveal(null);
          }
        }, 120);
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (secondFrameId !== null) {
        window.cancelAnimationFrame(secondFrameId);
      }
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
      }
    };
  }, [
    allProjectItemsById,
    boardCanvasRef,
    classicRows,
    gridFolderId,
    mediaBoardPlacementsById,
    mediaBoardViewport,
    pendingMediaReveal,
    pulseMediaPanelRevealTarget,
    scrollClassicListRowIntoView,
    setMediaBoardViewport,
    viewMode,
  ]);
}
