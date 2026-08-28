export const SOURCE_PREPARATION_PROGRESS = 0.08;
export const DOWNLOAD_PROGRESS_START = 0.10;
export const DOWNLOAD_PROGRESS_END = 0.35;
export const LOAD_PROGRESS_END = 0.45;
export const SEPARATION_PROGRESS_END = 0.90;
export const STORING_PROGRESS = 0.95;
export const STEM_MEDIA_PROGRESS = 0.98;

export function clampStemSeparationProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function mapStemSeparationProgress(value: number, start: number, end: number): number {
  return start + clampStemSeparationProgress(value) * (end - start);
}

export function throwIfStemSeparationAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException('Stem separation was cancelled.', 'AbortError');
  }
}

export function getStemSeparationErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
