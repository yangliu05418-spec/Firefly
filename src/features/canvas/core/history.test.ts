import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canRedo, canUndo, createHistory, DebouncedCommit, historyPush, historyRedo, historyUndo } from "./history";

describe("history", () => {
  it("pushes entries with a 50-step cap (FIFO)", () => {
    let state = createHistory<number>();
    for (let i = 0; i < 60; i++) state = historyPush(state, i);
    expect(state.past).toHaveLength(50);
    expect(state.past[0]).toBe(10);
    expect(state.past[49]).toBe(59);
  });

  it("undo/redo round trips with the previous-snapshot semantics and clears future on new commits", () => {
    // 每次文档变更时把"变更前快照"压入 past；current 由外部维护（此处模拟 1 → 2 → 3 的三次状态）
    let state = createHistory<number>();
    state = historyPush(state, 1); // 变到 2 时提交
    state = historyPush(state, 2); // 变到 3 时提交
    const undone = historyUndo(state, 3);
    expect(undone.value).toBe(2);
    expect(undone.state.future).toEqual([3]);
    const redone = historyRedo(undone.state, 2);
    expect(redone.value).toBe(3);
    expect(redone.state.future).toEqual([]);
    const afterNewEdit = historyPush(redone.state, 3);
    expect(afterNewEdit.future).toEqual([]);
    expect(afterNewEdit.past).toEqual([1, 2, 3]);
  });

  it("returns null when there is nothing to undo or redo", () => {
    const empty = createHistory<number>();
    expect(historyUndo(empty, 1).value).toBeNull();
    expect(historyRedo(empty, 1).value).toBeNull();
  });

  it("tracks canUndo/canRedo", () => {
    let state = historyPush(createHistory<number>(), 1);
    expect(canUndo(state)).toBe(true);
    expect(canRedo(state)).toBe(false);
    const undone = historyUndo(state, 2);
    expect(canUndo(undone.state)).toBe(false);
    expect(canRedo(undone.state)).toBe(true);
  });
});

describe("DebouncedCommit", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("merges rapid schedules into one commit with the last entry", () => {
    const commits: string[] = [];
    const committer = new DebouncedCommit<string>(180, (entry) => commits.push(entry));
    committer.schedule("a");
    vi.advanceTimersByTime(100);
    committer.schedule("b");
    vi.advanceTimersByTime(100);
    committer.schedule("c");
    vi.advanceTimersByTime(179);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual(["c"]);
    expect(committer.pending).toBe(false);
  });

  it("cancel prevents the commit", () => {
    const commits: string[] = [];
    const committer = new DebouncedCommit<string>(180, (entry) => commits.push(entry));
    committer.schedule("a");
    committer.cancel();
    vi.advanceTimersByTime(300);
    expect(commits).toEqual([]);
    expect(committer.pending).toBe(false);
  });
});
