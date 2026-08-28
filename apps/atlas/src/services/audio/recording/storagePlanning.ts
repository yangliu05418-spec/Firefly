import type {
  AudioRecordingService,
  AudioRecordingStorageEstimate,
  AudioRecordingStorageManager,
} from '../AudioRecordingService';

type AudioRecordingState = ReturnType<AudioRecordingService['getSnapshot']>;
type AudioRecordingStorageWarning = NonNullable<AudioRecordingState['storageWarnings']>[number];

const DEFAULT_OPEN_ENDED_RECORDING_STORAGE_SECONDS = 30 * 60;
const PCM_RECOVERY_STORAGE_BYTES_PER_MINUTE_PER_INPUT = 48 * 1024 * 1024;
const MIN_RECORDING_STORAGE_HEADROOM_BYTES = 256 * 1024 * 1024;

function finitePositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function formatStorageBytes(bytes: number): string {
  const absolute = Math.max(0, bytes);
  if (absolute >= 1024 * 1024 * 1024) {
    return `${(absolute / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  if (absolute >= 1024 * 1024) {
    return `${Math.round(absolute / (1024 * 1024))} MB`;
  }
  return `${Math.round(absolute / 1024)} KB`;
}

function estimateRecordingStorageSeconds(input: {
  startTime: number;
  punchInTime?: number;
  punchOutTime?: number;
}): number {
  const start = typeof input.punchInTime === 'number' && Number.isFinite(input.punchInTime)
    ? input.punchInTime
    : input.startTime;
  if (typeof input.punchOutTime === 'number' && Number.isFinite(input.punchOutTime)) {
    return Math.max(1, input.punchOutTime - start);
  }
  return DEFAULT_OPEN_ENDED_RECORDING_STORAGE_SECONDS;
}

export async function prepareStorageForAudioRecording(input: {
  storageManager?: AudioRecordingStorageManager;
  inputGroupCount: number;
  startTime: number;
  punchInTime?: number;
  punchOutTime?: number;
}): Promise<AudioRecordingStorageWarning[]> {
  const storageManager = input.storageManager;
  if (!storageManager?.estimate) {
    return [{
      code: 'storage-estimate-unavailable',
      severity: 'info',
      message: 'Browser storage estimate is unavailable. Recording recovery remains enabled, but long takes may have less durable recovery.',
    }];
  }

  let estimate: AudioRecordingStorageEstimate;
  try {
    estimate = await storageManager.estimate();
  } catch {
    return [{
      code: 'storage-estimate-unavailable',
      severity: 'info',
      message: 'Browser storage estimate failed. Recording recovery remains enabled, but long takes may have less durable recovery.',
    }];
  }

  const usageBytes = finitePositiveNumber(estimate.usage) ?? 0;
  const quotaBytes = finitePositiveNumber(estimate.quota);
  if (!quotaBytes) {
    return [{
      code: 'storage-estimate-unavailable',
      severity: 'info',
      usageBytes,
      message: 'Browser storage quota is unavailable. Recording recovery remains enabled, but long takes may have less durable recovery.',
    }];
  }

  const availableBytes = Math.max(0, quotaBytes - usageBytes);
  const inputCount = Math.max(1, input.inputGroupCount);
  const recordingSeconds = estimateRecordingStorageSeconds(input);
  const estimatedSessionBytes = Math.ceil(
    (recordingSeconds / 60) * PCM_RECOVERY_STORAGE_BYTES_PER_MINUTE_PER_INPUT * inputCount,
  );
  const warnings: AudioRecordingStorageWarning[] = [];
  let persistent = false;
  let persistRequested = false;
  let persistGranted = false;

  try {
    persistent = await storageManager.persisted?.() ?? false;
  } catch {
    persistent = false;
  }

  const shouldRequestPersistence = !persistent && (
    estimatedSessionBytes >= MIN_RECORDING_STORAGE_HEADROOM_BYTES ||
    availableBytes < estimatedSessionBytes * 2 ||
    availableBytes < MIN_RECORDING_STORAGE_HEADROOM_BYTES
  );

  if (shouldRequestPersistence && storageManager.persist) {
    persistRequested = true;
    try {
      persistGranted = await storageManager.persist();
      persistent = persistGranted;
    } catch {
      persistGranted = false;
    }
  }

  if (availableBytes < estimatedSessionBytes) {
    warnings.push({
      code: 'storage-quota-low',
      severity: 'warning',
      usageBytes,
      quotaBytes,
      availableBytes,
      estimatedSessionBytes,
      persistent,
      persistRequested,
      persistGranted,
      message: `Recording recovery storage is low: ${formatStorageBytes(availableBytes)} available, roughly ${formatStorageBytes(estimatedSessionBytes)} reserved for this take.`,
    });
  } else if (availableBytes < MIN_RECORDING_STORAGE_HEADROOM_BYTES) {
    warnings.push({
      code: 'storage-quota-near-full',
      severity: 'warning',
      usageBytes,
      quotaBytes,
      availableBytes,
      estimatedSessionBytes,
      persistent,
      persistRequested,
      persistGranted,
      message: `Browser storage is nearly full (${formatStorageBytes(availableBytes)} available). Long recording recovery may stop early.`,
    });
  }

  if (persistRequested && !persistGranted && !persistent) {
    warnings.push({
      code: 'storage-persistence-denied',
      severity: 'warning',
      usageBytes,
      quotaBytes,
      availableBytes,
      estimatedSessionBytes,
      persistent,
      persistRequested,
      persistGranted,
      message: 'Persistent browser storage was not granted. Recording still works, but recovery artifacts may be evicted by the browser.',
    });
  } else if (persistRequested && persistGranted) {
    warnings.push({
      code: 'storage-persistence-granted',
      severity: 'info',
      usageBytes,
      quotaBytes,
      availableBytes,
      estimatedSessionBytes,
      persistent,
      persistRequested,
      persistGranted,
      message: 'Persistent browser storage is enabled for recording recovery.',
    });
  }

  return warnings;
}
