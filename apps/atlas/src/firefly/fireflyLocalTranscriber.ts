import { useTimelineStore } from '../stores/timeline';
import { triggerTimelineSave } from '../stores/mediaStore';
import { extractAudioBuffer, isAudioBearingFile, resampleAudio } from '../services/transcription/audioPrep';
import { updateClipTranscript } from '../services/transcription/artifactPersistence';
import { runWorkerTranscription } from '../services/transcription/workerClient';

/** Firefly-only browser transcription: no Atlas account, hosted provider, or credential path. */
export async function transcribeClipLocally(clipId: string, language = 'auto'): Promise<void> {
  const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
  if (!clip?.file) throw new Error('片段本地媒体尚未就绪');
  if (!isAudioBearingFile(clip.file)) throw new Error('当前片段不包含可转录的音频');
  if (clip.transcriptStatus === 'transcribing') throw new Error('当前片段正在转录');
  updateClipTranscript(clipId, { status: 'transcribing', progress: 0, message: '正在提取音频…' });
  try {
    const start = Math.max(0, clip.inPoint || 0); const end = Math.max(start, clip.outPoint || clip.duration);
    const audio = await extractAudioBuffer(clip.file, start, end);
    const samples = await resampleAudio(audio, 16_000);
    const words = await runWorkerTranscription(clipId, samples, language, audio.duration, start, updateClipTranscript);
    updateClipTranscript(clipId, { status: 'ready', progress: 100, words, message: `已转录 ${words.length} 个词` });
    triggerTimelineSave();
  } catch (error) {
    updateClipTranscript(clipId, { status: 'error', progress: 0, message: error instanceof Error ? error.message : '本地转录失败' });
    throw error;
  }
}
