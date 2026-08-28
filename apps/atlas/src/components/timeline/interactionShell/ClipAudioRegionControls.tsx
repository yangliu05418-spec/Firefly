import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipAudioEditOperationOverlays } from '../components/ClipAudioEditOperationOverlays';
import { ClipAudioEditStackControls } from '../components/ClipAudioEditStackControls';
import { ClipAudioRegionContextMenu } from '../components/ClipAudioRegionContextMenu';
import { ClipAudioRegionSelectionOverlay, type AudioRegionGainHandleMode } from '../components/ClipAudioRegionSelectionOverlay';
import {
  resolveAudioEditOperationOverlays,
  resolveAudioRegionGainControl,
  resolveAudioRegionOverlay,
} from '../utils/activeRegionOverlays';
import {
  AUDIO_REGION_TIMELINE_EPSILON,
  audioRegionGainDbFromClientY,
} from '../utils/audioRegionDisplay';
import {
  createAudioRegionContextMenuModel,
  type AudioRegionContextMenuCommand,
} from '../utils/audioRegionContextMenu';
import {
  moveTimelineAudioRegionSelection,
  resizeTimelineAudioRegionSelection,
} from '../utils/audioEditSelection';
import { useContextMenuPosition } from '../../../hooks/useContextMenuPosition';
import {
  AUDIO_EXTENSIONS,
  type AudioRegionContextMenuState,
  type AudioRegionGainDragState,
  type AudioRegionMoveDragState,
  type AudioRegionResizeDragState,
  type ClipAudioRegionModuleCommand,
  type ClipAudioRegionSelection,
  findSelectedGainOperation,
  getMatchingAudioRegionOperationIds,
} from './clipAudioRegionControlsModel';
import type {
  ClipInteractionShellAudioRegionModuleState,
  ClipInteractionShellCommandContext,
  ClipInteractionShellCommands,
} from './types';

interface ClipAudioRegionControlsProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

interface ClipAudioRegionControlsActiveProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
  audioRegion: ClipInteractionShellAudioRegionModuleState;
  selection: ClipAudioRegionSelection;
}

export function ClipAudioRegionControls({ context, commands }: ClipAudioRegionControlsProps) {
  const audioRegion = context.activeModules.audioRegion;
  const selection = audioRegion?.selection;
  if (!audioRegion?.enabled || !selection) return null;

  return (
    <ClipAudioRegionControlsActive
      context={context}
      commands={commands}
      audioRegion={audioRegion}
      selection={selection}
    />
  );
}

