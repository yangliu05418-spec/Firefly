import { useTimelineStore } from '../../../../../stores/timeline';
import { isRecord } from '../guidedOptions';
import {
  summarizeLongAnimationFrameEntry,
  summarizeNumberList,
  summarizePerformanceMemory,
  summarizeProxyAudioCache,
} from './performance';
import { summarizeElementForDebug } from './interaction';

export const REAL_CLIP_DRAG_RECORD_ARM_KEY = 'masterselects.debug.recordNextClipDrag';
export const REAL_CLIP_DRAG_RECORD_RESULT_KEY = 'masterselects.debug.lastRealClipDragRecord';
export const REAL_CLIP_DRAG_SESSION_KEY = 'masterselects.debug.realClipDragSession';

type RealClipDragRecorderState = {
  clipId: string | null;
  startedAt: number;
  firstFrameDelayMs: number | null;
  originX: number;
  originY: number;
  lastMouseX: number;
  lastMouseY: number;
  lastMouseAt: number;
  mouseEventCount: number;
  moveEventCount: number;
  eventsSinceLastFrame: number;
  cumulativeMouseDistancePx: number;
  mouseGaps: number[];
  eventsPerFrame: number[];
  frames: Array<{ elapsedMs: number; deltaMs: number; mouseEvents: number }>;
  longTasks: Array<Record<string, unknown>>;
  longAnimationFrames: Array<Record<string, unknown>>;
  previousFrameAt: number | null;
  frameId: number | null;
  observer: PerformanceObserver | null;
  animationFrameObserver: PerformanceObserver | null;
  unsubscribeTimeline: (() => void) | null;
  storeChanges: {
    clipDragPreview: number;
    layers: number;
    clips: number;
    playheadPosition: number;
  };
  beforeMemory: ReturnType<typeof summarizePerformanceMemory>;
  beforeCache: ReturnType<typeof summarizeProxyAudioCache>;
  beforeClip: { startTime: number; trackId: string } | null;
  target: ReturnType<typeof summarizeElementForDebug>;
  handleMove: (event: MouseEvent) => void;
  handleUp: (event: MouseEvent) => void;
};

type RealClipDragSession = {
  startedAt: string;
  maxRecords: number;
  records: Record<string, unknown>[];
};

let realClipDragRecorderState: RealClipDragRecorderState | null = null;
let lastRealClipDragRecord: Record<string, unknown> | null = null;
let realClipDragSession: RealClipDragSession | null = null;

export function isRealClipDragRecorderActive(): boolean {
  return realClipDragRecorderState !== null;
}

export function isRealClipDragRecorderArmed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(REAL_CLIP_DRAG_RECORD_ARM_KEY) === '1';
}

export function setRealClipDragRecorderArmed(armed: boolean): void {
  if (typeof window === 'undefined') return;
  if (armed) {
    window.localStorage.setItem(REAL_CLIP_DRAG_RECORD_ARM_KEY, '1');
    return;
  }
  window.localStorage.removeItem(REAL_CLIP_DRAG_RECORD_ARM_KEY);
}

export function writeLastRealClipDragRecord(record: Record<string, unknown> | null): void {
  lastRealClipDragRecord = record;
  if (typeof window === 'undefined') return;
  if (!record) {
    window.localStorage.removeItem(REAL_CLIP_DRAG_RECORD_RESULT_KEY);
    return;
  }
  try {
    window.localStorage.setItem(REAL_CLIP_DRAG_RECORD_RESULT_KEY, JSON.stringify(record));
  } catch {
    window.localStorage.removeItem(REAL_CLIP_DRAG_RECORD_RESULT_KEY);
  }
}

