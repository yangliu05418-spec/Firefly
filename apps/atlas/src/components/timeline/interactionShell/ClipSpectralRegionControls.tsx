import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipSpectralRegionOverlays } from '../components/ClipSpectralRegionOverlays';
import { isAudioRegionModifierPressed } from '../utils/audioRegionDisplay';
import {
  frequencyHzFromSpectralY,
  getSpectralMaxFrequencyHz,
  resolveTimelineSpectralBrushSelection,
  resolveTimelineSpectralRegionSelection,
} from '../utils/spectralSelection';
import {
  resolveSpectralImageLayerOverlays,
  resolveSpectralRegionOverlay,
} from '../utils/spectralRegionOverlays';
import type { ClipInteractionShellCommandContext, ClipInteractionShellCommands } from './types';

interface ClipSpectralRegionControlsProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

type ClipSpectralRegionSelection = NonNullable<
  NonNullable<ClipInteractionShellCommandContext['activeModules']['spectralRegion']>['selection']
>;

type SpectralRegionDragState = {
  anchorTimelineTime: number;
  anchorFrequencyHz: number;
  startClientX: number;
  startClientY: number;
  rectLeft: number;
  rectWidth: number;
  rectTop: number;
  rectHeight: number;
  maxFrequencyHz: number;
  mode: 'rectangle' | 'brush';
  brushTimeRadiusSeconds?: number;
  brushFrequencyRadiusHz?: number;
};

function timelineTimeFromClientX(context: ClipInteractionShellCommandContext, clientX: number, rectLeft: number, rectWidth: number): number {
  const x = Math.max(0, Math.min(rectWidth, clientX - rectLeft));
  return context.clip.startTime + (x / Math.max(1, rectWidth)) * Math.max(0.001, context.clip.duration);
}

function sourceTimeToTimelineTime(context: ClipInteractionShellCommandContext, sourceTime: number): number {
  const clipDuration = Math.max(0.001, context.clip.duration);
  const sourceStart = Math.max(0, context.clip.inPoint ?? 0);
  const sourceEnd = Math.max(sourceStart + 0.001, context.clip.outPoint ?? sourceStart + clipDuration);
  const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
  const timelineRatio = context.clip.reversed ? 1 - sourceRatio : sourceRatio;
  return context.clip.startTime + timelineRatio * clipDuration;
}

function resolveDragSelection(
  context: ClipInteractionShellCommandContext,
  drag: SpectralRegionDragState,
  clientX: number,
  clientY: number,
): ClipSpectralRegionSelection {
  const focusTimelineTime = timelineTimeFromClientX(context, clientX, drag.rectLeft, drag.rectWidth);
  const focusFrequencyHz = frequencyHzFromSpectralY(clientY - drag.rectTop, drag.rectHeight, drag.maxFrequencyHz);
  const clip = {
    id: context.clip.id,
    trackId: context.clip.trackId,
    startTime: context.clip.startTime,
    duration: context.clip.duration,
    inPoint: context.clip.inPoint,
    outPoint: context.clip.outPoint,
    reversed: context.clip.reversed,
    waveform: context.clip.waveform,
  };

  if (drag.mode === 'brush') {
    return resolveTimelineSpectralBrushSelection({
      clip,
      centerTimelineTime: focusTimelineTime,
      centerFrequencyHz: focusFrequencyHz,
      timeRadiusSeconds: drag.brushTimeRadiusSeconds ?? 0.08,
      frequencyRadiusHz: drag.brushFrequencyRadiusHz ?? drag.maxFrequencyHz * 0.04,
      maxFrequencyHz: drag.maxFrequencyHz,
    });
  }

  return resolveTimelineSpectralRegionSelection({
    clip,
    anchorTimelineTime: drag.anchorTimelineTime,
    focusTimelineTime,
    anchorFrequencyHz: drag.anchorFrequencyHz,
    focusFrequencyHz,
    maxFrequencyHz: drag.maxFrequencyHz,
  });
}

function getDroppedImageMediaFileId(
  dataTransfer: DataTransfer,
  spectralImageFilesById: ReadonlyMap<string, { id: string; type?: string }>,
): string | null {
  const mediaFileId = dataTransfer.getData('application/x-media-file-id');
  if (!mediaFileId) return null;
  const file = spectralImageFilesById.get(mediaFileId);
  return file?.type === 'image' ? file.id : null;
}

