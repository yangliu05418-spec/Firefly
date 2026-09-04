import { describe, expect, it, vi } from "vitest";
import { listGenerationHistory, readGenerationHistoryPage } from "./generation-history";
import type { Task } from "./types";

const task = (index: number): Task => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  caseId: `case-${index}`,
  status: "succeeded",
  prompt: "",
  model: "seedance",
  mode: "text",
  ratio: "16:9",
  resolution: "720p",
  duration: 5,
  createdAt: 10_000 - index,
  updatedAt: 10_000 - index,
});

describe("generation history pagination", () => {
  it("loads every page in a long session with a stable keyset cursor", async () => {
    const first = Array.from({ length: 100 }, (_, index) => task(index));
    const second = Array.from({ length: 19 }, (_, index) => task(index + 100));
    const read = vi.fn(async (url: string) => url.includes("beforeCreatedAt") ? second : first);

    const result = await listGenerationHistory("11111111-1111-4111-8111-111111111111", read);

    expect(result).toHaveLength(119);
    expect(new Set(result.map((item) => item.id)).size).toBe(119);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[1]?.[0]).toContain(`beforeCreatedAt=${first.at(-1)?.createdAt}`);
    expect(read.mock.calls[1]?.[0]).toContain(`beforeId=${first.at(-1)?.id}`);
    expect(read.mock.calls[1]?.[0]).toContain("sessionId=11111111-1111-4111-8111-111111111111");
  });

  it("fails closed if a server repeats a full page without advancing the cursor", async () => {
    const page = Array.from({ length: 100 }, (_, index) => task(index));
    await expect(listGenerationHistory(undefined, async () => page)).rejects.toThrow("分页游标没有前进");
  });

  it("reads only the authoritative head page for active polling", async () => {
    const read = vi.fn(async (_url: string) => [task(1)]);
    await expect(readGenerationHistoryPage("11111111-1111-4111-8111-111111111111", undefined, read)).resolves.toHaveLength(1);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[0]).toContain("pageSize=100");
  });
});