export function readLastRealClipDragRecord(): Record<string, unknown> | null {
  if (lastRealClipDragRecord) return lastRealClipDragRecord;
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(REAL_CLIP_DRAG_RECORD_RESULT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeRealClipDragSession(value: unknown): RealClipDragSession | null {
  if (!isRecord(value)) return null;
  const records = Array.isArray(value.records)
    ? value.records.filter(isRecord)
    : [];
  const maxRecords = typeof value.maxRecords === 'number' && Number.isFinite(value.maxRecords)
    ? Math.max(1, Math.min(100, Math.round(value.maxRecords)))
    : 10;

  return {
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : new Date().toISOString(),
    maxRecords,
    records,
  };
}

export function writeRealClipDragSession(session: RealClipDragSession | null): void {
  realClipDragSession = session;
  if (typeof window === 'undefined') return;
  if (!session) {
    window.localStorage.removeItem(REAL_CLIP_DRAG_SESSION_KEY);
    return;
  }

  try {
    window.localStorage.setItem(REAL_CLIP_DRAG_SESSION_KEY, JSON.stringify(session));
  } catch {
    window.localStorage.removeItem(REAL_CLIP_DRAG_SESSION_KEY);
  }
}

export function readRealClipDragSession(): RealClipDragSession | null {
  if (realClipDragSession) return realClipDragSession;
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(REAL_CLIP_DRAG_SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return normalizeRealClipDragSession(parsed);
  } catch {
    return null;
  }
}

function appendRealClipDragSessionRecord(record: Record<string, unknown>): void {
  const session = readRealClipDragSession();
  if (!session) return;

  const nextRecords = [...session.records, record].slice(-session.maxRecords);
  const nextSession: RealClipDragSession = {
    ...session,
    records: nextRecords,
  };
  writeRealClipDragSession(nextSession);

  if (nextRecords.length < session.maxRecords) {
    setRealClipDragRecorderArmed(true);
  } else {
    setRealClipDragRecorderArmed(false);
  }
}

function startRealClipDragRecording(event: MouseEvent, target: HTMLElement): void {
  if (realClipDragRecorderState) return;

  const session = readRealClipDragSession();
  const isSessionRecording = Boolean(session && session.records.length < session.maxRecords);
  if (!isSessionRecording) {
    setRealClipDragRecorderArmed(false);
    writeLastRealClipDragRecord(null);
  }

  const clipId = target.dataset.clipId ?? null;
  const startedAt = performance.now();
  const expectedFrameMs = 1000 / 60;
  const beforeTimeline = useTimelineStore.getState();
  const beforeClip = clipId ? beforeTimeline.clips.find((clip) => clip.id === clipId) : undefined;

  const state: RealClipDragRecorderState = {
    clipId,
    startedAt,
    firstFrameDelayMs: null,
    originX: event.clientX,
    originY: event.clientY,
    lastMouseX: event.clientX,
    lastMouseY: event.clientY,
    lastMouseAt: startedAt,
    mouseEventCount: 1,
    moveEventCount: 0,
    eventsSinceLastFrame: 1,
    cumulativeMouseDistancePx: 0,
    mouseGaps: [],
    eventsPerFrame: [],
    frames: [],
    longTasks: [],
    longAnimationFrames: [],
    previousFrameAt: null,
    frameId: null,
    observer: null,
    animationFrameObserver: null,
    unsubscribeTimeline: null,
    storeChanges: {
      clipDragPreview: 0,
      layers: 0,
      clips: 0,
      playheadPosition: 0,
    },
    beforeMemory: summarizePerformanceMemory(),
    beforeCache: summarizeProxyAudioCache(),
    beforeClip: beforeClip
      ? { startTime: beforeClip.startTime, trackId: beforeClip.trackId }
      : null,
    target: summarizeElementForDebug(target),
    handleMove: () => undefined,
    handleUp: () => undefined,
  };

  state.unsubscribeTimeline = useTimelineStore.subscribe(
    (timelineState) => ({
      clipDragPreview: timelineState.clipDragPreview,
      layers: timelineState.layers,
      clips: timelineState.clips,
      playheadPosition: timelineState.playheadPosition,
    }),
    (current, previous) => {
      if (current.clipDragPreview !== previous.clipDragPreview) state.storeChanges.clipDragPreview += 1;
      if (current.layers !== previous.layers) state.storeChanges.layers += 1;
      if (current.clips !== previous.clips) state.storeChanges.clips += 1;
      if (current.playheadPosition !== previous.playheadPosition) state.storeChanges.playheadPosition += 1;
    },
  );

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            name: entry.name,
            startTime: Math.round((entry.startTime - startedAt) * 100) / 100,
            durationMs: Math.round(entry.duration * 100) / 100,
            entryType: entry.entryType,
          });
        }
      });
      state.observer.observe({ entryTypes: ['longtask'] });
    } catch {
      state.observer = null;
    }

    try {
      state.animationFrameObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longAnimationFrames.push(summarizeLongAnimationFrameEntry(entry, startedAt));
        }
      });
      state.animationFrameObserver.observe({ entryTypes: ['long-animation-frame'] });
    } catch {
      state.animationFrameObserver = null;
    }
  }

  const tick = (timestamp: number) => {
    if (realClipDragRecorderState !== state) return;
    if (state.firstFrameDelayMs === null) {
      state.firstFrameDelayMs = Math.round((timestamp - startedAt) * 100) / 100;
    }
    if (state.previousFrameAt !== null) {
      const deltaMs = Math.round((timestamp - state.previousFrameAt) * 100) / 100;
      const mouseEvents = state.eventsSinceLastFrame;
      state.eventsPerFrame.push(mouseEvents);
      state.frames.push({
        elapsedMs: Math.round(timestamp - startedAt),
        deltaMs,
        mouseEvents,
      });
      state.eventsSinceLastFrame = 0;
    }
    state.previousFrameAt = timestamp;
    state.frameId = window.requestAnimationFrame(tick);
  };

  state.handleMove = (moveEvent: MouseEvent) => {
    const now = performance.now();
    state.mouseEventCount += 1;
    state.moveEventCount += 1;
    state.eventsSinceLastFrame += 1;
    state.mouseGaps.push(Math.round((now - state.lastMouseAt) * 100) / 100);
    state.cumulativeMouseDistancePx += Math.hypot(
      moveEvent.clientX - state.lastMouseX,
      moveEvent.clientY - state.lastMouseY,
    );
    state.lastMouseX = moveEvent.clientX;
    state.lastMouseY = moveEvent.clientY;
    state.lastMouseAt = now;
  };

  state.handleUp = (upEvent: MouseEvent) => {
    state.mouseEventCount += 1;
    state.eventsSinceLastFrame += 1;
    stopRealClipDragRecording(upEvent);
  };

  realClipDragRecorderState = state;
  document.addEventListener('mousemove', state.handleMove, true);
  document.addEventListener('mouseup', state.handleUp, true);
  state.frameId = window.requestAnimationFrame(tick);

  setTimeout(() => {
    if (realClipDragRecorderState === state) {
      stopRealClipDragRecording(null, 'timeout');
    }
  }, 45000);

  function stopRealClipDragRecording(
    upEvent: MouseEvent | null,
    reason: 'mouseup' | 'timeout' = 'mouseup',
  ): void {
    if (realClipDragRecorderState !== state) return;
    realClipDragRecorderState = null;

    document.removeEventListener('mousemove', state.handleMove, true);
    document.removeEventListener('mouseup', state.handleUp, true);
    if (state.frameId !== null) {
      window.cancelAnimationFrame(state.frameId);
    }

    window.setTimeout(() => {
      state.unsubscribeTimeline?.();
      state.observer?.disconnect();
      state.animationFrameObserver?.disconnect();

      const afterTimeline = useTimelineStore.getState();
      const afterClip = state.clipId
        ? afterTimeline.clips.find((clip) => clip.id === state.clipId)
        : undefined;
      const deltas = state.frames.map(frame => frame.deltaMs);
      const droppedFrameEstimate = deltas.reduce((sum, delta) => (
        sum + Math.max(0, Math.round(delta / expectedFrameMs) - 1)
      ), 0);
      const slowFrames = state.frames.filter(frame => frame.deltaMs > expectedFrameMs * 1.75);

      const record = {
        completedAt: new Date().toISOString(),
        reason,
        clipId: state.clipId,
        elapsedMs: Math.round(performance.now() - startedAt),
        firstFrameDelayMs: state.firstFrameDelayMs,
        mouseEventCount: state.mouseEventCount,
        moveEventCount: state.moveEventCount,
        mouseGapMs: summarizeNumberList(state.mouseGaps),
        mouseEventsPerFrame: summarizeNumberList(state.eventsPerFrame),
        cumulativeMouseDistancePx: Math.round(state.cumulativeMouseDistancePx * 100) / 100,
        origin: { x: state.originX, y: state.originY },
        end: upEvent ? { x: upEvent.clientX, y: upEvent.clientY } : { x: state.lastMouseX, y: state.lastMouseY },
        frameCount: state.frames.length,
        estimatedFps: Math.round((state.frames.length / Math.max(0.001, (performance.now() - startedAt) / 1000)) * 100) / 100,
        frameDeltaMs: summarizeNumberList(deltas),
        slowFrameCount: slowFrames.length,
        droppedFrameEstimate,
        longTaskCount: state.longTasks.length,
        longAnimationFrameCount: state.longAnimationFrames.length,
        longTasks: state.longTasks,
        longAnimationFrames: state.longAnimationFrames,
        storeChanges: state.storeChanges,
        beforeMemory: state.beforeMemory,
        afterMemory: summarizePerformanceMemory(),
        beforeCache: state.beforeCache,
        afterCache: summarizeProxyAudioCache(),
        beforeClip: state.beforeClip,
        afterClip: afterClip
          ? { startTime: afterClip.startTime, trackId: afterClip.trackId }
          : null,
        target: state.target,
        frames: state.frames.slice(-300),
      };
      writeLastRealClipDragRecord(record);
      appendRealClipDragSessionRecord(record);
    }, reason === 'mouseup' ? 250 : 0);
  }
}

export function installRealClipDragRecorder(): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const handleMouseDown = (event: MouseEvent) => {
    if (!isRealClipDragRecorderArmed()) return;
    if (event.button !== 0) return;
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>('.clip-interaction-shell[data-clip-id], .timeline-clip-preview[data-clip-id]')
      : null;
    if (!target) return;
    startRealClipDragRecording(event, target);
  };

  document.addEventListener('mousedown', handleMouseDown, true);
  return () => {
    document.removeEventListener('mousedown', handleMouseDown, true);
  };
}
