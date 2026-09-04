import { config } from "./config.js";

type SourcePriority = "preview" | "archive";
type Waiter = { priority: number; sequence: number; resolve: (release: () => void) => void };

/**
 * Bounds concurrent reads from Provider URLs inside the media worker. Preview
 * waiters are admitted before queued archive ranges, while an already-running
 * transfer is never interrupted.
 */
export class MediaSourceBudget {
  private active = 0;
  private sequence = 0;
  private readonly waiters: Waiter[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("媒体源并发预算必须为正整数");
  }

  async run<T>(priority: SourcePriority, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(priority);
    try { return await operation(); }
    finally { release(); }
  }

  private acquire(priority: SourcePriority) {
    return new Promise<() => void>((resolve) => {
      this.waiters.push({ priority: priority === "preview" ? 0 : 10, sequence: this.sequence++, resolve });
      this.drain();
    });
  }

  private drain() {
    this.waiters.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    while (this.active < this.limit && this.waiters.length) {
      const waiter = this.waiters.shift()!;
      this.active += 1;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.active -= 1;
        this.drain();
      });
    }
  }
}

const sharedBudget = new MediaSourceBudget(config.tosSourceReadConcurrency);

export const withMediaSourceRead = <T>(priority: SourcePriority, operation: () => Promise<T>) =>
  sharedBudget.run(priority, operation);
