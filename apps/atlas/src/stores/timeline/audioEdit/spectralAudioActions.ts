import type { ClipAudioEditOperation } from '../../../types';
import type { AudioEditActions, SliceCreator } from '../types';
import { Logger } from '../../../services/logger';
import { captureSnapshot } from '../../historyStore';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import { createAudioEditOperationId, isAudioClip } from './audioEditHelpers';
import {
  createSpectralLayerId,
  normalizeSpectralLayer,
  spectralOperationLabel,
} from './spectralLayerHelpers';

const log = Logger.create('TimelineAudioEdit');

type SpectralAudioActions = Pick<
  AudioEditActions,
  | 'applySpectralRegionEdit'
  | 'addClipSpectralImageLayer'
  | 'updateClipSpectralImageLayer'
  | 'removeClipSpectralImageLayer'
>;

export const createSpectralAudioActions: SliceCreator<SpectralAudioActions> = (set, get) => ({
  applySpectralRegionEdit: (type, options = {}) => {
    const { audioSpectralRegionSelection, clips, tracks } = get();
    if (!audioSpectralRegionSelection) {
      log.warn('Cannot apply spectral edit without an active spectral selection');
      return null;
    }

    const clip = clips.find(c => c.id === audioSpectralRegionSelection.clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot apply spectral edit to missing or non-audio clip', {
        clipId: audioSpectralRegionSelection.clipId,
      });
      return null;
    }

    const track = tracks.find(t => t.id === audioSpectralRegionSelection.trackId);
    if (track?.locked) {
      log.warn('Cannot apply spectral edit on locked track', {
        clipId: clip.id,
        trackId: audioSpectralRegionSelection.trackId,
      });
      return null;
    }

    const start = Math.max(0, Math.min(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint));
    const end = Math.max(start, Math.max(audioSpectralRegionSelection.sourceInPoint, audioSpectralRegionSelection.sourceOutPoint));
    const frequencyMinHz = Math.max(0, Math.min(audioSpectralRegionSelection.frequencyMinHz, audioSpectralRegionSelection.frequencyMaxHz));
    const frequencyMaxHz = Math.max(frequencyMinHz, Math.max(audioSpectralRegionSelection.frequencyMinHz, audioSpectralRegionSelection.frequencyMaxHz));

    if (end - start <= 0.0005 || frequencyMaxHz - frequencyMinHz <= 1) {
      log.warn('Cannot apply spectral edit to an empty time/frequency region', {
        clipId: clip.id,
        start,
        end,
        frequencyMinHz,
        frequencyMaxHz,
      });
      return null;
    }

    const operation: ClipAudioEditOperation = {
      id: createAudioEditOperationId(),
      type,
      enabled: true,
      params: {
        label: spectralOperationLabel(type),
        timelineStart: audioSpectralRegionSelection.startTime,
        timelineEnd: audioSpectralRegionSelection.endTime,
        frequencyMinHz,
        frequencyMaxHz,
        selectionMode: audioSpectralRegionSelection.selectionMode ?? 'rectangle',
        ...(audioSpectralRegionSelection.selectionMode === 'brush'
          ? {
              brushShape: 'soft-ellipse',
              brushTimeRadiusSeconds: audioSpectralRegionSelection.brushTimeRadiusSeconds ?? Math.max(0.001, (end - start) / 2),
              brushFrequencyRadiusHz: audioSpectralRegionSelection.brushFrequencyRadiusHz ?? Math.max(1, (frequencyMaxHz - frequencyMinHz) / 2),
            }
          : {}),
        blendMode: type === 'spectral-mask' ? 'attenuate' : 'replace',
        gainDb: type === 'spectral-mask' ? -18 : 6,
        featherTime: audioSpectralRegionSelection.selectionMode === 'brush' ? Math.max(0.015, (end - start) * 0.35) : 0.015,
        featherFrequencyHz: Math.max(12, (frequencyMaxHz - frequencyMinHz) * (audioSpectralRegionSelection.selectionMode === 'brush' ? 0.22 : 0.05)),
        ...(options.params ?? {}),
      },
      timeRange: { start, end },
      ...(options.channelMask ? { channelMask: [...options.channelMask] } : {}),
      createdAt: Date.now(),
    };

    captureSnapshot(spectralOperationLabel(type));
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clip.id) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            editStack: [
              ...(audioState.editStack ?? []),
              operation,
            ],
          },
        });
      }),
      ...(options.keepSelection ? {} : { audioSpectralRegionSelection: null }),
    });
    get().invalidateCache();
    return operation.id;
  },

  addClipSpectralImageLayer: (clipId, layerInput) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !isAudioClip(clip)) {
      log.warn('Cannot add spectral image layer to missing or non-audio clip', { clipId });
      return null;
    }
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot add spectral image layer on locked track', { clipId, trackId: clip.trackId });
      return null;
    }

    const layer = normalizeSpectralLayer({
      ...layerInput,
      id: layerInput.id ?? createSpectralLayerId(),
    });

    captureSnapshot('Add spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        const audioState = currentClip.audioState ?? {};
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...audioState,
            spectralLayers: [
              ...(audioState.spectralLayers ?? []),
              layer,
            ],
          },
        });
      }),
    });
    get().invalidateCache();
    return layer.id;
  },

  updateClipSpectralImageLayer: (clipId, layerId, patch) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot update spectral image layer on locked track', { clipId, layerId });
      return;
    }

    captureSnapshot('Update spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.spectralLayers?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            spectralLayers: currentClip.audioState.spectralLayers.map(layer =>
              layer.id === layerId
                ? normalizeSpectralLayer({ ...layer, ...patch })
                : layer
            ),
          },
        });
      }),
    });
    get().invalidateCache();
  },

  removeClipSpectralImageLayer: (clipId, layerId) => {
    const { clips, tracks } = get();
    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;
    const track = tracks.find(t => t.id === clip.trackId);
    if (track?.locked) {
      log.warn('Cannot remove spectral image layer on locked track', { clipId, layerId });
      return;
    }

    captureSnapshot('Remove spectral image layer');
    set({
      clips: clips.map(currentClip => {
        if (currentClip.id !== clipId || !currentClip.audioState?.spectralLayers?.length) return currentClip;
        return clearProcessedAudioAnalysisRefs({
          ...currentClip,
          audioState: {
            ...currentClip.audioState,
            spectralLayers: currentClip.audioState.spectralLayers.filter(layer => layer.id !== layerId),
          },
        });
      }),
    });
    get().invalidateCache();
  },
});
