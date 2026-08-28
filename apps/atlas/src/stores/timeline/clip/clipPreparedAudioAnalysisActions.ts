import { Logger } from '../../../services/logger';
import { updateClipById } from '../helpers/clipStateHelpers';
import { SpectrogramTileSetGenerator } from '../../../services/audio/SpectrogramTileSetGenerator';
import {
  primeTimelineSpectrogramTileSetCache,
  readTimelineSpectrogramTileSet,
} from '../../../services/audio/timelineSpectrogramCache';
import { LoudnessEnvelopeGenerator } from '../../../services/audio/LoudnessEnvelopeGenerator';
import {
  primeTimelineLoudnessEnvelopeCache,
  readTimelineLoudnessEnvelope,
} from '../../../services/audio/timelineLoudnessEnvelopeCache';
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

const log = Logger.create('ClipPreparedAudioAnalysis');

export async function generateSpectrogramForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  const state = shouldSkipPreparedAnalysis(
    context,
    clipId,
    options,
    refs => !!refs?.spectrogramTileSetIds?.[0],
    refs => !!refs?.spectrogramTileSetIds?.[0],
  );
  if (!state) return;

  set({ clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
    kind: 'spectrogram-tiles',
    label: 'Spectrogram',
    artifactKinds: ['spectrogram-tiles'],
    processed: state.needsProcessed,
  })) });
  log.debug('Starting spectrogram generation', { clip: state.clipName, processed: state.needsProcessed });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'spectrogram-tiles' }, async ({ signal }) => {
      const prepared = await prepareAnalysisInput(context, clipId, state.needsProcessed, signal, 'No audio source found for spectrogram');
      if (!prepared) return;

      const store = createCurrentAudioArtifactStore();
      const generator = new SpectrogramTileSetGenerator({ artifactStore: store });
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
        onProgress: (progress) => {
          set({ clips: updateAudioAnalysisJobProgress(get().clips, clipId, getPreparedProgress(progress.percent, state.needsProcessed), progress.phase.startsWith('storing') ? 'storing' : 'analyzing', progress.message) });
        },
      });
      const tileSet = await readTimelineSpectrogramTileSet(generated.manifest, store);
      primeTimelineSpectrogramTileSetCache([generated.artifact.id, generated.artifact.manifestRef.artifactId, generated.analysisRef.artifactId], tileSet);

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip || isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }
      const refId = generated.artifact.manifestRef.artifactId;
      set({ clips: updateClipById(get().clips, clipId, {
        audioState: {
          ...(currentClip.audioState ?? {}),
          ...(state.needsProcessed
            ? { processedAnalysisRefs: { ...(currentClip.audioState?.processedAnalysisRefs ?? {}), spectrogramTileSetIds: [refId] } }
            : { sourceAnalysisRefs: { ...(currentClip.audioState?.sourceAnalysisRefs ?? {}), spectrogramTileSetIds: [refId] } }),
        },
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }) });
    });
  } catch (e) {
    log[isAudioAnalysisCancellation(e) ? 'debug' : 'error']('Spectrogram generation failed', e);
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
  }
}

export async function generateLoudnessForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  const state = shouldSkipPreparedAnalysis(context, clipId, options, refs => !!refs?.loudnessEnvelopeId, refs => !!refs?.loudnessEnvelopeId);
  if (!state) return;

  set({ clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
    kind: 'loudness-envelope',
    label: 'Loudness',
    artifactKinds: ['loudness-envelope'],
    processed: state.needsProcessed,
  })) });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'loudness-envelope' }, async ({ signal }) => {
      const prepared = await prepareAnalysisInput(context, clipId, state.needsProcessed, signal, 'No audio source found for loudness');
      if (!prepared) return;

      const store = createCurrentAudioArtifactStore();
      const generator = new LoudnessEnvelopeGenerator({ artifactStore: store });
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
      const envelope = await readTimelineLoudnessEnvelope(generated.manifest, store);
      primeTimelineLoudnessEnvelopeCache([generated.artifact.id, generated.artifact.manifestRef.artifactId, generated.analysisRef.artifactId], envelope);

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip || isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }
      const refId = generated.artifact.manifestRef.artifactId;
      set({ clips: updateClipById(get().clips, clipId, {
        audioState: {
          ...(currentClip.audioState ?? {}),
          ...(state.needsProcessed
            ? { processedAnalysisRefs: { ...(currentClip.audioState?.processedAnalysisRefs ?? {}), loudnessEnvelopeId: refId } }
            : { sourceAnalysisRefs: { ...(currentClip.audioState?.sourceAnalysisRefs ?? {}), loudnessEnvelopeId: refId } }),
        },
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }) });
    });
  } catch (e) {
    log[isAudioAnalysisCancellation(e) ? 'debug' : 'error']('Loudness generation failed', e);
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
  }
}
