import type { MediaFileAudioAnalysisRefs } from '../../../types/audio';
import { Logger } from '../../../services/logger';
import { generateWaveformFromBuffer } from '../helpers/waveformHelpers';
import { updateClipById } from '../helpers/clipStateHelpers';
import {
  generateTimelineWaveformAnalysisForFile,
  mapSourceWaveformPreviewProgress,
  mapSourceWaveformPyramidProgress,
} from '../../../services/audio/timelineWaveformPyramidCache';
import { clipAudioAnalysisJobService } from '../../../services/audio/ClipAudioAnalysisJobService';
import { hasTimelineWaveformData } from '../../../utils/audioWaveformPresence';
import type { GenerateClipAudioAnalysisOptions } from '../types';
import type { ClipActionContext } from './clipActionContext';
import {
  clearAudioAnalysisJobUpdate,
  createAudioAnalysisJobUpdate,
  isAudioAnalysisCancellation,
  resolveClipSourceFile,
  updateAudioAnalysisJobProgress,
} from './clipAudioAnalysisShared';

const log = Logger.create('ClipWaveformAnalysis');

export function cancelAudioAnalysisForClipAction(context: ClipActionContext, clipId: string): void {
  const { get, set } = context;
  const cancelled = clipAudioAnalysisJobService.cancelClip(clipId);
  if (cancelled === 0) return;
  set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
}

export async function generateWaveformForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  const clip = get().clips.find(c => c.id === clipId);
  if (!clip || clip.waveformGenerating) return;
  if (!options.force && hasTimelineWaveformData(clip)) return;
  const includePyramid = options.previewOnly !== true;

  set({
    clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
      kind: 'waveform-pyramid',
      label: includePyramid ? 'Waveform' : 'Waveform Preview',
      artifactKinds: includePyramid ? ['waveform-pyramid'] : [],
      processed: false,
    })),
  });
  log.debug('Starting waveform generation', { clip: clip.name, includePyramid });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'waveform-pyramid' }, async ({ signal }) => {
      set({ clips: updateAudioAnalysisJobProgress(get().clips, clipId, 1, 'preparing', 'Preparing waveform') });
      let waveform: number[];
      let waveformChannels: number[][] | undefined;
      let audioAnalysisRefs: MediaFileAudioAnalysisRefs | undefined;

      if (clip.isComposition && clip.compositionId) {
        const { requestCompositionAudioMixdown } = await import('../../../services/timeline/compositionAudioMixdownCache');
        const mixdownResult = await requestCompositionAudioMixdown(clip);
        if (signal.aborted) throw signal.reason;

        if (mixdownResult?.hasAudio) {
          waveform = mixdownResult.waveform;
          set({
            clips: updateClipById(get().clips, clipId, {
              mixdownBuffer: mixdownResult.buffer,
              mixdownWaveform: mixdownResult.waveform,
              hasMixdownAudio: true,
              mixdownGenerating: false,
            }),
          });
        } else if (clip.mixdownBuffer) {
          waveform = generateWaveformFromBuffer(clip.mixdownBuffer, 50);
        } else {
          waveform = new Array(Math.max(1, Math.floor(clip.duration * 50))).fill(0);
        }
      } else {
        const sourceFile = await resolveClipSourceFile(clip);
        if (!sourceFile) {
          log.warn('No file found for clip', { clipId });
          set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
          return;
        }

        set({ clips: updateClipById(get().clips, clipId, { file: sourceFile }) });
        const analysis = await generateTimelineWaveformAnalysisForFile(sourceFile, {
          mediaFileId: clip.mediaFileId ?? clip.source?.mediaFileId,
          includePyramid,
          signal,
          onProgress: (progress, partialWaveform) => {
            set({
              clips: updateAudioAnalysisJobProgress(
                updateClipById(get().clips, clipId, { waveform: partialWaveform }),
                clipId,
                includePyramid ? mapSourceWaveformPreviewProgress(progress) : progress,
                'analyzing',
              ),
            });
          },
          onPyramidProgress: (progress) => {
            set({
              clips: updateAudioAnalysisJobProgress(
                get().clips,
                clipId,
                mapSourceWaveformPyramidProgress(progress),
                progress.phase.startsWith('storing') ? 'storing' : 'analyzing',
                progress.message,
              ),
            });
          },
        });
        waveform = analysis.waveform;
        waveformChannels = analysis.waveformChannels;
        audioAnalysisRefs = analysis.audioAnalysisRefs;
      }

      if (signal.aborted) throw signal.reason;
      const currentClip = get().clips.find(c => c.id === clipId);
      set({ clips: updateClipById(get().clips, clipId, {
        waveform,
        waveformChannels,
        ...(audioAnalysisRefs
          ? {
              audioState: {
                ...(currentClip?.audioState ?? {}),
                sourceAnalysisRefs: {
                  ...(currentClip?.audioState?.sourceAnalysisRefs ?? {}),
                  ...audioAnalysisRefs,
                },
              },
            }
          : {}),
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }) });
    });
  } catch (e) {
    if (isAudioAnalysisCancellation(e)) {
      log.debug('Waveform generation cancelled', { clipId });
    } else {
      log.error('Waveform generation failed', e);
    }
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
  }
}
