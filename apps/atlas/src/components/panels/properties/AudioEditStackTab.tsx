import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type {
  ClipAudioEditOperation,
  SpectralImageLayer,
  SpectralImageLayerKeyframe,
} from '../../../types/audio';
import { buildAudioRepairSuggestionsFromRefs } from '../../../services/audio/audioRepairSuggestions';
import type { AudioRepairSuggestion } from '../../../services/audio/audioRepairSuggestions';
import { audioEditPreviewService } from '../../../services/audio/AudioEditPreviewService';
import { audioRepairPreviewService } from '../../../services/audio/AudioRepairPreviewService';
import { AudioEditStackHeader } from './audioEditStack/AudioEditStackHeader';
import { AudioEditOperationStack } from './audioEditStack/AudioEditOperationStack';
import { BakeHistoryList } from './audioEditStack/BakeHistoryList';
import {
  SilenceCleanupSection,
  TransientCleanupSection,
} from './audioEditStack/CleanupSections';
import { RepairSuggestionsSection } from './audioEditStack/RepairSuggestionsSection';
import { SpectralLayerSection } from './audioEditStack/SpectralLayerSection';
import {
  createSpectralLayerKeyframe,
  getEffectiveAudioAnalysisRefs,
  replaceSpectralLayerKeyframe,
} from './audioEditStack/audioEditStackHelpers';
import type {
  EditPreviewUiState,
  RepairPreviewUiState,
  SilenceCleanupUiState,
  TransientCleanupUiState,
} from './audioEditStack/audioEditStackTypes';

interface AudioEditStackTabProps {
  clipId: string;
}

