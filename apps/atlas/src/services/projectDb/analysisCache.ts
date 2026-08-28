import { STORES } from './stores';
import { requestResult, requestSuccess } from './transactions';
import type { ProjectDbLogger, StoredAnalysis } from './types';

/**
 * Generate a range key for analysis cache
 * @param inPoint Start time in seconds
 * @param outPoint End time in seconds
 */
function getAnalysisRangeKey(inPoint: number, outPoint: number): string {
  return `${inPoint.toFixed(2)}-${outPoint.toFixed(2)}`;
}

/**
 * Get analysis record for a media file
 */
async function getAnalysisRecord(db: IDBDatabase, mediaFileId: string): Promise<StoredAnalysis | undefined> {
  const transaction = db.transaction(STORES.ANALYSIS_CACHE, 'readonly');
  const store = transaction.objectStore(STORES.ANALYSIS_CACHE);
  const request = store.get(mediaFileId);
  return requestResult(request);
}

/**
 * Save analysis data for a media file
 * @param mediaFileId The media file ID
 * @param inPoint Start time of analyzed range
 * @param outPoint End time of analyzed range
 * @param frames The analysis frame data
 * @param sampleInterval Sample interval in milliseconds
 */
export async function saveAnalysis(
  db: IDBDatabase,
  log: ProjectDbLogger,
  mediaFileId: string,
  inPoint: number,
  outPoint: number,
  frames: StoredAnalysis['analyses'][string]['frames'],
  sampleInterval: number
): Promise<void> {
  const rangeKey = getAnalysisRangeKey(inPoint, outPoint);

  // First, get existing analysis data for this media file
  const existing = await getAnalysisRecord(db, mediaFileId);

  const record: StoredAnalysis = existing || {
    mediaFileId,
    analyses: {},
  };

  // Add or update the analysis for this range
  record.analyses[rangeKey] = {
    frames,
    sampleInterval,
    createdAt: Date.now(),
  };

  const transaction = db.transaction(STORES.ANALYSIS_CACHE, 'readwrite');
  const store = transaction.objectStore(STORES.ANALYSIS_CACHE);
  const request = store.put(record);

  await requestSuccess(request);
  log.debug(`Saved analysis for ${mediaFileId} (range: ${rangeKey})`);
}

/**
 * Get cached analysis for a specific time range
 * @param mediaFileId The media file ID
 * @param inPoint Start time of analyzed range
 * @param outPoint End time of analyzed range
 * @returns The cached analysis or undefined if not found
 */
export async function getAnalysis(
  db: IDBDatabase,
  mediaFileId: string,
  inPoint: number,
  outPoint: number
): Promise<StoredAnalysis['analyses'][string] | undefined> {
  const record = await getAnalysisRecord(db, mediaFileId);
  if (!record) return undefined;

  const rangeKey = getAnalysisRangeKey(inPoint, outPoint);
  return record.analyses[rangeKey];
}

/**
 * Check if analysis exists for a specific time range
 */
export async function hasAnalysis(
  db: IDBDatabase,
  mediaFileId: string,
  inPoint: number,
  outPoint: number,
): Promise<boolean> {
  const analysis = await getAnalysis(db, mediaFileId, inPoint, outPoint);
  return !!analysis;
}

/**
 * Get all cached analysis ranges for a media file
 */
export async function getAnalysisRanges(db: IDBDatabase, mediaFileId: string): Promise<string[]> {
  const record = await getAnalysisRecord(db, mediaFileId);
  if (!record) return [];
  return Object.keys(record.analyses);
}

/**
 * Delete all cached analysis for a media file
 */
export async function deleteAnalysis(db: IDBDatabase, mediaFileId: string): Promise<void> {
  const transaction = db.transaction(STORES.ANALYSIS_CACHE, 'readwrite');
  const store = transaction.objectStore(STORES.ANALYSIS_CACHE);
  const request = store.delete(mediaFileId);
  return requestSuccess(request);
}

/**
 * Clear all cached analysis data
 */
export async function clearAllAnalysis(db: IDBDatabase, log: ProjectDbLogger): Promise<void> {
  const transaction = db.transaction(STORES.ANALYSIS_CACHE, 'readwrite');
  const store = transaction.objectStore(STORES.ANALYSIS_CACHE);
  const request = store.clear();

  await requestSuccess(request);
  log.info('All analysis cache cleared');
}
