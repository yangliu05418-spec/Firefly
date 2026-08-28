import { Logger } from '../../logger';
import type {
  AudioRecordingCaptureBackend,
  AudioRecordingChunkSink,
  AudioRecordingService,
  AudioRecordingStopResult,
} from '../AudioRecordingService';
import type { ActiveCaptureGroup, ActiveRecordingSession } from './sessionTypes';
import { getRecordingInputDeviceIds, getRecordingTargetTrackIds } from './sessionTypes';

const log = Logger.create('AudioRecordingService');
const DEFAULT_TIMESLICE_MS = 1000;
const PUNCH_OUT_POLL_MS = 50;
const PUNCH_INPUT_WARMUP_SECONDS = 1.5;
type AudioRecordingState = ReturnType<AudioRecordingService['getSnapshot']>;
type AudioRecordingRecoveryEntry = ReturnType<AudioRecordingService['listRecoveryEntries']>[number];

export interface AudioRecordingSessionStateMachineContext {
  backend: AudioRecordingCaptureBackend;
  now: () => number;
  getActiveSession: () => ActiveRecordingSession | null;
  setActiveSession: (session: ActiveRecordingSession | null) => void;
  getSnapshot: () => AudioRecordingState;
  setSnapshot: (snapshot: AudioRecordingState) => void;
  createRecoveryChunkSink: (session: ActiveRecordingSession) => AudioRecordingChunkSink;
  persistRecoveryEntry: (entry: AudioRecordingRecoveryEntry) => void;
  stop: () => Promise<AudioRecordingStopResult>;
}

export async function beginAudioRecordingSessionCapture(
  context: AudioRecordingSessionStateMachineContext,
  session: ActiveRecordingSession,
  options: { pausedUntilPunch?: boolean } = {},
): Promise<void> {
  if (context.getActiveSession() !== session) return;
  if (session.captureStarting || session.captures.length > 0) return;
  session.captureStarting = true;
  const wasWaitingForPunch = context.getSnapshot().phase === 'waiting-for-punch';
  if (!options.pausedUntilPunch) {
    clearAudioRecordingPunchInMonitor(session);
  }

  const targetTrackIds = getRecordingTargetTrackIds(session.targets);
  const inputDeviceIds = getRecordingInputDeviceIds(session.targets);
  context.setSnapshot({
    phase: options.pausedUntilPunch ? 'warming-input' : 'requesting-input',
    sessionId: session.sessionId,
    targetTrackIds,
    startedAt: session.startedAt,
    startTime: session.startTime,
    punchInTime: session.punchInTime,
    punchOutTime: session.punchOutTime,
    elapsedSeconds: 0,
    inputDeviceIds,
    storageWarnings: session.storageWarnings,
  });

  const captures: ActiveCaptureGroup[] = [];
  try {
    if (wasWaitingForPunch && !options.pausedUntilPunch) {
      session.startedAt = context.now();
    }
    for (const group of session.captureGroups) {
      const capture = await context.backend.start({
        sessionId: session.sessionId,
        inputDeviceId: group.inputDeviceId,
        trackIds: group.targets.map(target => target.trackId),
        startedAt: session.startedAt,
        startTime: session.startTime,
        mimeTypes: session.mimeTypes,
        timesliceMs: DEFAULT_TIMESLICE_MS,
        chunkSink: context.createRecoveryChunkSink(session),
        initiallyPaused: options.pausedUntilPunch,
      });
      captures.push({
        inputDeviceId: group.inputDeviceId,
        trackIds: group.targets.map(target => target.trackId),
        capture,
      });
      if (context.getActiveSession() !== session) {
        await Promise.allSettled(captures.map(startedGroup => startedGroup.capture.cancel()));
        return;
      }
    }

    if (context.getActiveSession() !== session) {
      await Promise.allSettled(captures.map(group => group.capture.cancel()));
      return;
    }

    session.captures = captures;
    context.persistRecoveryEntry({
      sessionId: session.sessionId,
      targetTrackIds,
      inputDeviceIds,
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      status: 'active',
    });
    if (options.pausedUntilPunch) {
      context.setSnapshot({
        phase: 'warming-input',
        sessionId: session.sessionId,
        targetTrackIds,
        startedAt: session.startedAt,
        startTime: session.startTime,
        punchInTime: session.punchInTime,
        punchOutTime: session.punchOutTime,
        elapsedSeconds: 0,
        inputDeviceIds,
        storageWarnings: session.storageWarnings,
      });
      return;
    }
    armAudioRecordingPunchOutMonitor(context, session);
    context.setSnapshot({
      phase: 'recording',
      sessionId: session.sessionId,
      targetTrackIds,
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      elapsedSeconds: 0,
      inputDeviceIds,
      storageWarnings: session.storageWarnings,
    });
  } catch (error) {
    await Promise.allSettled(captures.map(group => group.capture.cancel()));
    session.captures = [];
    context.setActiveSession(null);
    const message = error instanceof Error ? error.message : 'Audio recording could not start.';
    context.persistRecoveryEntry({
      sessionId: session.sessionId,
      targetTrackIds,
      inputDeviceIds,
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      status: 'error',
      message,
    });
    context.setSnapshot({
      phase: 'error',
      sessionId: session.sessionId,
      targetTrackIds,
      startedAt: session.startedAt,
      startTime: session.startTime,
      punchInTime: session.punchInTime,
      punchOutTime: session.punchOutTime,
      inputDeviceIds,
      lastError: message,
      storageWarnings: session.storageWarnings,
    });
    throw error;
  } finally {
    session.captureStarting = false;
  }
}

