import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import {
  addAudioEqBand,
  removeAudioEqBand,
} from '../../../engine/audio/eq/AudioEqOperations';
import {
  applyAudioEqCurveFit,
  applyAudioEqMatch,
  type AudioEqCurvePoint,
} from '../../../engine/audio/eq/AudioEqCurveFitting';
import {
  applyAudioEqSpectrumGrabPeak,
  detectAudioEqSpectrumGrabPeaks,
  type AudioEqSpectrumGrabPeak,
} from '../../../engine/audio/eq/AudioEqSpectrumGrab';
import {
  applyAudioEqPreset,
  createAudioEqParamsForPresetKind,
} from '../../../engine/audio/eq/AudioEqPresets';
import {
  copyAudioEqBands,
  copyAudioEqCurve,
  parseAudioEqClipboardPayload,
  pasteAudioEqClipboardPayload,
  serializeAudioEqClipboardPayload,
} from '../../../engine/audio/eq/AudioEqClipboard';
import {
  createAudioEqABState,
  switchAudioEqABSlot,
  syncAudioEqABActiveSlot,
} from '../../../engine/audio/eq/AudioEqAB';
import {
  createAudioEqGraphViewModel,
  frequencyToGraphX,
} from '../../../engine/audio/eq/AudioEqGraphViewModel';
import type {
  AudioEqAnalyzerView,
  AudioEqBand,
  AudioEqBandDynamics,
  AudioEqBandSpectralDynamics,
  AudioEqBandType,
  AudioEqParamsV2,
  AudioEqPresetKind,
} from '../../../engine/audio/eq/AudioEqTypes';
import type { AudioEqABSlot, AudioEqABState } from '../../../engine/audio/eq/AudioEqAB';
import type { AudioEffectParamValue } from '../../../types';
import { EffectKeyframeToggle } from './shared';
import { createAudioEqBandNumericProperty, getAudioEqBandNumericKeyframeEntries } from './audioEqKeyframes';
import {
  type FlexEqCanvasRenderCache,
  type FlexEqDrawState,
  type FlexEqGraphMode,
  drawEqualizerCanvas,
} from './flexEqualizer/canvasRenderer';
import {
  GRAPH_MAX_FREQUENCY_HZ,
  GRAPH_MIN_FREQUENCY_HZ,
  bandHasFrequencyHandle,
  bandNeedsGain,
  clamp,
  createDefaultBandDynamics,
  createDefaultBandSpectralDynamics,
  graphXToFrequency,
  graphYToDb,
  quantize,
} from './flexEqualizer/graphMath';
import type { FlexEqAdvancedPanel } from './flexEqualizer/BandAdvancedPanels';
import { ControlModule } from './flexEqualizer/ControlModule';
import { GraphStage } from './flexEqualizer/GraphStage';
import { PresetBrowserPanel } from './flexEqualizer/PresetBrowserPanel';
import { UtilityStrip } from './flexEqualizer/UtilityStrip';
import { useBandDragCommits } from './flexEqualizer/useBandDragCommits';
import { useFitVisiblePanelHeight } from './flexEqualizer/useFitVisiblePanelHeight';
import { useFlexEqualizerPresetBrowser } from './flexEqualizer/useFlexEqualizerPresetBrowser';
import { useEqualizerGraphSize } from './flexEqualizer/useEqualizerGraphSize';
import { useRuntimeAnalyzerStream, type RuntimeAnalyzerScope } from './useThrottledRuntimeAnalyzer';
import './flexEqualizer/flexEqControlModule.css';

export interface FlexEqualizerControlProps {
  params: unknown;
  compact?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  analyzer?: AudioEqAnalyzerView;
  runtimeAnalyzerScope?: RuntimeAnalyzerScope;
  runtimeAnalyzerTrackId?: string;
  keyframeClipId?: string;
  effectId?: string;
  onUpdateParamPath?: (path: string, value: AudioEffectParamValue) => void;
  onChangeParams?: (params: AudioEqParamsV2) => void;
}