export function AudioEditStackTab({ clipId }: AudioEditStackTabProps) {
  const clip = useTimelineStore(state => state.clips.find(currentClip => currentClip.id === clipId));
  const setClipAudioEditOperationEnabled = useTimelineStore(state => state.setClipAudioEditOperationEnabled);
  const removeClipAudioEditOperation = useTimelineStore(state => state.removeClipAudioEditOperation);
  const clearClipAudioEditStack = useTimelineStore(state => state.clearClipAudioEditStack);
  const applyAudioRepairSuggestion = useTimelineStore(state => state.applyAudioRepairSuggestion);
  const detectClipSilenceRanges = useTimelineStore(state => state.detectClipSilenceRanges);
  const applyDetectedSilenceRemoval = useTimelineStore(state => state.applyDetectedSilenceRemoval);
  const applyRoomToneFill = useTimelineStore(state => state.applyRoomToneFill);
  const detectClipTransientRanges = useTimelineStore(state => state.detectClipTransientRanges);
  const applyDetectedTransientSoftening = useTimelineStore(state => state.applyDetectedTransientSoftening);
  const bakeClipAudioEditStack = useTimelineStore(state => state.bakeClipAudioEditStack);
  const unbakeClipAudioEditStack = useTimelineStore(state => state.unbakeClipAudioEditStack);
  const updateClipSpectralImageLayer = useTimelineStore(state => state.updateClipSpectralImageLayer);
  const removeClipSpectralImageLayer = useTimelineStore(state => state.removeClipSpectralImageLayer);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const audioRegionSelection = useTimelineStore(state => state.audioRegionSelection);
  const mediaFiles = useMediaStore(state => state.files);
  const imageFilesById = useMemo(() => new Map(
    mediaFiles
      .filter(file => file.type === 'image')
      .map(file => [file.id, file] as const)
  ), [mediaFiles]);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [baking, setBaking] = useState(false);
  const [repairPreview, setRepairPreview] = useState<RepairPreviewUiState | null>(null);
  const [editPreview, setEditPreview] = useState<EditPreviewUiState | null>(null);
  const [silenceThresholdDb, setSilenceThresholdDb] = useState(-50);
  const [silenceMinSeconds, setSilenceMinSeconds] = useState(0.32);
  const [silenceRippleTimeline, setSilenceRippleTimeline] = useState(false);
  const [transientCrestDb, setTransientCrestDb] = useState(18);
  const [transientMinPeakDb, setTransientMinPeakDb] = useState(-8);
  const [transientGainDb, setTransientGainDb] = useState(-6);
  const [silenceCleanup, setSilenceCleanup] = useState<SilenceCleanupUiState>({
    phase: 'idle',
    ranges: [],
  });
  const [transientCleanup, setTransientCleanup] = useState<TransientCleanupUiState>({
    phase: 'idle',
    ranges: [],
  });

  const editStack = useMemo(() => clip?.audioState?.editStack ?? [], [clip?.audioState?.editStack]);
  const effectiveAudioAnalysisRefs = useMemo(() => getEffectiveAudioAnalysisRefs(clip), [clip]);
  const repairSuggestions = useMemo(
    () => buildAudioRepairSuggestionsFromRefs(effectiveAudioAnalysisRefs),
    [effectiveAudioAnalysisRefs],
  );
  const spectralLayers = clip?.audioState?.spectralLayers ?? [];
  const bakeHistory = clip?.audioState?.bakeHistory ?? [];
  const canUnbake = Boolean(bakeHistory.at(-1)?.restore);
  const activeOperationCount = editStack.filter(operation => operation.enabled !== false).length;
  const activeSpectralLayerCount = spectralLayers.filter(layer => layer.enabled !== false).length;
  const selectedOperation = editStack.find(operation => operation.id === selectedOperationId) ?? editStack[0] ?? null;
  const hasSelectedAudioRegion = Boolean(
    audioRegionSelection &&
      audioRegionSelection.clipId === clip?.id &&
      Math.abs(audioRegionSelection.sourceOutPoint - audioRegionSelection.sourceInPoint) > 0.0005,
  );

  useEffect(() => {
    if (selectedOperationId && editStack.some(operation => operation.id === selectedOperationId)) return;
    setSelectedOperationId(editStack[0]?.id ?? null);
  }, [editStack, selectedOperationId]);

  useEffect(() => {
    setSilenceCleanup({ phase: 'idle', ranges: [] });
    setTransientCleanup({ phase: 'idle', ranges: [] });
  }, [clipId]);

  useEffect(() => () => {
    audioEditPreviewService.stop();
    audioRepairPreviewService.stop();
  }, []);

  useEffect(() => {
    if (!editPreview) return;
    if (editPreview.previewId === 'stack' && activeOperationCount > 0) return;
    if (editPreview.previewId.startsWith('operation:')) {
      const operationId = editPreview.previewId.slice('operation:'.length);
      if (editStack.some(operation => operation.id === operationId)) return;
    }
    audioEditPreviewService.stop();
    setEditPreview(null);
  }, [activeOperationCount, editPreview, editStack]);

  useEffect(() => {
    if (!repairPreview) return;
    if (repairSuggestions.some(suggestion => suggestion.id === repairPreview.suggestionId)) return;
    audioRepairPreviewService.stop();
    setRepairPreview(null);
  }, [repairPreview, repairSuggestions]);

  const stopRepairPreview = useCallback(() => {
    audioRepairPreviewService.stop();
    setRepairPreview(null);
  }, []);

  const stopEditPreview = useCallback(() => {
    audioEditPreviewService.stop();
    setEditPreview(null);
  }, []);

  const previewRepairSuggestion = useCallback(async (suggestion: AudioRepairSuggestion) => {
    if (!clip) return;
    if (repairPreview?.suggestionId === suggestion.id) {
      stopRepairPreview();
      return;
    }

    stopEditPreview();
    setRepairPreview({
      suggestionId: suggestion.id,
      phase: 'rendering',
      message: 'Rendering preview',
    });

    try {
      await audioRepairPreviewService.preview({
        clip,
        suggestion,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        onStatus: status => {
          setRepairPreview(current => {
            if (!current || current.suggestionId !== status.suggestionId) return current;
            if (status.phase === 'stopped') return null;
            return {
              suggestionId: status.suggestionId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setRepairPreview(current => current?.suggestionId === suggestion.id
        ? {
            suggestionId: suggestion.id,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [clip, playheadPosition, repairPreview?.suggestionId, stopEditPreview, stopRepairPreview]);

  const previewEditStack = useCallback(async () => {
    if (!clip || activeOperationCount === 0) return;
    const previewId = 'stack';
    if (editPreview?.previewId === previewId) {
      stopEditPreview();
      return;
    }

    stopRepairPreview();
    setEditPreview({
      previewId,
      phase: 'rendering',
      message: 'Rendering stack preview',
    });

    try {
      await audioEditPreviewService.preview({
        clip,
        operations: editStack,
        mode: 'stack',
        previewId,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        includeSpectralLayers: true,
        onStatus: status => {
          setEditPreview(current => {
            if (!current || current.previewId !== status.previewId) return current;
            if (status.phase === 'stopped') return null;
            return {
              previewId: status.previewId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setEditPreview(current => current?.previewId === previewId
        ? {
            previewId,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [activeOperationCount, clip, editPreview?.previewId, editStack, playheadPosition, stopEditPreview, stopRepairPreview]);

  const previewSourceAudio = useCallback(async () => {
    if (!clip) return;
    const previewId = 'source';
    if (editPreview?.previewId === previewId) {
      stopEditPreview();
      return;
    }

    stopRepairPreview();
    setEditPreview({
      previewId,
      phase: 'rendering',
      message: 'Rendering source preview',
    });

    try {
      await audioEditPreviewService.preview({
        clip,
        operations: [],
        mode: 'source',
        previewId,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        includeSpectralLayers: false,
        onStatus: status => {
          setEditPreview(current => {
            if (!current || current.previewId !== status.previewId) return current;
            if (status.phase === 'stopped') return null;
            return {
              previewId: status.previewId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setEditPreview(current => current?.previewId === previewId
        ? {
            previewId,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [clip, editPreview?.previewId, playheadPosition, stopEditPreview, stopRepairPreview]);

  const previewEditOperation = useCallback(async (operation: ClipAudioEditOperation) => {
    if (!clip || operation.enabled === false) return;
    const previewId = `operation:${operation.id}`;
    if (editPreview?.previewId === previewId) {
      stopEditPreview();
      return;
    }

    stopRepairPreview();
    setEditPreview({
      previewId,
      phase: 'rendering',
      message: 'Rendering operation preview',
    });

    try {
      await audioEditPreviewService.preview({
        clip,
        operations: [operation],
        mode: 'operation',
        previewId,
        timelineTime: playheadPosition,
        maxDurationSeconds: 8,
        includeSpectralLayers: false,
        onStatus: status => {
          setEditPreview(current => {
            if (!current || current.previewId !== status.previewId) return current;
            if (status.phase === 'stopped') return null;
            return {
              previewId: status.previewId,
              phase: status.phase,
              message: status.message ?? status.progress?.message,
            };
          });
        },
      });
    } catch (error) {
      setEditPreview(current => current?.previewId === previewId
        ? {
            previewId,
            phase: 'error',
            message: error instanceof Error ? error.message : 'Preview failed',
          }
        : current);
    }
  }, [clip, editPreview?.previewId, playheadPosition, stopEditPreview, stopRepairPreview]);

  if (!clip) {
    return (
      <div className="properties-tab-content audio-edit-stack-tab">
        <div className="panel-empty"><p>Select an audio clip</p></div>
      </div>
    );
  }

  const handleBake = async () => {
    if (baking || activeOperationCount === 0) return;
    stopEditPreview();
    stopRepairPreview();
    setBaking(true);
    try {
      await bakeClipAudioEditStack(clip.id);
    } finally {
      setBaking(false);
    }
  };

  const handleUnbake = () => {
    if (baking || !canUnbake) return;
    stopEditPreview();
    stopRepairPreview();
    unbakeClipAudioEditStack(clip.id);
  };

  const handleApplyRepairSuggestion = (suggestion: AudioRepairSuggestion) => {
    if (repairPreview?.suggestionId === suggestion.id) {
      stopRepairPreview();
    }
    stopEditPreview();
    applyAudioRepairSuggestion(clip.id, suggestion);
  };

  const handleClearEditStack = () => {
    stopEditPreview();
    clearClipAudioEditStack(clip.id);
  };

  const handleToggleSelectedOperation = () => {
    if (!selectedOperation) return;
    stopEditPreview();
    setClipAudioEditOperationEnabled(clip.id, selectedOperation.id, selectedOperation.enabled === false);
  };

  const handleRemoveSelectedOperation = () => {
    if (!selectedOperation) return;
    stopEditPreview();
    removeClipAudioEditOperation(clip.id, selectedOperation.id);
  };

  const handleAnalyzeSilence = async () => {
    setSilenceCleanup({ phase: 'analyzing', ranges: [], message: 'Analyzing' });
    try {
      const ranges = await detectClipSilenceRanges(clip.id, {
        thresholdDb: silenceThresholdDb,
        minSilenceSeconds: silenceMinSeconds,
      });
      setSilenceCleanup({
        phase: 'ready',
        ranges,
        message: ranges.length ? `${ranges.length} ranges` : 'No silence found',
      });
    } catch (error) {
      setSilenceCleanup({
        phase: 'error',
        ranges: [],
        message: error instanceof Error ? error.message : 'Silence analysis failed',
      });
    }
  };

  const handleApplySilenceRemoval = async () => {
    if (silenceCleanup.ranges.length === 0) return;
    stopEditPreview();
    setSilenceCleanup(current => ({ ...current, phase: 'applying', message: 'Applying' }));
    try {
      const operationIds = await applyDetectedSilenceRemoval(clip.id, {
        ranges: silenceCleanup.ranges,
        detection: {
          thresholdDb: silenceThresholdDb,
          minSilenceSeconds: silenceMinSeconds,
        },
        rippleTimeline: silenceRippleTimeline,
      });
      setSilenceCleanup({
        phase: 'ready',
        ranges: [],
        message: operationIds.length ? `${operationIds.length} edits added` : 'No silence removed',
      });
    } catch (error) {
      setSilenceCleanup(current => ({
        ...current,
        phase: 'error',
        message: error instanceof Error ? error.message : 'Silence removal failed',
      }));
    }
  };

  const handleApplyRoomToneFill = async () => {
    if (!hasSelectedAudioRegion) {
      setSilenceCleanup(current => ({
        ...current,
        phase: 'error',
        message: 'Select an audio region first',
      }));
      return;
    }

    stopEditPreview();
    setSilenceCleanup(current => ({ ...current, phase: 'applying', message: 'Filling room tone' }));
    try {
      const operationId = await applyRoomToneFill(clip.id, {
        sourceRanges: silenceCleanup.ranges,
        detection: {
          thresholdDb: silenceThresholdDb,
          minSilenceSeconds: silenceMinSeconds,
        },
      });
      setSilenceCleanup(current => ({
        ...current,
        phase: operationId ? 'ready' : 'error',
        message: operationId ? 'Room tone edit added' : 'Room tone fill needs a selected range',
      }));
    } catch (error) {
      setSilenceCleanup(current => ({
        ...current,
        phase: 'error',
        message: error instanceof Error ? error.message : 'Room tone fill failed',
      }));
    }
  };

  const handleAnalyzeTransients = async () => {
    setTransientCleanup({ phase: 'analyzing', ranges: [], message: 'Analyzing' });
    try {
      const ranges = await detectClipTransientRanges(clip.id, {
        crestThresholdDb: transientCrestDb,
        minPeakDb: transientMinPeakDb,
      });
      setTransientCleanup({
        phase: 'ready',
        ranges,
        message: ranges.length ? `${ranges.length} transients` : 'No strong transients found',
      });
    } catch (error) {
      setTransientCleanup({
        phase: 'error',
        ranges: [],
        message: error instanceof Error ? error.message : 'Transient analysis failed',
      });
    }
  };

  const handleApplyTransientSoftening = async () => {
    if (transientCleanup.ranges.length === 0) return;
    stopEditPreview();
    setTransientCleanup(current => ({ ...current, phase: 'applying', message: 'Applying' }));
    try {
      const operationIds = await applyDetectedTransientSoftening(clip.id, {
        ranges: transientCleanup.ranges,
        detection: {
          crestThresholdDb: transientCrestDb,
          minPeakDb: transientMinPeakDb,
        },
        gainDb: transientGainDb,
      });
      setTransientCleanup({
        phase: 'ready',
        ranges: [],
        message: operationIds.length ? `${operationIds.length} edits added` : 'No transients softened',
      });
    } catch (error) {
      setTransientCleanup(current => ({
        ...current,
        phase: 'error',
        message: error instanceof Error ? error.message : 'Transient softening failed',
      }));
    }
  };

  const addSpectralLayerKeyframe = (layer: SpectralImageLayer) => {
    const keyframe = createSpectralLayerKeyframe(layer, clip, playheadPosition);
    updateClipSpectralImageLayer(clip.id, layer.id, {
      keyframes: [
        ...(layer.keyframes ?? []),
        keyframe,
      ].toSorted((a, b) => a.time - b.time),
    });
  };

  const updateSpectralLayerKeyframe = (
    layer: SpectralImageLayer,
    keyframeId: string,
    patch: Partial<SpectralImageLayerKeyframe>,
  ) => {
    updateClipSpectralImageLayer(clip.id, layer.id, {
      keyframes: replaceSpectralLayerKeyframe(layer, keyframeId, patch),
    });
  };

  const removeSpectralLayerKeyframe = (layer: SpectralImageLayer, keyframeId: string) => {
    updateClipSpectralImageLayer(clip.id, layer.id, {
      keyframes: (layer.keyframes ?? []).filter(keyframe => keyframe.id !== keyframeId),
    });
  };

  return (
    <div className="properties-tab-content audio-edit-stack-tab">
      <AudioEditStackHeader
        activeOperationCount={activeOperationCount}
        activeSpectralLayerCount={activeSpectralLayerCount}
        baking={baking}
        canUnbake={canUnbake}
        editPreview={editPreview}
        editStackLength={editStack.length}
        spectralLayerCount={spectralLayers.length}
        onBake={handleBake}
        onClearEditStack={handleClearEditStack}
        onPreviewEditStack={previewEditStack}
        onPreviewSourceAudio={previewSourceAudio}
        onUnbake={handleUnbake}
      />

      <RepairSuggestionsSection
        editStack={editStack}
        repairPreview={repairPreview}
        repairSuggestions={repairSuggestions}
        onApplyRepairSuggestion={handleApplyRepairSuggestion}
        onPreviewRepairSuggestion={previewRepairSuggestion}
      />

      <SilenceCleanupSection
        hasSelectedAudioRegion={hasSelectedAudioRegion}
        silenceCleanup={silenceCleanup}
        silenceMinSeconds={silenceMinSeconds}
        silenceRippleTimeline={silenceRippleTimeline}
        silenceThresholdDb={silenceThresholdDb}
        setSilenceMinSeconds={setSilenceMinSeconds}
        setSilenceRippleTimeline={setSilenceRippleTimeline}
        setSilenceThresholdDb={setSilenceThresholdDb}
        onAnalyzeSilence={handleAnalyzeSilence}
        onApplyRoomToneFill={handleApplyRoomToneFill}
        onApplySilenceRemoval={handleApplySilenceRemoval}
      />

      <TransientCleanupSection
        transientCleanup={transientCleanup}
        transientCrestDb={transientCrestDb}
        transientGainDb={transientGainDb}
        transientMinPeakDb={transientMinPeakDb}
        setTransientCrestDb={setTransientCrestDb}
        setTransientGainDb={setTransientGainDb}
        setTransientMinPeakDb={setTransientMinPeakDb}
        onAnalyzeTransients={handleAnalyzeTransients}
        onApplyTransientSoftening={handleApplyTransientSoftening}
      />

      <AudioEditOperationStack
        editPreview={editPreview}
        editStack={editStack}
        selectedOperation={selectedOperation}
        onPreviewEditOperation={previewEditOperation}
        onRemoveSelectedOperation={handleRemoveSelectedOperation}
        onSelectOperation={setSelectedOperationId}
        onToggleSelectedOperation={handleToggleSelectedOperation}
      />

      <SpectralLayerSection
        activeSpectralLayerCount={activeSpectralLayerCount}
        imageFilesById={imageFilesById}
        spectralLayers={spectralLayers}
        onAddSpectralLayerKeyframe={addSpectralLayerKeyframe}
        onRemoveSpectralLayer={(layerId) => removeClipSpectralImageLayer(clip.id, layerId)}
        onRemoveSpectralLayerKeyframe={removeSpectralLayerKeyframe}
        onToggleSpectralLayer={(layer) => updateClipSpectralImageLayer(clip.id, layer.id, { enabled: layer.enabled === false })}
        onUpdateSpectralLayer={(layerId, patch) => updateClipSpectralImageLayer(clip.id, layerId, patch)}
        onUpdateSpectralLayerKeyframe={updateSpectralLayerKeyframe}
      />

      <BakeHistoryList bakeHistory={bakeHistory} />
    </div>
  );
}
