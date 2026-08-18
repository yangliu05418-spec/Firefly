/**
 * 撤销/重做历史（纯函数 + 防抖提交器）。
 * 移植自 infinite-canvas（MIT）project.tsx：180ms 防抖合并、50 步上限（slice(-49)）、
 * 新提交清空 future；快照只存引用（不深拷贝）。
 */
export type HistoryState<T> = { past: T[]; future: T[] };

export const DEFAULT_HISTORY_LIMIT = 50;
export const DEFAULT_COMMIT_DEBOUNCE_MS = 180;

export const createHistory = <T>(): HistoryState<T> => ({ past: [], future: [] });

/** 提交新条目：写入 past（上限 limit-1，即整体 50 步），清空 future */
export const historyPush = <T>(state: HistoryState<T>, entry: T, limit = DEFAULT_HISTORY_LIMIT): HistoryState<T> => ({
  past: [...state.past.slice(-(limit - 1)), entry],
  future: [],
});

export const historyUndo = <T>(state: HistoryState<T>, current: T): { state: HistoryState<T>; value: T | null } => {
  const entry = state.past[state.past.length - 1];
  if (!entry) return { state, value: null };
  return { state: { past: state.past.slice(0, -1), future: [...state.future, current] }, value: entry };
};

export const historyRedo = <T>(state: HistoryState<T>, current: T): { state: HistoryState<T>; value: T | null } => {
  const entry = state.future[state.future.length - 1];
  if (!entry) return { state, value: null };
  return { state: { past: [...state.past, current], future: state.future.slice(0, -1) }, value: entry };
};

export const canUndo = <T>(state: HistoryState<T>) => state.past.length > 0;
export const canRedo = <T>(state: HistoryState<T>) => state.future.length > 0;

/** 防抖提交器：连续 schedule 会重置计时器，最后一次到期后触发一次 fn */
export class DebouncedCommit<T> {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly delay: number,
    private readonly fn: (entry: T) => void,
  ) {}

  schedule(entry: T) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.fn(entry);
    }, this.delay);
  }

  cancel() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  get pending() {
    return this.timer !== null;
  }
}