export function FlexEqualizerControl({
  params,
  compact = false,
  disabled = false,
  ariaLabel = 'Equalizer',
  analyzer,
  runtimeAnalyzerScope,
  runtimeAnalyzerTrackId,
  keyframeClipId,
  effectId,
  onUpdateParamPath,
  onChangeParams,
}: FlexEqualizerControlProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeBandIdRef = useRef<string | null>(null);
  const activeSketchPointerIdRef = useRef<number | null>(null);
  const drawStateRef = useRef<FlexEqDrawState | null>(null);
  const drawFrameRef = useRef<number | null>(null);
  const analyzerRef = useRef<AudioEqAnalyzerView | undefined>(analyzer);
  const renderCacheRef = useRef<FlexEqCanvasRenderCache>({});
  const staticVersionRef = useRef(0);
  useFitVisiblePanelHeight(rootRef);
  const size = useEqualizerGraphSize(stageRef);
  const normalized = useMemo(() => normalizeAudioEqParams(params), [params]);
  const selectedBandIds = useMemo(
    () => normalized.display.selectedBandIds ?? [],
    [normalized.display.selectedBandIds],
  );
  const soloBandIds = useMemo(
    () => normalized.display.soloBandIds ?? [],
    [normalized.display.soloBandIds],
  );
  const selectedBandId = selectedBandIds[0] ?? normalized.audible.bands[0]?.id;
  const selectedBand = normalized.audible.bands.find(band => band.id === selectedBandId) ?? normalized.audible.bands[0];
  const [hoveredBandId, setHoveredBandId] = useState<string | undefined>();
  const [abState, setAbState] = useState<AudioEqABState>(() => createAudioEqABState(normalized));
  const [graphMode, setGraphMode] = useState<FlexEqGraphMode>('edit');
  const [sketchPoints, setSketchPoints] = useState<AudioEqCurvePoint[]>([]);
  const [matchSource, setMatchSource] = useState<Float32Array | undefined>();
  const [matchTarget, setMatchTarget] = useState<Float32Array | undefined>();
  const [advancedPanel, setAdvancedPanel] = useState<FlexEqAdvancedPanel>('none');
  const presetBrowser = useFlexEqualizerPresetBrowser(normalized, disabled);

  const view = useMemo(() => createAudioEqGraphViewModel(normalized, {
    width: size.width,
    height: size.height,
    hoveredBandId,
  }), [hoveredBandId, normalized, size.height, size.width]);
  const selectedBandAllKeyframeEntries = useMemo(
    () => selectedBand && effectId ? getAudioEqBandNumericKeyframeEntries(effectId, selectedBand) : [],
    [effectId, selectedBand],
  );

  const scheduleCanvasDraw = useCallback(() => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      const canvas = canvasRef.current;
      const drawState = drawStateRef.current;
      if (canvas && drawState) {
        drawState.analyzer = analyzerRef.current;
        drawEqualizerCanvas(
          canvas,
          renderCacheRef.current,
          drawState.view,
          drawState.params,
          drawState.analyzer,
          drawState.hoveredBandId,
          drawState.selectedBandIds,
          drawState.soloBandIds,
          drawState.graphMode,
          drawState.sketchPoints,
          drawState.staticVersion,
        );
      }
      return;
    }

    if (drawFrameRef.current !== null) return;
    drawFrameRef.current = window.requestAnimationFrame(() => {
      drawFrameRef.current = null;
      const canvas = canvasRef.current;
      const drawState = drawStateRef.current;
      if (!canvas || !drawState) return;
      drawState.analyzer = analyzerRef.current;
      drawEqualizerCanvas(
        canvas,
        renderCacheRef.current,
        drawState.view,
        drawState.params,
        drawState.analyzer,
        drawState.hoveredBandId,
        drawState.selectedBandIds,
        drawState.soloBandIds,
        drawState.graphMode,
        drawState.sketchPoints,
        drawState.staticVersion,
      );
    });
  }, []);

  const usesRuntimeAnalyzer = runtimeAnalyzerScope === 'master' ||
    (runtimeAnalyzerScope === 'track' && Boolean(runtimeAnalyzerTrackId));
  const runtimeHasAnalyzer = useRuntimeAnalyzerStream(
    usesRuntimeAnalyzer ? runtimeAnalyzerScope : undefined,
    runtimeAnalyzerTrackId,
    analyzerRef,
    scheduleCanvasDraw,
  );
  const hasAnalyzer = usesRuntimeAnalyzer ? runtimeHasAnalyzer : Boolean(analyzer);

  useEffect(() => {
    if (usesRuntimeAnalyzer) return;
    analyzerRef.current = analyzer;
    scheduleCanvasDraw();
  }, [analyzer, scheduleCanvasDraw, usesRuntimeAnalyzer]);

  useEffect(() => {
    staticVersionRef.current += 1;
    drawStateRef.current = {
      view,
      params: normalized,
      analyzer: analyzerRef.current,
      hoveredBandId,
      selectedBandIds,
      soloBandIds,
      graphMode,
      sketchPoints,
      staticVersion: staticVersionRef.current,
    };
    scheduleCanvasDraw();
  }, [graphMode, hoveredBandId, normalized, scheduleCanvasDraw, selectedBandIds, sketchPoints, soloBandIds, view]);

  useEffect(() => () => {
    drawStateRef.current = null;
    if (
      drawFrameRef.current !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(drawFrameRef.current);
      drawFrameRef.current = null;
    }
  }, []);

  const commitParams = (next: AudioEqParamsV2) => {
    onChangeParams?.(next);
  };

  const updatePath = (path: string, value: AudioEffectParamValue) => {
    onUpdateParamPath?.(path, value);
  };

  const setSelectedBand = (bandId: string) => {
    updatePath('eq.display.selectedBandIds', [bandId]);
  };

  const toggleSoloBand = (bandId: string) => {
    const current = new Set(soloBandIds);
    if (current.has(bandId)) {
      current.delete(bandId);
    } else {
      current.add(bandId);
    }
    updatePath('eq.display.soloBandIds', [...current]);
  };

  const updateBand = (bandId: string, patch: Partial<AudioEqBand>) => {
    if (patch.frequencyHz !== undefined) updatePath(`eq.audible.bands.${bandId}.frequencyHz`, patch.frequencyHz);
    if (patch.gainDb !== undefined) updatePath(`eq.audible.bands.${bandId}.gainDb`, patch.gainDb);
    if (patch.q !== undefined) updatePath(`eq.audible.bands.${bandId}.q`, patch.q);
    if (patch.type !== undefined) updatePath(`eq.audible.bands.${bandId}.type`, patch.type);
    if (patch.enabled !== undefined) updatePath(`eq.audible.bands.${bandId}.enabled`, patch.enabled);
    if (patch.slopeDbPerOct !== undefined) updatePath(`eq.audible.bands.${bandId}.slopeDbPerOct`, patch.slopeDbPerOct);
    if (patch.brickwall !== undefined) updatePath(`eq.audible.bands.${bandId}.brickwall`, patch.brickwall);
    if (patch.dynamic !== undefined) updatePath(`eq.audible.bands.${bandId}.dynamic`, patch.dynamic as unknown as AudioEffectParamValue);
    if (patch.spectralDynamics !== undefined) updatePath(`eq.audible.bands.${bandId}.spectralDynamics`, patch.spectralDynamics as unknown as AudioEffectParamValue);
  };

  const { scheduleBandDragCommit, flushBandDragCommit } = useBandDragCommits(updateBand);

  const updateBandDynamics = (band: AudioEqBand, patch: Partial<AudioEqBandDynamics>) => {
    updateBand(band.id, {
      dynamic: {
        ...(band.dynamic ?? createDefaultBandDynamics()),
        ...patch,
      },
    });
  };

  const updateBandSpectralDynamics = (band: AudioEqBand, patch: Partial<AudioEqBandSpectralDynamics>) => {
    updateBand(band.id, {
      spectralDynamics: {
        ...(band.spectralDynamics ?? createDefaultBandSpectralDynamics()),
        ...patch,
      },
    });
  };

  const renderBandNumericKeyframeToggle = (band: AudioEqBand, paramPath: string, value: number) => (
    keyframeClipId && effectId
      ? (
          <EffectKeyframeToggle
            clipId={keyframeClipId}
            property={createAudioEqBandNumericProperty(effectId, band.id, paramPath)}
            value={value}
          />
        )
      : null
  );

  const graphPointToCurvePoint = (point: { x: number; y: number }): AudioEqCurvePoint => ({
    frequencyHz: clamp(graphXToFrequency(point.x, size.width), GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ),
    gainDb: clamp(graphYToDb(point.y, size.height, normalized.display.graphRangeDb), -30, 30),
  });

  const copySpectrumSnapshot = (values: Float32Array | undefined): Float32Array | undefined => {
    if (!values) return undefined;
    const copy = new Float32Array(values.length);
    copy.set(values);
    return copy;
  };

  const currentSpectrumSnapshot = () => copySpectrumSnapshot(analyzerRef.current?.postDb ?? analyzerRef.current?.preDb);

  const captureMatchSource = () => {
    if (disabled) return;
    setMatchSource(currentSpectrumSnapshot());
  };

  const captureMatchTarget = () => {
    if (disabled) return;
    setMatchTarget(currentSpectrumSnapshot());
  };

  const applyCapturedMatch = () => {
    if (disabled || !matchSource || !matchTarget) return;
    commitParams(applyAudioEqMatch(normalized, matchSource, matchTarget, {
      amount: 0.85,
      smoothing: 0.45,
      maxBands: 8,
    }));
    setGraphMode('edit');
  };

  const nearestGrabPeak = (x: number): AudioEqSpectrumGrabPeak | null => {
    let best: AudioEqSpectrumGrabPeak | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const grabPeaks = detectAudioEqSpectrumGrabPeaks(
      analyzerRef.current?.postDb ?? analyzerRef.current?.preDb,
      { maxPeaks: 8 },
    );
    for (const peak of grabPeaks) {
      const distance = Math.abs(frequencyToGraphX(peak.frequencyHz, size.width) - x);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = peak;
      }
    }
    return bestDistance <= 16 ? best : null;
  };

  const getPoint = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp(event.clientX - rect.left, 0, rect.width),
      y: clamp(event.clientY - rect.top, 0, rect.height),
    };
  };

  const nearestBandId = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const band of view.bandResponses) {
      const dx = band.handle.x - x;
      const dy = (band.handle.y - y) * 1.35;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = band.bandId;
      }
    }
    return best;
  };

  const updateBandFromPointer = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    bandId: string,
  ) => {
    if (disabled) return;
    const point = getPoint(event);
    if (!point) return;
    const band = normalized.audible.bands.find(candidate => candidate.id === bandId);
    if (!band || !bandHasFrequencyHandle(band)) return;

    const nextFrequency = clamp(graphXToFrequency(point.x, size.width), GRAPH_MIN_FREQUENCY_HZ, GRAPH_MAX_FREQUENCY_HZ);
    const nextGain = bandNeedsGain(band)
      ? clamp(graphYToDb(point.y, size.height, normalized.display.graphRangeDb), -60, 60)
      : band.gainDb;
    scheduleBandDragCommit(bandId, {
      frequencyHz: quantize(nextFrequency, nextFrequency < 100 ? 1 : nextFrequency < 1000 ? 5 : 10),
      gainDb: nextGain,
    });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled || event.button !== 0) return;
    const point = getPoint(event);
    if (!point) return;

    if (graphMode === 'sketch') {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      activeSketchPointerIdRef.current = event.pointerId;
      setSketchPoints([graphPointToCurvePoint(point)]);
      return;
    }

    if (graphMode === 'grab') {
      const peak = nearestGrabPeak(point.x);
      if (!peak) return;
      event.preventDefault();
      commitParams(applyAudioEqSpectrumGrabPeak(normalized, peak, { replaceNearest: true }));
      setGraphMode('edit');
      return;
    }

    const bandId = nearestBandId(point.x, point.y);
    if (!bandId) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    activeBandIdRef.current = bandId;
    setSelectedBand(bandId);
    updateBandFromPointer(event, bandId);
    // Commit the initial grab immediately so the band snaps to the pointer
    // without waiting for the first coalescing frame.
    flushBandDragCommit();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getPoint(event);

    if (graphMode === 'sketch' && activeSketchPointerIdRef.current === event.pointerId && point) {
      event.preventDefault();
      const nextPoint = graphPointToCurvePoint(point);
      setSketchPoints(current => {
        const previous = current[current.length - 1];
        if (
          previous &&
          Math.abs(Math.log2(previous.frequencyHz / nextPoint.frequencyHz)) < 0.01 &&
          Math.abs(previous.gainDb - nextPoint.gainDb) < 0.15
        ) {
          return current;
        }
        return [...current, nextPoint].slice(-160);
      });
      return;
    }

    if (point && activePointerIdRef.current === null) {
      setHoveredBandId(nearestBandId(point.x, point.y) ?? undefined);
    }

    if (activePointerIdRef.current !== event.pointerId || !activeBandIdRef.current) {
      return;
    }

    event.preventDefault();
    updateBandFromPointer(event, activeBandIdRef.current);
  };

  const finishPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activeSketchPointerIdRef.current === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture can already be released.
      }
      activeSketchPointerIdRef.current = null;
      const completedSketch = sketchPoints;
      setSketchPoints([]);
      if (completedSketch.length >= 3) {
        commitParams(applyAudioEqCurveFit(normalized, completedSketch, {
          maxBands: 8,
          source: 'sketch',
        }));
        setGraphMode('edit');
      }
      return;
    }

    if (activePointerIdRef.current !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture can already be released.
    }
    activePointerIdRef.current = null;
    activeBandIdRef.current = null;
    flushBandDragCommit();
  };

  const addBand = (type: AudioEqBandType, frequencyHz: number) => {
    if (disabled) return;
    commitParams(addAudioEqBand(normalized, {
      type,
      frequencyHz,
      gainDb: type === 'low-cut' || type === 'high-cut' || type === 'notch' ? 0 : 1.5,
      q: type === 'low-cut' || type === 'high-cut' ? 0.707 : 1.1,
    }));
  };

  const updatePresetKind = (kind: AudioEqPresetKind) => {
    if (disabled) return;
    if (kind === 'custom') {
      updatePath('eq.audible.presetKind', 'custom');
      return;
    }
    commitParams(createAudioEqParamsForPresetKind(kind));
  };

  const applyBrowserPreset = (presetId: string) => {
    if (disabled || !presetId) return;
    const preset = presetBrowser.browserPresets.find(candidate => candidate.id === presetId);
    if (!preset) return;
    commitParams(applyAudioEqPreset(normalized, preset, 'full'));
  };

  const switchABSlot = (slot: AudioEqABSlot) => {
    if (disabled || abState.activeSlot === slot) return;
    const result = switchAudioEqABSlot(abState, normalized, slot);
    setAbState(result.state);
    commitParams(result.params);
  };

  const syncActiveABSlot = () => {
    setAbState(current => syncAudioEqABActiveSlot(current, normalized));
  };

  const writeClipboardPayload = async (payloadText: string) => {
    await navigator.clipboard.writeText(payloadText);
  };

  const handleCopyCurve = async () => {
    if (disabled || !navigator.clipboard) return;
    try {
      await writeClipboardPayload(serializeAudioEqClipboardPayload(copyAudioEqCurve(normalized)));
    } catch {
      // Clipboard permission can be unavailable in embedded or headless contexts.
    }
  };

  const handleCopyBands = async () => {
    if (disabled || !navigator.clipboard) return;
    const ids = selectedBandIds.length > 0
      ? selectedBandIds
      : selectedBand
        ? [selectedBand.id]
        : [];
    try {
      await writeClipboardPayload(serializeAudioEqClipboardPayload(copyAudioEqBands(normalized, ids)));
    } catch {
      // Clipboard permission can be unavailable in embedded or headless contexts.
    }
  };

  const handlePaste = async () => {
    if (disabled || !navigator.clipboard) return;
    try {
      const payload = parseAudioEqClipboardPayload(await navigator.clipboard.readText());
      if (!payload) return;
      commitParams(pasteAudioEqClipboardPayload(
        normalized,
        payload,
        payload.scope === 'bands' ? 'append' : 'replace',
      ));
    } catch {
      // Clipboard permission can be unavailable in embedded or headless contexts.
    }
  };

  const handlePointerLeave = () => {
    if (activePointerIdRef.current === null) setHoveredBandId(undefined);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (!hoveredBandId) return;
    updateBand(hoveredBandId, { gainDb: 0 });
  };

  return (
    <div ref={rootRef} className={`flex-eq flex-eq-hw ${compact ? 'compact' : ''}`}>
      <div className="flex-eq-rack">
        <div className="flex-eq-display">
          <GraphStage
            ariaLabel={ariaLabel}
            stageRef={stageRef}
            canvasRef={canvasRef}
            handlePointerDown={handlePointerDown}
            handlePointerMove={handlePointerMove}
            finishPointer={finishPointer}
            handlePointerLeave={handlePointerLeave}
            handleContextMenu={handleContextMenu}
          />

          <ControlModule
            compact={compact}
            disabled={disabled}
            effectId={effectId}
            keyframeClipId={keyframeClipId}
            normalized={normalized}
            selectedBand={selectedBand}
            selectedBandAllKeyframeEntries={selectedBandAllKeyframeEntries}
            soloBandIds={soloBandIds}
            advancedPanel={advancedPanel}
            setAdvancedPanel={setAdvancedPanel}
            toggleSoloBand={toggleSoloBand}
            updateBand={updateBand}
            scheduleBandDragCommit={scheduleBandDragCommit}
            flushBandDragCommit={flushBandDragCommit}
            updateBandDynamics={updateBandDynamics}
            updateBandSpectralDynamics={updateBandSpectralDynamics}
            removeSelectedBand={() => {
              if (selectedBand) commitParams(removeAudioEqBand(normalized, selectedBand.id));
            }}
            renderBandNumericKeyframeToggle={renderBandNumericKeyframeToggle}
            utilitySlot={(
              <UtilityStrip
                disabled={disabled}
                normalized={normalized}
                graphMode={graphMode}
                hasAnalyzer={hasAnalyzer}
                showPresetBrowser={presetBrowser.showPresetBrowser}
                matchSourceActive={Boolean(matchSource)}
                matchTargetActive={Boolean(matchTarget)}
                canApplyMatch={Boolean(matchSource && matchTarget)}
                activeABSlot={abState.activeSlot}
                hasSelectedBand={Boolean(selectedBand)}
                setShowPresetBrowser={presetBrowser.setShowPresetBrowser}
                setGraphMode={setGraphMode}
                setSketchPoints={setSketchPoints}
                updatePresetKind={updatePresetKind}
                updatePath={(path, value) => updatePath(path, value)}
                switchABSlot={switchABSlot}
                syncActiveABSlot={syncActiveABSlot}
                handleCopyCurve={() => void handleCopyCurve()}
                handleCopyBands={() => void handleCopyBands()}
                handlePaste={() => void handlePaste()}
                captureMatchSource={captureMatchSource}
                captureMatchTarget={captureMatchTarget}
                applyCapturedMatch={applyCapturedMatch}
                addBand={addBand}
              />
            )}
            presetBrowserSlot={presetBrowser.showPresetBrowser ? (
              <PresetBrowserPanel
                compact={compact}
                disabled={disabled}
                presetQuery={presetBrowser.presetQuery}
                presetTagFilter={presetBrowser.presetTagFilter}
                presetFilter={presetBrowser.presetFilter}
                presetTags={presetBrowser.presetTags}
                filteredPresets={presetBrowser.filteredPresets}
                setPresetQuery={presetBrowser.setPresetQuery}
                setPresetTagFilter={presetBrowser.setPresetTagFilter}
                setPresetFilter={presetBrowser.setPresetFilter}
                saveCurrentUserPreset={presetBrowser.saveCurrentUserPreset}
                applyBrowserPreset={applyBrowserPreset}
                toggleBrowserPresetFavorite={presetBrowser.toggleBrowserPresetFavorite}
                deleteBrowserPreset={presetBrowser.deleteBrowserPreset}
              />
            ) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
