import { describe, expect, it, vi } from "vitest";
import type { CreationSession, ImageResultBundle, ModelCapability, Task } from "./types";
import { loadStudioBootstrap, type StudioBootstrapReaders } from "./studio-bootstrap";

const session: CreationSession = { id: "session-a", title: "新创作", createdAt: 1, updatedAt: 1 };
const models = [{ id: "model", name: "Model" }] as ModelCapability[];
const readers = (patch: Partial<StudioBootstrapReaders> = {}): StudioBootstrapReaders => ({
  readModels: async () => models,
  readTasks: async () => [] as Task[],
  readImages: async () => [] as ImageResultBundle[],
  readSessions: async () => [session],
  createSession: vi.fn(async () => session),
  ...patch,
});

describe("studio bootstrap", () => {
  it("keeps Studio usable when one historical media feed is temporarily unavailable", async () => {
    const result = await loadStudioBootstrap(readers({ readImages: async () => { throw new Error("image history unavailable"); } }));
    expect(result).toMatchObject({ models, tasks: [], images: [], sessions: [session], degraded: true });
  });

  it("creates the first session only after an authoritative empty session list", async () => {
    const createSession = vi.fn(async () => session);
    const result = await loadStudioBootstrap(readers({ readSessions: async () => [], createSession }));
    expect(result.sessions).toEqual([session]);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it("fails closed when capabilities or session ownership cannot be loaded", async () => {
    await expect(loadStudioBootstrap(readers({ readModels: async () => { throw new Error("models unavailable"); } }))).rejects.toThrow("models unavailable");
    await expect(loadStudioBootstrap(readers({ readSessions: async () => { throw new Error("sessions unavailable"); } }))).rejects.toThrow("sessions unavailable");
  });
});
