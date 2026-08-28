import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { mediaNeedsRelink } from '../../../../services/project/relinkMedia';
import { isImportedMediaFileItem } from '../itemTypeGuards';
import {
  MEDIA_BOARD_ORIGINAL_FOCUS_MARGIN_RATIO,
  MEDIA_BOARD_ORIGINAL_FOCUS_ZOOM,
  MEDIA_BOARD_OVERVIEW_THUMBNAIL_REQUEST_LIMIT,
  MEDIA_BOARD_PAN_ZOOM_MIN,
  MEDIA_BOARD_THUMBNAIL_REQUEST_LIMIT,
  MEDIA_BOARD_THUMBNAIL_WORKER_COUNT,
  MEDIA_BOARD_VIDEO_POSTER_FALLBACK_LIMIT,
} from './constants';
import { mediaBoardGroupIntersectsVisibleRect, mediaBoardNodeIntersectsVisibleRect, waitForMediaBoardThumbnailTurn } from './layout';
import { drawMediaBoardOverviewItem } from './overviewCanvas';
import type {
  MediaBoardItem,
  MediaBoardLayoutResult,
  MediaBoardNodePlacement,
  MediaBoardRenderLod,
  MediaBoardViewport,
  MediaBoardVisibleRect,
} from './types';

interface OverviewImageRecord {
  src: string;
  image: HTMLImageElement;
  status: 'loading' | 'loaded' | 'error';
}

export interface UseMediaBoardOverviewOptions {
  ensureFileThumbnail: (id: string) => void | Promise<unknown>;
  mediaBoardLayout: MediaBoardLayoutResult;
  mediaBoardRenderLod: MediaBoardRenderLod;
  mediaBoardViewport: MediaBoardViewport;
  mediaBoardVisibleRect: MediaBoardVisibleRect;
  mediaSearchVisibleItemIds: Set<string> | null;
  selectedIdSet: Set<string>;
  viewMode: string;
}

