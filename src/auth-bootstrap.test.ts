import { describe, expect, it, vi } from "vitest";
import { bootstrapSession, sessionBootstrapCanRetry } from "./auth-bootstrap";

describe("authenticated browser bootstrap", () => {
  it("activates the private media scope before returning the user", async () => {
    const events: string[] = [];
    const user = { id: "user-a", email: "a@dokuai.tv", name: "A", avatarUrl: "" };
    const result = await bootstrapSession({
      load: async () => ({ authenticated: true, user }),
      activateMediaScope: async (id) => { events.push(`scope:${id}`); },
      deactivateMediaScope: vi.fn(),
    });
    events.push("render");
    expect(result).toEqual(user);
    expect(events).toEqual(["scope:user-a", "render"]);
  });

  it("deactivates private media reads for an anonymous session", async () => {
    const deactivate = vi.fn(async () => undefined);
    await expect(bootstrapSession({
      load: async () => ({ authenticated: false }),
      activateMediaScope: vi.fn(),
      deactivateMediaScope: deactivate,
    })).resolves.toBeNull();
    expect(deactivate).toHaveBeenCalledOnce();
  });

  it("recovers a transient dependency failure without presenting a false logout", async () => {
    const user = { id: "user-a", email: "a@dokuai.tv", name: "A", avatarUrl: "" };
    const load = vi.fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockRejectedValueOnce({ status: 0 })
      .mockResolvedValue({ authenticated: true, user });
    const wait = vi.fn(async () => undefined);
    await expect(bootstrapSession({ load, wait, activateMediaScope: vi.fn(async () => undefined), deactivateMediaScope: vi.fn(async () => undefined) })).resolves.toEqual(user);
    expect(load).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it("does not retry deterministic client failures", async () => {
    const load = vi.fn().mockRejectedValue({ status: 400 });
    await expect(bootstrapSession({ load, wait: vi.fn(), activateMediaScope: vi.fn(), deactivateMediaScope: vi.fn() })).rejects.toEqual({ status: 400 });
    expect(load).toHaveBeenCalledOnce();
  });

  it("classifies only safe session reads as retryable", () => {
    expect(sessionBootstrapCanRetry({ status: 0 })).toBe(true);
    expect(sessionBootstrapCanRetry({ status: 429 })).toBe(true);
    expect(sessionBootstrapCanRetry({ status: 503 })).toBe(true);
    expect(sessionBootstrapCanRetry({ status: 401 })).toBe(false);
  });
});