export function ClipSpectralRegionControls({ context, commands }: ClipSpectralRegionControlsProps) {
  const spectralRegion = context.activeModules.spectralRegion;
  const [drag, setDrag] = useState<SpectralRegionDragState | null>(null);
  const maxFrequencyHz = getSpectralMaxFrequencyHz(undefined);
  const selection = spectralRegion?.selection ?? null;
  const canSelectSpectralRegion = spectralRegion?.canSelectRegion === true;

  const spectralImageFilesById = useMemo(() => {
    const entries = (spectralRegion?.imageMediaFiles ?? [])
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const);
    return new Map(entries);
  }, [spectralRegion?.imageMediaFiles]);
  const selectedSpectralImageFile = spectralRegion?.selectedImageFile ?? null;

  const regionOverlay = useMemo(() => resolveSpectralRegionOverlay({
    selection,
    displayStartTime: context.clip.startTime,
    displayDuration: Math.max(0.001, context.clip.duration),
    width: context.geometry.clip.width,
    trackBaseHeight: context.geometry.clip.height,
    maxFrequencyHz,
  }), [context.clip.duration, context.clip.startTime, context.geometry.clip.height, context.geometry.clip.width, maxFrequencyHz, selection]);

  const imageLayerOverlays = useMemo(() => resolveSpectralImageLayerOverlays({
    enabled: true,
    layers: spectralRegion?.imageLayers ?? [],
    displayStartTime: context.clip.startTime,
    displayDuration: Math.max(0.001, context.clip.duration),
    width: context.geometry.clip.width,
    trackBaseHeight: context.geometry.clip.height,
    maxFrequencyHz,
    sourceTimeToDisplayTimelineTime: (sourceTime) => sourceTimeToTimelineTime(context, sourceTime),
    mediaFilesById: spectralImageFilesById,
  }), [context, maxFrequencyHz, spectralImageFilesById, spectralRegion?.imageLayers]);

  const handleToolbarMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleApplySpectralRegionEdit = useCallback((type: 'spectral-mask' | 'spectral-resynthesis') => (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    commands?.onModuleCommand?.(
      'spectral-region',
      { type: 'spectral-region:apply-edit', editType: type },
      context,
      event as React.MouseEvent<HTMLElement>,
    );
  }, [commands, context]);

  const addSpectralImageLayerFromSelection = useCallback((imageMediaFileId: string) => {
    if (!selection) return null;
    const start = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const end = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    if (end - start <= 0.0005) return null;

    commands?.onModuleCommand?.('spectral-region', {
      type: 'spectral-region:add-image-layer',
      layer: {
        imageMediaFileId,
        timeStart: start,
        duration: end - start,
        frequencyMin: selection.frequencyMinHz,
        frequencyMax: selection.frequencyMaxHz,
        opacity: 0.85,
        blendMode: 'attenuate',
        gainDb: -18,
        featherTime: 0.02,
        featherFrequency: 80,
      },
    }, context);
    return true;
  }, [commands, context, selection]);

  const handleAddSelectedImageSpectralLayer = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!selectedSpectralImageFile) return;
    addSpectralImageLayerFromSelection(selectedSpectralImageFile.id);
  }, [addSpectralImageLayerFromSelection, selectedSpectralImageFile]);

  const handleSpectralRegionMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || event.button !== 0 || !isAudioRegionModifierPressed(event)) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();
    const brushMode = event.shiftKey || event.altKey;
    const nextDrag: SpectralRegionDragState = {
      anchorTimelineTime: timelineTimeFromClientX(context, event.clientX, rect.left, rect.width),
      anchorFrequencyHz: frequencyHzFromSpectralY(event.clientY - rect.top, rect.height, maxFrequencyHz),
      startClientX: event.clientX,
      startClientY: event.clientY,
      rectLeft: rect.left,
      rectWidth: rect.width,
      rectTop: rect.top,
      rectHeight: rect.height,
      maxFrequencyHz,
      mode: brushMode ? 'brush' : 'rectangle',
      brushTimeRadiusSeconds: brushMode ? Math.max(0.025, Math.min(0.5, 18 / Math.max(1, context.geometry.clip.width / Math.max(0.001, context.clip.duration)))) : undefined,
      brushFrequencyRadiusHz: brushMode ? Math.max(80, maxFrequencyHz * 0.045) : undefined,
    };

    setDrag(nextDrag);
    commands?.onModuleCommand?.(
      'spectral-region',
      {
        type: 'spectral-region:set-selection',
        selection: resolveDragSelection(context, nextDrag, event.clientX, event.clientY),
      },
      context,
      event,
    );
  }, [canSelectSpectralRegion, commands, context, maxFrequencyHz]);

  const handleSpectralRegionDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isAudioRegionModifierPressed(event)) return;
    event.preventDefault();
    event.stopPropagation();
    commands?.onModuleCommand?.('spectral-region', { type: 'spectral-region:clear-selection' }, context, event);
  }, [commands, context]);

  const handleSpectralImageLayerDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion || !getDroppedImageMediaFileId(event.dataTransfer, spectralImageFilesById)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
  }, [canSelectSpectralRegion, spectralImageFilesById]);

  const handleSpectralImageLayerDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (!canSelectSpectralRegion) return;
    const imageMediaFileId = getDroppedImageMediaFileId(event.dataTransfer, spectralImageFilesById);
    if (!imageMediaFileId) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const centerTime = timelineTimeFromClientX(context, event.clientX, rect.left, rect.width);
    const clipDuration = Math.max(0.001, context.clip.duration);
    const zoom = context.geometry.clip.width / clipDuration;
    const layerDuration = Math.max(0.15, Math.min(clipDuration, Math.max(0.65, 160 / Math.max(1, zoom))));
    const centerFrequency = frequencyHzFromSpectralY(event.clientY - rect.top, rect.height, maxFrequencyHz);
    const frequencySpan = Math.max(120, maxFrequencyHz * 0.16);
    const nextSelection = resolveTimelineSpectralRegionSelection({
      clip: {
        id: context.clip.id,
        trackId: context.clip.trackId,
        startTime: context.clip.startTime,
        duration: context.clip.duration,
        inPoint: context.clip.inPoint,
        outPoint: context.clip.outPoint,
        reversed: context.clip.reversed,
        waveform: context.clip.waveform,
      },
      anchorTimelineTime: centerTime - layerDuration / 2,
      focusTimelineTime: centerTime + layerDuration / 2,
      anchorFrequencyHz: centerFrequency - frequencySpan / 2,
      focusFrequencyHz: centerFrequency + frequencySpan / 2,
      maxFrequencyHz,
    });

    commands?.onModuleCommand?.(
      'spectral-region',
      {
        type: 'spectral-region:add-image-layer',
        layer: {
          imageMediaFileId,
          timeStart: nextSelection.sourceInPoint,
          duration: Math.max(0.001, nextSelection.sourceOutPoint - nextSelection.sourceInPoint),
          frequencyMin: nextSelection.frequencyMinHz,
          frequencyMax: nextSelection.frequencyMaxHz,
          opacity: 0.85,
          blendMode: 'attenuate',
          gainDb: -18,
          featherTime: 0.02,
          featherFrequency: 80,
        },
      },
      context,
      event,
    );
    commands?.onModuleCommand?.(
      'spectral-region',
      { type: 'spectral-region:set-selection', selection: nextSelection },
      context,
      event,
    );
  }, [canSelectSpectralRegion, commands, context, maxFrequencyHz, spectralImageFilesById]);

  useEffect(() => {
    if (!drag || !canSelectSpectralRegion) return;

    const handleDocumentMouseMove = (event: MouseEvent) => {
      if (!isAudioRegionModifierPressed(event)) {
        setDrag(null);
        return;
      }
      event.preventDefault();
      commands?.onModuleCommand?.(
        'spectral-region',
        {
          type: 'spectral-region:set-selection',
          selection: resolveDragSelection(context, drag, event.clientX, event.clientY),
        },
        context,
      );
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      if (
        drag.mode !== 'brush' &&
        Math.abs(event.clientX - drag.startClientX) < 3 &&
        Math.abs(event.clientY - drag.startClientY) < 3
      ) {
        commands?.onModuleCommand?.('spectral-region', { type: 'spectral-region:clear-selection' }, context);
      }
      setDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [canSelectSpectralRegion, commands, context, drag]);

  if (!spectralRegion?.enabled || (!regionOverlay && imageLayerOverlays.length === 0 && !canSelectSpectralRegion)) {
    return null;
  }

  return (
    <div
      className="shell-spectral-region-module"
      data-clip-interaction-slot="spectral-region"
    >
      <ClipSpectralRegionOverlays
        regionOverlay={regionOverlay}
        selectionMode={selection?.selectionMode}
        imageLayerOverlays={imageLayerOverlays}
        canSelectSpectralRegion={canSelectSpectralRegion}
        selectedSpectralImageFile={selectedSpectralImageFile}
        onToolbarMouseDown={handleToolbarMouseDown}
        onApplySpectralRegionEdit={handleApplySpectralRegionEdit}
        onAddSelectedImageSpectralLayer={handleAddSelectedImageSpectralLayer}
      />
      {canSelectSpectralRegion && (
        <div
          className="clip-audio-region-hitarea clip-spectral-region-hitarea"
          onMouseDown={handleSpectralRegionMouseDown}
          onDragOver={handleSpectralImageLayerDragOver}
          onDrop={handleSpectralImageLayerDrop}
          onDoubleClick={handleSpectralRegionDoubleClick}
          title="Hold Ctrl/Strg and drag to select a spectral region; add Shift or Alt for brush"
        />
      )}
    </div>
  );
}
