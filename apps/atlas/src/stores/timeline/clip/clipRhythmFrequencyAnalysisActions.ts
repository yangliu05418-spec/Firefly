import { Logger } from '../../../services/logger';
import { updateClipById } from '../helpers/clipStateHelpers';
import { BeatOnsetAnalysisGenerator } from '../../../services/audio/BeatOnsetAnalysisGenerator';
import {
  primeTimelineBeatGridCache,
  primeTimelineOnsetMapCache,
  readTimelineBeatGrid,
  readTimelineOnsetMap,
} from '../../../services/audio/timelineBeatOnsetCache';
import { FrequencyPhaseAnalysisGenerator } from '../../../services/audio/FrequencyPhaseAnalysisGenerator';
import {
  primeTimelineFrequencySummaryCache,
  primeTimelinePhaseCorrelationCache,
  readTimelineFrequencySummary,
  readTimelinePhaseCorrelation,
} from '../../../services/audio/timelineFrequencyPhaseCache';
import { createCurrentAudioArtifactStore } from '../../../services/audio/timelineWaveformPyramidCache';
import { isPreparedClipAudioAnalysisInputStale } from '../../../services/audio/ClipAudioAnalysisOrchestrator';
import { clipAudioAnalysisJobService } from '../../../services/audio/ClipAudioAnalysisJobService';
import type { GenerateClipAudioAnalysisOptions } from '../types';
import type { ClipActionContext } from './clipActionContext';
import {
  clearAudioAnalysisJobUpdate,
  createAudioAnalysisJobUpdate,
  isAudioAnalysisCancellation,
  updateAudioAnalysisJobProgress,
} from './clipAudioAnalysisShared';
import {
  getPreparedProgress,
  prepareAnalysisInput,
  shouldSkipPreparedAnalysis,
} from './clipPreparedAudioAnalysisCore';

const log = Logger.create('ClipRhythmFrequencyAnalysis');

export async function generateBeatOnsetForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  const state = shouldSkipPreparedAnalysis(context, clipId, options, refs => !!refs?.beatGridId && !!refs.onsetMapId, refs => !!refs?.beatGridId && !!refs.onsetMapId);
  if (!state) return;

  set({ clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
    kind: 'beat-onset-analysis',
    label: 'Beat/Onset',
    artifactKinds: ['beat-grid', 'onset-map'],
    processed: state.needsProcessed,
  })) });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'beat-onset-analysis' }, async ({ signal }) => {
      const prepared = await prepareAnalysisInput(context, clipId, state.needsProcessed, signal, 'No audio source found for beat/onset analysis');
      if (!prepared) return;

      const store = createCurrentAudioArtifactStore();
      const generator = new BeatOnsetAnalysisGenerator({ artifactStore: store });
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        clipAudioStateHash: prepared.clipAudioStateHash,
        decoderId: prepared.decoderId,
        decoderVersion: prepared.decoderVersion,
        metadata: prepared.metadata,
      }, {
        signal,
        onProgress: (progress) => set({ clips: updateAudioAnalysisJobProgress(get().clips, clipId, getPreparedProgress(progress.percent, state.needsProcessed), progress.phase.startsWith('storing') ? 'storing' : 'analyzing', progress.message) }),
      });

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip || isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }
      const beatGridId = generated.beatArtifact.manifestRef.artifactId;
      const onsetMapId = generated.onsetArtifact.manifestRef.artifactId;
      const [beatGrid, onsetMap] = await Promise.all([
        readTimelineBeatGrid(generated.beatManifest, store),
        readTimelineOnsetMap(generated.onsetManifest, store),
      ]);
      primeTimelineBeatGridCache([beatGridId, generated.beatArtifact.id, generated.beatArtifact.manifestRef.artifactId], beatGrid);
      primeTimelineOnsetMapCache([onsetMapId, generated.onsetArtifact.id, generated.onsetArtifact.manifestRef.artifactId], onsetMap);
      set({ clips: updateClipById(get().clips, clipId, {
        audioState: {
          ...(currentClip.audioState ?? {}),
          ...(state.needsProcessed
            ? { processedAnalysisRefs: { ...(currentClip.audioState?.processedAnalysisRefs ?? {}), beatGridId, onsetMapId } }
            : { sourceAnalysisRefs: { ...(currentClip.audioState?.sourceAnalysisRefs ?? {}), beatGridId, onsetMapId } }),
        },
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }) });
    });
  } catch (e) {
    log[isAudioAnalysisCancellation(e) ? 'debug' : 'error']('Beat/onset analysis failed', e);
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
  }
}

export async function generateFrequencyPhaseForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  const state = shouldSkipPreparedAnalysis(context, clipId, options, refs => !!refs?.frequencySummaryId && !!refs.phaseCorrelationId, refs => !!refs?.frequencySummaryId && !!refs.phaseCorrelationId);
  if (!state) return;

  set({ clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
    kind: 'frequency-phase-analysis',
    label: 'Frequency/Phase',
    artifactKinds: ['frequency-summary', 'phase-correlation'],
    processed: state.needsProcessed,
  })) });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'frequency-phase-analysis' }, async ({ signal }) => {
      const prepared = await prepareAnalysisInput(context, clipId, state.needsProcessed, signal, 'No audio source found for frequency/phase analysis');
      if (!prepared) return;

      const store = createCurrentAudioArtifactStore();
      const generator = new FrequencyPhaseAnalysisGenerator({ artifactStore: store });
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        clipAudioStateHash: prepared.clipAudioStateHash,
        decoderId: prepared.decoderId,
        decoderVersion: prepared.decoderVersion,
        metadata: prepared.metadata,
      }, {
        signal,
        onProgress: (progress) => set({ clips: updateAudioAnalysisJobProgress(get().clips, clipId, getPreparedProgress(progress.percent, state.needsProcessed), progress.phase.startsWith('storing') ? 'storing' : 'analyzing', progress.message) }),
      });
      const [frequencySummary, phaseCorrelation] = await Promise.all([
        readTimelineFrequencySummary(generated.frequencyManifest, store),
        readTimelinePhaseCorrelation(generated.phaseManifest, store),
      ]);
      primeTimelineFrequencySummaryCache([generated.frequencyArtifact.id, generated.frequencyArtifact.manifestRef.artifactId, generated.frequencyAnalysisRef.artifactId], frequencySummary);
      primeTimelinePhaseCorrelationCache([generated.phaseArtifact.id, generated.phaseArtifact.manifestRef.artifactId, generated.phaseAnalysisRef.artifactId], phaseCorrelation);

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip || isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }
      const frequencySummaryId = generated.frequencyArtifact.manifestRef.artifactId;
      const phaseCorrelationId = generated.phaseArtifact.manifestRef.artifactId;
      set({ clips: updateClipById(get().clips, clipId, {
        audioState: {
          ...(currentClip.audioState ?? {}),
          ...(state.needsProcessed
            ? { processedAnalysisRefs: { ...(currentClip.audioState?.processedAnalysisRefs ?? {}), frequencySummaryId, phaseCorrelationId } }
            : { sourceAnalysisRefs: { ...(currentClip.audioState?.sourceAnalysisRefs ?? {}), frequencySummaryId, phaseCorrelationId } }),
        },
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }) });
    });
  } catch (e) {
    log[isAudioAnalysisCancellation(e) ? 'debug' : 'error']('Frequency/phase analysis failed', e);
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
  }
}