export function useMediaBoardOverview({
  ensureFileThumbnail,
  mediaBoardLayout,
  mediaBoardRenderLod,
  mediaBoardViewport,
  mediaBoardVisibleRect,
  mediaSearchVisibleItemIds,
  selectedIdSet,
  viewMode,
}: UseMediaBoardOverviewOptions) {
  const boardOverviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardOverviewRedrawFrameRef = useRef<number | null>(null);
  const boardOverviewImageCacheRef = useRef(new Map<string, OverviewImageRecord>());
  const [mediaBoardOverviewImageVersion, setMediaBoardOverviewImageVersion] = useState(0);

  useEffect(() => () => {
    if (boardOverviewRedrawFrameRef.current !== null) {
      window.cancelAnimationFrame(boardOverviewRedrawFrameRef.current);
    }
  }, []);

  const visibleMediaBoardGroups = useMemo(() => (
    mediaBoardLayout.groups.filter((group) => mediaBoardGroupIntersectsVisibleRect(group, mediaBoardVisibleRect))
  ), [mediaBoardLayout.groups, mediaBoardVisibleRect]);

  const visibleMediaBoardInsertGaps = useMemo(() => (
    mediaBoardLayout.insertGaps.filter((gap) => mediaBoardNodeIntersectsVisibleRect(gap.layout, mediaBoardVisibleRect))
  ), [mediaBoardLayout.insertGaps, mediaBoardVisibleRect]);

  const visibleMediaBoardPlacements = useMemo(() => (
    mediaBoardLayout.placements.filter((placement) => (
      placement.isDraggingPreview
      || selectedIdSet.has(placement.item.id)
      || mediaBoardNodeIntersectsVisibleRect(placement.layout, mediaBoardVisibleRect)
    ))
  ), [mediaBoardLayout.placements, mediaBoardVisibleRect, selectedIdSet]);

  const mediaBoardVideoPosterFallbackIds = useMemo(() => {
    if (viewMode !== 'board') return new Set<string>();
    const centerX = (mediaBoardVisibleRect.left + mediaBoardVisibleRect.right) / 2;
    const centerY = (mediaBoardVisibleRect.top + mediaBoardVisibleRect.bottom) / 2;
    const ids = visibleMediaBoardPlacements
      .map((placement) => {
        const { item, layout } = placement;
        if (
          placement.isDraggingPreview
          || !isImportedMediaFileItem(item)
          || item.type !== 'video'
          || item.isImporting
          || !item.url
          || mediaNeedsRelink(item)
          || layout.width * mediaBoardViewport.zoom < 4
          || layout.height * mediaBoardViewport.zoom < 4
          || (mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(item.id))
        ) {
          return null;
        }
        const itemCenterX = layout.x + layout.width / 2;
        const itemCenterY = layout.y + layout.height / 2;
        return { id: item.id, area: layout.width * layout.height, distance: Math.hypot(itemCenterX - centerX, itemCenterY - centerY) };
      })
      .filter((entry): entry is { id: string; area: number; distance: number } => entry !== null)
      .toSorted((a, b) => (a.distance - b.distance) || (b.area - a.area))
      .slice(0, MEDIA_BOARD_VIDEO_POSTER_FALLBACK_LIMIT)
      .map((entry) => entry.id);
    return new Set(ids);
  }, [mediaBoardVisibleRect, mediaBoardViewport.zoom, mediaSearchVisibleItemIds, viewMode, visibleMediaBoardPlacements]);

  const focusedMediaBoardOriginalId = useMemo(() => {
    if (mediaBoardViewport.zoom < MEDIA_BOARD_ORIGINAL_FOCUS_ZOOM) return null;
    const centerX = (mediaBoardVisibleRect.left + mediaBoardVisibleRect.right) / 2;
    const centerY = (mediaBoardVisibleRect.top + mediaBoardVisibleRect.bottom) / 2;
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    visibleMediaBoardPlacements.forEach((placement) => {
      const { item, layout } = placement;
      if (
        placement.isDraggingPreview
        || !isImportedMediaFileItem(item)
        || item.type !== 'image'
        || !item.url
        || item.isImporting
        || mediaNeedsRelink(item)
        || (mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(item.id))
        || !mediaBoardNodeIntersectsVisibleRect(layout, mediaBoardVisibleRect)
      ) {
        return;
      }
      const marginX = layout.width * MEDIA_BOARD_ORIGINAL_FOCUS_MARGIN_RATIO;
      const marginY = layout.height * MEDIA_BOARD_ORIGINAL_FOCUS_MARGIN_RATIO;
      if (
        centerX < layout.x - marginX
        || centerX > layout.x + layout.width + marginX
        || centerY < layout.y - marginY
        || centerY > layout.y + layout.height + marginY
      ) {
        return;
      }
      const itemCenterX = layout.x + layout.width / 2;
      const itemCenterY = layout.y + layout.height / 2;
      const distance = Math.hypot(
        (itemCenterX - centerX) / Math.max(1, layout.width),
        (itemCenterY - centerY) / Math.max(1, layout.height),
      );
      if (distance < bestDistance) {
        bestId = item.id;
        bestDistance = distance;
      }
    });
    return bestId;
  }, [mediaBoardViewport.zoom, mediaBoardVisibleRect, mediaSearchVisibleItemIds, visibleMediaBoardPlacements]);

  const visibleMediaBoardThumbnailKey = useMemo(() => {
    if (!mediaBoardRenderLod.requestThumbnails) return '';
    const centerX = (mediaBoardVisibleRect.left + mediaBoardVisibleRect.right) / 2;
    const centerY = (mediaBoardVisibleRect.top + mediaBoardVisibleRect.bottom) / 2;
    const requestLimit = mediaBoardRenderLod.overviewCanvas
      ? MEDIA_BOARD_OVERVIEW_THUMBNAIL_REQUEST_LIMIT
      : MEDIA_BOARD_THUMBNAIL_REQUEST_LIMIT;
    return visibleMediaBoardPlacements
      .map((placement) => {
        const { item, layout } = placement;
        if (!isImportedMediaFileItem(item) || item.thumbnailUrl || item.isImporting || (item.type !== 'image' && item.type !== 'video')) return null;
        const itemCenterX = layout.x + layout.width / 2;
        const itemCenterY = layout.y + layout.height / 2;
        return { id: item.id, area: layout.width * layout.height, distance: Math.hypot(itemCenterX - centerX, itemCenterY - centerY) };
      })
      .filter((entry): entry is { id: string; area: number; distance: number } => entry !== null)
      .toSorted((a, b) => (b.area - a.area) || (a.distance - b.distance))
      .slice(0, requestLimit)
      .map((entry) => entry.id)
      .join('\n');
  }, [mediaBoardRenderLod.overviewCanvas, mediaBoardRenderLod.requestThumbnails, mediaBoardVisibleRect, visibleMediaBoardPlacements]);

  useEffect(() => {
    if (viewMode !== 'board' || !visibleMediaBoardThumbnailKey) return;
    const thumbnailIds = visibleMediaBoardThumbnailKey.split('\n').filter(Boolean);
    let cancelled = false;
    let nextIndex = 0;
    const workerCount = Math.min(MEDIA_BOARD_THUMBNAIL_WORKER_COUNT, thumbnailIds.length);
    const runWorker = async () => {
      while (!cancelled) {
        const id = thumbnailIds[nextIndex];
        nextIndex += 1;
        if (!id) return;
        await waitForMediaBoardThumbnailTurn();
        if (cancelled) return;
        await ensureFileThumbnail(id);
      }
    };
    for (let index = 0; index < workerCount; index += 1) void runWorker();
    return () => { cancelled = true; };
  }, [ensureFileThumbnail, viewMode, visibleMediaBoardThumbnailKey]);

  const scheduleMediaBoardOverviewRedraw = useCallback(() => {
    if (boardOverviewRedrawFrameRef.current !== null) return;
    boardOverviewRedrawFrameRef.current = window.requestAnimationFrame(() => {
      boardOverviewRedrawFrameRef.current = null;
      setMediaBoardOverviewImageVersion((version) => (version + 1) % 100000);
    });
  }, []);

  useLayoutEffect(() => {
    if (viewMode !== 'board' || !mediaBoardRenderLod.overviewCanvas) return;
    const canvas = boardOverviewCanvasRef.current;
    if (!canvas) return;

    const zoom = Math.max(mediaBoardViewport.zoom, MEDIA_BOARD_PAN_ZOOM_MIN);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    const rect = mediaBoardVisibleRect;
    const boardWidth = Math.max(1, rect.right - rect.left);
    const boardHeight = Math.max(1, rect.bottom - rect.top);
    const pixelWidth = Math.max(1, Math.ceil(boardWidth * zoom * dpr));
    const pixelHeight = Math.max(1, Math.ceil(boardHeight * zoom * dpr));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelWidth, pixelHeight);
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, -rect.left * zoom * dpr, -rect.top * zoom * dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';

    const cache = boardOverviewImageCacheRef.current;
    const visibleItemIds = new Set<string>();
    const getLoadedOverviewImage = (item: MediaBoardItem): HTMLImageElement | null => {
      if (!isImportedMediaFileItem(item) || !item.thumbnailUrl) return null;
      visibleItemIds.add(item.id);
      const cached = cache.get(item.id);
      if (cached?.src === item.thumbnailUrl) return cached.status === 'loaded' ? cached.image : null;
      const image = new Image();
      const record = { src: item.thumbnailUrl, image, status: 'loading' as const };
      cache.set(item.id, record);
      image.onload = () => {
        cache.set(item.id, { ...record, status: 'loaded' });
        scheduleMediaBoardOverviewRedraw();
      };
      image.onerror = () => { cache.set(item.id, { ...record, status: 'error' }); };
      image.decoding = 'async';
      image.src = item.thumbnailUrl;
      return null;
    };

    visibleMediaBoardPlacements.forEach((placement) => {
      if (placement.isDraggingPreview || selectedIdSet.has(placement.item.id)) return;
      drawMediaBoardOverviewItem(
        ctx,
        placement,
        getLoadedOverviewImage(placement.item),
        zoom,
        Boolean(mediaSearchVisibleItemIds && !mediaSearchVisibleItemIds.has(placement.item.id)),
      );
    });
    cache.forEach((_, itemId) => {
      if (!visibleItemIds.has(itemId)) cache.delete(itemId);
    });
  }, [
    mediaBoardOverviewImageVersion,
    mediaBoardRenderLod.overviewCanvas,
    mediaBoardViewport.zoom,
    mediaBoardVisibleRect,
    mediaSearchVisibleItemIds,
    scheduleMediaBoardOverviewRedraw,
    selectedIdSet,
    viewMode,
    visibleMediaBoardPlacements,
  ]);

  const mediaBoardOverviewCanvasStyle = useMemo<CSSProperties>(() => ({
    left: mediaBoardVisibleRect.left,
    top: mediaBoardVisibleRect.top,
    width: Math.max(1, mediaBoardVisibleRect.right - mediaBoardVisibleRect.left),
    height: Math.max(1, mediaBoardVisibleRect.bottom - mediaBoardVisibleRect.top),
  }), [mediaBoardVisibleRect]);

  const requestMediaBoardThumbnail = useCallback((id: string) => {
    void ensureFileThumbnail(id);
  }, [ensureFileThumbnail]);

  return {
    boardOverviewCanvasRef,
    focusedMediaBoardOriginalId,
    isMediaBoardDeepZoomActive: viewMode === 'board' && mediaBoardViewport.zoom >= MEDIA_BOARD_ORIGINAL_FOCUS_ZOOM,
    mediaBoardOverviewCanvasStyle,
    mediaBoardVideoPosterFallbackIds,
    requestMediaBoardThumbnail,
    visibleMediaBoardGroups,
    visibleMediaBoardInsertGaps,
    visibleMediaBoardPlacements: visibleMediaBoardPlacements as MediaBoardNodePlacement[],
  };
}