export function resumeAudioRecordingSessionCapture(
  context: AudioRecordingSessionStateMachineContext,
  session: ActiveRecordingSession,
): void {
  if (context.getActiveSession() !== session || session.captures.length === 0) return;

  clearAudioRecordingPunchInMonitor(session);
  session.startedAt = context.now();
  const targetTrackIds = getRecordingTargetTrackIds(session.targets);
  const inputDeviceIds = getRecordingInputDeviceIds(session.targets);

  for (const group of session.captures) {
    group.capture.resume?.({
      startedAt: session.startedAt,
      startTime: session.startTime,
    });
  }

  context.persistRecoveryEntry({
    sessionId: session.sessionId,
    targetTrackIds,
    inputDeviceIds,
    startedAt: session.startedAt,
    startTime: session.startTime,
    punchInTime: session.punchInTime,
    punchOutTime: session.punchOutTime,
    status: 'active',
  });
  armAudioRecordingPunchOutMonitor(context, session);
  context.setSnapshot({
    phase: 'recording',
    sessionId: session.sessionId,
    targetTrackIds,
    startedAt: session.startedAt,
    startTime: session.startTime,
    punchInTime: session.punchInTime,
    punchOutTime: session.punchOutTime,
    elapsedSeconds: 0,
    inputDeviceIds,
    storageWarnings: session.storageWarnings,
  });
}

export function armAudioRecordingPunchInMonitor(
  context: AudioRecordingSessionStateMachineContext,
  session: ActiveRecordingSession,
): void {
  const checkPunchIn = async (): Promise<void> => {
    if (context.getActiveSession() !== session) return;
    if (session.captureStarting) {
      session.punchInTimer = globalThis.setTimeout(checkPunchIn, PUNCH_OUT_POLL_MS);
      return;
    }

    const timelineTime = session.getTimelineTime?.();
    if (
      typeof timelineTime === 'number' &&
      Number.isFinite(timelineTime) &&
      typeof session.punchInTime === 'number' &&
      timelineTime >= session.punchInTime
    ) {
      if (session.captures.length > 0) {
        resumeAudioRecordingSessionCapture(context, session);
      } else {
        await beginAudioRecordingSessionCapture(context, session).catch(error => {
          log.warn('Punch-in recording start failed', error);
        });
      }
      return;
    }

    if (
      session.captures.length === 0 &&
      typeof timelineTime === 'number' &&
      Number.isFinite(timelineTime) &&
      typeof session.punchInTime === 'number' &&
      timelineTime >= session.punchInTime - PUNCH_INPUT_WARMUP_SECONDS
    ) {
      await beginAudioRecordingSessionCapture(context, session, { pausedUntilPunch: true }).catch(error => {
        log.warn('Punch-in input warmup failed', error);
      });
      if (context.getActiveSession() !== session) return;
    }

    session.punchInTimer = globalThis.setTimeout(checkPunchIn, PUNCH_OUT_POLL_MS);
  };

  session.punchInTimer = globalThis.setTimeout(checkPunchIn, PUNCH_OUT_POLL_MS);
}

export function clearAudioRecordingPunchInMonitor(session: ActiveRecordingSession): void {
  if (session.punchInTimer !== undefined) {
    globalThis.clearTimeout(session.punchInTimer);
    session.punchInTimer = undefined;
  }
}

export function armAudioRecordingPunchOutMonitor(
  context: AudioRecordingSessionStateMachineContext,
  session: ActiveRecordingSession,
): void {
  if (
    typeof session.punchOutTime !== 'number' ||
    !Number.isFinite(session.punchOutTime) ||
    !session.getTimelineTime
  ) {
    return;
  }

  const checkPunchOut = async (): Promise<void> => {
    if (context.getActiveSession() !== session || session.punchOutStopping) return;

    const timelineTime = session.getTimelineTime?.();
    if (typeof timelineTime === 'number' && Number.isFinite(timelineTime) && timelineTime >= session.punchOutTime!) {
      session.punchOutStopping = true;
      try {
        const result = await context.stop();
        await session.onPunchOut?.(result);
      } catch (error) {
        log.warn('Punch-out recording stop failed', error);
        context.setSnapshot({
          ...context.getSnapshot(),
          phase: 'error',
          lastError: error instanceof Error ? error.message : 'Punch-out recording stop failed.',
        });
      }
      return;
    }

    session.punchOutTimer = globalThis.setTimeout(checkPunchOut, PUNCH_OUT_POLL_MS);
  };

  session.punchOutTimer = globalThis.setTimeout(checkPunchOut, PUNCH_OUT_POLL_MS);
}

export function clearAudioRecordingPunchOutMonitor(session: ActiveRecordingSession): void {
  if (session.punchOutTimer !== undefined) {
    globalThis.clearTimeout(session.punchOutTimer);
    session.punchOutTimer = undefined;
  }
}
