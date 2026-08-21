import { describe, expect, it, vi } from "vitest";
import { bootstrapSession } from "./auth-bootstrap";

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
});