function ClipAudioRegionControlsActive({
  context,
  commands,
  audioRegion,
  selection,
}: ClipAudioRegionControlsActiveProps) {
  const [moveDrag, setMoveDrag] = useState<AudioRegionMoveDragState | null>(null);
  const [resizeDrag, setResizeDrag] = useState<AudioRegionResizeDragState | null>(null);
  const [gainDrag, setGainDrag] = useState<AudioRegionGainDragState | null>(null);
  const [contextMenu, setContextMenu] = useState<AudioRegionContextMenuState | null>(null);
  const [audioBakePending, setAudioBakePending] = useState(false);
  const contextMenuCommandHandledRef = useRef(false);
  const { menuRef: contextMenuRef, adjustedPosition: contextMenuPosition } = useContextMenuPosition(contextMenu);
  const audioFocusMode = audioRegion.audioFocusMode === true;
  const showAudioRegionEditMarkers = audioRegion.showEditMarkers === true;
  const hasAudioRegionClipboard = audioRegion.hasClipboard === true;
  const dispatchAudioRegionCommand = useCallback((
    command: ClipAudioRegionModuleCommand,
    event?: React.MouseEvent<HTMLElement>,
  ) => {
    return commands?.onModuleCommand?.('audio-region', command, context, event);
  }, [commands, context]);

  const operations = useMemo(
    () => context.clip.audioState?.editStack ?? [],
    [context.clip.audioState?.editStack],
  );
  const activeAudioEditCount = useMemo(
    () => operations.filter(operation => operation.enabled !== false).length,
    [operations],
  );
  const canUnbakeAudioEditStack = Boolean(context.clip.audioState?.bakeHistory?.at(-1)?.restore);
  const sourceType = context.clip.source?.type;
  const fileExt = (context.clip.name || '').split('.').pop()?.toLowerCase() || '';
  const isAudioClip = context.track.type === 'audio' ||
    sourceType === 'audio' ||
    AUDIO_EXTENSIONS.has(fileExt);
  const canInteract = context.track.locked !== true;
  const selectionClip = useMemo(() => ({
    id: context.clip.id,
    trackId: context.clip.trackId,
    startTime: context.clip.startTime,
    duration: Math.max(0.001, context.clip.duration),
    inPoint: context.clip.inPoint,
    outPoint: context.clip.outPoint,
    reversed: context.clip.reversed,
    waveform: context.clip.waveform,
  }), [
    context.clip.duration,
    context.clip.id,
    context.clip.inPoint,
    context.clip.outPoint,
    context.clip.reversed,
    context.clip.startTime,
    context.clip.trackId,
    context.clip.waveform,
  ]);
  const sourceTimeToDisplayTimelineTime = useCallback((sourceTime: number): number => {
    const sourceStart = Math.max(0, context.clip.inPoint ?? 0);
    const sourceEnd = Math.max(sourceStart + AUDIO_REGION_TIMELINE_EPSILON, context.clip.outPoint ?? sourceStart + Math.max(0.001, context.clip.duration));
    const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
    const timelineRatio = context.clip.reversed ? 1 - sourceRatio : sourceRatio;
    return context.clip.startTime + timelineRatio * Math.max(0.001, context.clip.duration);
  }, [
    context.clip.duration,
    context.clip.inPoint,
    context.clip.outPoint,
    context.clip.reversed,
    context.clip.startTime,
  ]);

  const overlay = resolveAudioRegionOverlay({
    selection,
    displayStartTime: context.clip.startTime,
    displayDuration: Math.max(0.001, context.clip.duration),
    width: context.geometry.clip.width,
  });

  const selectedOperation = findSelectedGainOperation(
    operations,
    selection,
  );
  const gainControl = overlay
    ? resolveAudioRegionGainControl({
        selection,
        overlayWidth: overlay.width,
        selectedOperation,
        dragState: typeof audioRegion.gainPreviewDb === 'number'
          ? {
              currentGainDb: audioRegion.gainPreviewDb,
              currentFadeInSeconds: 0,
              currentFadeOutSeconds: 0,
            }
          : null,
      })
    : null;
  const audioEditOperationOverlays = useMemo(() => {
    if (!isAudioClip || !audioFocusMode || !showAudioRegionEditMarkers || operations.length === 0) {
      return [];
    }

    return resolveAudioEditOperationOverlays({
      operations,
      audioRegionSelection: selection,
      clipId: context.clip.id,
      trackId: context.clip.trackId,
      displayStartTime: context.clip.startTime,
      displayDuration: Math.max(0.001, context.clip.duration),
      width: context.geometry.clip.width,
      trackBaseHeight: context.geometry.clip.height,
      sourceTimeToDisplayTimelineTime,
    });
  }, [
    audioFocusMode,
    context.clip.duration,
    context.clip.id,
    context.clip.startTime,
    context.clip.trackId,
    context.geometry.clip.height,
    context.geometry.clip.width,
    isAudioClip,
    operations,
    selection,
    showAudioRegionEditMarkers,
    sourceTimeToDisplayTimelineTime,
  ]);

  const resolveMoveSelection = useCallback((
    drag: AudioRegionMoveDragState,
    clientX: number,
  ) => {
    const deltaX = clientX - drag.startClientX;
    const deltaTimelineSeconds = (deltaX / Math.max(1, drag.clipWidth)) * Math.max(0.001, drag.clipDuration);
    return moveTimelineAudioRegionSelection({
      clip: selectionClip,
      selection: drag.initialSelection,
      deltaTimelineSeconds,
    });
  }, [selectionClip]);

  const resolveResizeSelection = useCallback((
    drag: AudioRegionResizeDragState,
    clientX: number,
  ) => {
    const x = Math.max(0, Math.min(drag.rectWidth, clientX - drag.rectLeft));
    const focusTimelineTime = selectionClip.startTime +
      (x / Math.max(1, drag.rectWidth)) * Math.max(0.001, selectionClip.duration);
    return resizeTimelineAudioRegionSelection({
      clip: selectionClip,
      selection: drag.initialSelection,
      edge: drag.edge,
      focusTimelineTime,
      snapThresholdSeconds: 0,
    });
  }, [selectionClip]);

  const commitAudioRegionOperationRange = useCallback((
    operationIds: string[],
    nextSelection: ClipAudioRegionSelection,
    historyLabel: string,
  ) => {
    if (operationIds.length === 0) return;
    dispatchAudioRegionCommand({
      type: 'audio-region:commit-operation-range',
      operationIds,
      selection: nextSelection,
      historyLabel,
    });
  }, [dispatchAudioRegionCommand]);

  const handleSelectionMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!canInteract || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setMoveDrag({
      startClientX: event.clientX,
      clipWidth: Math.max(1, context.geometry.clip.width),
      clipDuration: Math.max(0.001, context.clip.duration),
      initialSelection: selection,
      operationIds: getMatchingAudioRegionOperationIds(operations, selection),
    });
  }, [
    canInteract,
    context.clip.duration,
    context.geometry.clip.width,
    operations,
    selection,
  ]);

  const handleEdgeMouseDown = useCallback((edge: 'left' | 'right') => (
    event: React.MouseEvent<HTMLSpanElement>,
  ) => {
    if (!canInteract || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const shellElement = event.currentTarget.closest('.clip-interaction-shell');
    const rect = shellElement?.getBoundingClientRect();
    setResizeDrag({
      edge,
      rectLeft: rect?.left ?? context.geometry.clip.x,
      rectWidth: Math.max(1, rect?.width ?? context.geometry.clip.width),
      initialSelection: selection,
      operationIds: getMatchingAudioRegionOperationIds(operations, selection),
    });
  }, [
    canInteract,
    context.geometry.clip.width,
    context.geometry.clip.x,
    operations,
    selection,
  ]);

  const publishGainPreview = useCallback((gainInput: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    dispatchAudioRegionCommand({
      type: 'audio-region:set-gain-preview',
      preview: {
        clipId: context.clip.id,
        trackId: selection.trackId,
        startTime: selection.startTime,
        endTime: selection.endTime,
        sourceInPoint: selection.sourceInPoint,
        sourceOutPoint: selection.sourceOutPoint,
        gainDb: gainInput.gainDb,
        fadeInSeconds: gainInput.fadeInSeconds,
        fadeOutSeconds: gainInput.fadeOutSeconds,
      },
    });
  }, [context.clip.id, dispatchAudioRegionCommand, selection]);

  const commitGainEdit = useCallback((gainInput: {
    gainDb: number;
    fadeInSeconds: number;
    fadeOutSeconds: number;
  }) => {
    dispatchAudioRegionCommand({
      type: 'audio-region:set-gain-edit',
      options: {
        gainDb: gainInput.gainDb,
        fadeInSeconds: gainInput.fadeInSeconds,
        fadeOutSeconds: gainInput.fadeOutSeconds,
        keepSelection: true,
      },
    });
  }, [dispatchAudioRegionCommand]);

  const handleGainMouseDown = useCallback((mode: AudioRegionGainHandleMode) => (
    event: React.MouseEvent<HTMLButtonElement | HTMLDivElement>,
  ) => {
    if (!canInteract || event.button !== 0 || !gainControl) return;
    const regionElement = event.currentTarget.closest('.clip-audio-region-selection');
    if (!regionElement) return;

    event.preventDefault();
    event.stopPropagation();
    const rect = regionElement.getBoundingClientRect();
    const startGainDb = mode === 'gain'
      ? Number(audioRegionGainDbFromClientY(event.clientY, rect).toFixed(1))
      : gainControl.gainDb;
    publishGainPreview({
      gainDb: startGainDb,
      fadeInSeconds: gainControl.fadeInSeconds,
      fadeOutSeconds: gainControl.fadeOutSeconds,
    });
    setGainDrag({
      mode,
      regionLeft: rect.left,
      regionWidth: rect.width,
      regionTop: rect.top,
      regionHeight: rect.height,
      regionDuration: gainControl.regionDuration,
      currentGainDb: startGainDb,
      currentFadeInSeconds: gainControl.fadeInSeconds,
      currentFadeOutSeconds: gainControl.fadeOutSeconds,
    });
  }, [canInteract, gainControl, publishGainPreview]);

  const handleResetGain = useCallback(() => {
    if (!canInteract) return;
    commitGainEdit({
      gainDb: 0,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
    });
  }, [canInteract, commitGainEdit]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    if (!canInteract) return;
    event.preventDefault();
    event.stopPropagation();
    const expectedExpandedHeight = 340;
    const y = typeof window === 'undefined'
      ? event.clientY
      : Math.min(
          event.clientY,
          Math.max(8, window.innerHeight - expectedExpandedHeight - 8),
        );
    contextMenuCommandHandledRef.current = false;
    setContextMenu({ x: event.clientX, y, selection });
  }, [canInteract, selection]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleAudioEditOperationOverlayActivate = useCallback((operationOverlay: typeof audioEditOperationOverlays[number]) => {
    closeContextMenu();
    dispatchAudioRegionCommand({
      type: 'audio-region:set-selection',
      selection: operationOverlay.selection,
    });
  }, [closeContextMenu, dispatchAudioRegionCommand]);

  const handleAudioEditStackMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleToggleAudioEditOperation = useCallback((operationId: string, disabled: boolean) => {
    if (!canInteract) return;
    dispatchAudioRegionCommand({ type: 'audio-region:toggle-operation', operationId, disabled });
  }, [canInteract, dispatchAudioRegionCommand]);

  const handleRemoveAudioEditOperation = useCallback((operationId: string) => {
    if (!canInteract) return;
    dispatchAudioRegionCommand({ type: 'audio-region:remove-operation', operationId });
  }, [canInteract, dispatchAudioRegionCommand]);

  const handleBakeAudioEditStack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canInteract || audioBakePending) return;
    setAudioBakePending(true);
    const result = dispatchAudioRegionCommand({ type: 'audio-region:bake-stack' });
    if (result && typeof result === 'object' && 'finally' in result) {
      void result.finally(() => {
        setAudioBakePending(false);
      });
      return;
    }
    setAudioBakePending(false);
  }, [audioBakePending, canInteract, dispatchAudioRegionCommand]);

  const handleUnbakeAudioEditStack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canInteract || audioBakePending || !canUnbakeAudioEditStack) return;
    dispatchAudioRegionCommand({ type: 'audio-region:unbake-stack' });
  }, [audioBakePending, canInteract, canUnbakeAudioEditStack, dispatchAudioRegionCommand]);

  const handleClearAudioEditStack = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canInteract) return;
    dispatchAudioRegionCommand({ type: 'audio-region:clear-stack' });
  }, [canInteract, dispatchAudioRegionCommand]);

  const contextMenuSelection = contextMenu?.selection ?? selection;
  const contextMenuModel = useMemo(() => createAudioRegionContextMenuModel({
    hasAudioRegionClipboard,
    onSplit: () => dispatchAudioRegionCommand({ type: 'audio-region:split-selection', selection: contextMenuSelection }),
    onCut: () => dispatchAudioRegionCommand({ type: 'audio-region:cut-selection', selection: contextMenuSelection }),
    onCopy: () => dispatchAudioRegionCommand({ type: 'audio-region:copy-selection' }),
    onPaste: () => dispatchAudioRegionCommand({ type: 'audio-region:paste-selection' }),
    applyAudioRegionEdit: (editType, options) => {
      dispatchAudioRegionCommand({ type: 'audio-region:apply-edit', editType, options });
      return null;
    },
  }), [
    contextMenuSelection,
    dispatchAudioRegionCommand,
    hasAudioRegionClipboard,
  ]);

  const runContextMenuCommand = useCallback((
    command: AudioRegionContextMenuCommand,
    commandSelection: ClipAudioRegionSelection,
  ) => {
    if (contextMenuCommandHandledRef.current) return;
    if (command.disabled) return;
    contextMenuCommandHandledRef.current = true;
    dispatchAudioRegionCommand({ type: 'audio-region:set-selection', selection: commandSelection });
    command.action();
    closeContextMenu();
  }, [closeContextMenu, dispatchAudioRegionCommand]);

  const contextMenuRenderPosition = useMemo(() => {
    if (!contextMenu) return null;
    return {
      x: contextMenuPosition?.x ?? contextMenu.x,
      y: contextMenuPosition?.y ?? contextMenu.y,
    };
  }, [
    contextMenu,
    contextMenuPosition?.x,
    contextMenuPosition?.y,
  ]);

  useEffect(() => {
    if (!moveDrag || !canInteract) return undefined;

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      dispatchAudioRegionCommand({
        type: 'audio-region:set-selection',
        selection: resolveMoveSelection(moveDrag, event.clientX),
      });
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const nextSelection = resolveMoveSelection(moveDrag, event.clientX);
      dispatchAudioRegionCommand({ type: 'audio-region:set-selection', selection: nextSelection });
      commitAudioRegionOperationRange(moveDrag.operationIds, nextSelection, 'Move audio region edit');
      setMoveDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    commitAudioRegionOperationRange,
    dispatchAudioRegionCommand,
    moveDrag,
    resolveMoveSelection,
  ]);

  useEffect(() => {
    if (!resizeDrag || !canInteract) return undefined;

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      dispatchAudioRegionCommand({
        type: 'audio-region:set-selection',
        selection: resolveResizeSelection(resizeDrag, event.clientX),
      });
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const nextSelection = resolveResizeSelection(resizeDrag, event.clientX);
      dispatchAudioRegionCommand({ type: 'audio-region:set-selection', selection: nextSelection });
      commitAudioRegionOperationRange(resizeDrag.operationIds, nextSelection, 'Resize audio region edit');
      setResizeDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    commitAudioRegionOperationRange,
    dispatchAudioRegionCommand,
    resizeDrag,
    resolveResizeSelection,
  ]);

  useEffect(() => {
    if (!gainDrag || !canInteract) return undefined;

    const getNextDragState = (event: MouseEvent): AudioRegionGainDragState => {
      if (gainDrag.mode === 'gain') {
        return {
          ...gainDrag,
          currentGainDb: Number(audioRegionGainDbFromClientY(event.clientY, {
            top: gainDrag.regionTop,
            height: gainDrag.regionHeight,
          }).toFixed(1)),
        };
      }

      const localX = Math.max(0, Math.min(gainDrag.regionWidth, event.clientX - gainDrag.regionLeft));
      const secondsAtPointer = (localX / Math.max(1, gainDrag.regionWidth)) * gainDrag.regionDuration;
      const maxFadeSeconds = gainDrag.regionDuration / 2;

      return {
        ...gainDrag,
        currentFadeInSeconds: gainDrag.mode === 'fade-in'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, secondsAtPointer)).toFixed(4))
          : gainDrag.currentFadeInSeconds,
        currentFadeOutSeconds: gainDrag.mode === 'fade-out'
          ? Number(Math.max(0, Math.min(maxFadeSeconds, gainDrag.regionDuration - secondsAtPointer)).toFixed(4))
          : gainDrag.currentFadeOutSeconds,
      };
    };

    const handleDocumentMouseMove = (event: MouseEvent) => {
      event.preventDefault();
      const next = getNextDragState(event);
      publishGainPreview({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      setGainDrag(next);
    };

    const handleDocumentMouseUp = (event: MouseEvent) => {
      const next = getNextDragState(event);
      commitGainEdit({
        gainDb: next.currentGainDb,
        fadeInSeconds: next.currentFadeInSeconds,
        fadeOutSeconds: next.currentFadeOutSeconds,
      });
      dispatchAudioRegionCommand({ type: 'audio-region:clear-gain-preview' });
      setGainDrag(null);
    };

    document.addEventListener('mousemove', handleDocumentMouseMove);
    document.addEventListener('mouseup', handleDocumentMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleDocumentMouseMove);
      document.removeEventListener('mouseup', handleDocumentMouseUp);
    };
  }, [
    canInteract,
    commitGainEdit,
    dispatchAudioRegionCommand,
    gainDrag,
    publishGainPreview,
  ]);

  useEffect(() => () => {
    dispatchAudioRegionCommand({ type: 'audio-region:clear-gain-preview' });
  }, [dispatchAudioRegionCommand]);

  useEffect(() => {
    if (!contextMenu) return undefined;

    const handlePointerDown = () => closeContextMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeContextMenu, contextMenu]);

  if (!overlay) return null;

  return (
    <div
      className="shell-audio-region-module"
      data-clip-interaction-slot="audio-region"
    >
      <ClipAudioEditOperationOverlays
        overlays={audioEditOperationOverlays}
        onActivateOverlay={handleAudioEditOperationOverlayActivate}
      />
      <ClipAudioRegionSelectionOverlay
        overlay={overlay}
        snappedToZeroCrossing={Boolean(selection.snappedToZeroCrossing)}
        moving={Boolean(moveDrag)}
        resizing={Boolean(resizeDrag)}
        gainControl={gainControl}
        onSelectionMouseDown={handleSelectionMouseDown}
        onContextMenu={handleContextMenu}
        onEdgeMouseDown={handleEdgeMouseDown}
        onGainMouseDown={handleGainMouseDown}
        onResetGain={handleResetGain}
        interactive={canInteract}
      />
      {isAudioClip && audioFocusMode && (operations.length > 0 || canUnbakeAudioEditStack) && (
        <ClipAudioEditStackControls
          operations={operations}
          activeCount={activeAudioEditCount}
          audioBakePending={audioBakePending}
          canUnbakeAudioEditStack={canUnbakeAudioEditStack}
          onMouseDown={handleAudioEditStackMouseDown}
          onToggleOperation={handleToggleAudioEditOperation}
          onRemoveOperation={handleRemoveAudioEditOperation}
          onBake={handleBakeAudioEditStack}
          onUnbake={handleUnbakeAudioEditStack}
          onClear={handleClearAudioEditStack}
        />
      )}
      {contextMenu && (
        <ClipAudioRegionContextMenu
          menuRef={contextMenuRef}
          position={contextMenuRenderPosition ?? contextMenu}
          model={contextMenuModel}
          selection={contextMenu.selection}
          onRunCommand={runContextMenuCommand}
        />
      )}
    </div>
  );
}
