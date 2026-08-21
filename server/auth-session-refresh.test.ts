import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

const user = { id: "user-refresh", email: "refresh@dokuai.tv", name: "Refresh", avatarUrl: "", status: "active" };
vi.mock("./store.js", () => ({ users: { findById: vi.fn(() => user) } }));

import { getSessionUser } from "./auth.js";

describe("sliding authentication sessions", () => {
  it("refreshes Redis and the browser cookie at most once per interval", async () => {
    const exec = vi.fn(async () => []);
    const chain = { expire: vi.fn(() => chain), exec };
    const redis = { get: vi.fn(async () => user.id), multi: vi.fn(() => chain) };
    const req = { cookies: { firefly_session: `opaque-${crypto.randomUUID()}` } } as unknown as Request;
    const res = { cookie: vi.fn() } as unknown as Response;

    expect(await getSessionUser(redis as never, req, res)).toMatchObject({ id: user.id });
    expect(await getSessionUser(redis as never, req, res)).toMatchObject({ id: user.id });

    expect(redis.get).toHaveBeenCalledTimes(2);
    expect(redis.multi).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });

  it("allows a later request to retry when the refresh write fails", async () => {
    const exec = vi.fn().mockRejectedValueOnce(new Error("redis write failed")).mockResolvedValueOnce([]);
    const chain = { expire: vi.fn(() => chain), exec };
    const redis = { get: vi.fn(async () => user.id), multi: vi.fn(() => chain) };
    const req = { cookies: { firefly_session: `opaque-${crypto.randomUUID()}` } } as unknown as Request;
    const res = { cookie: vi.fn() } as unknown as Response;

    await expect(getSessionUser(redis as never, req, res)).rejects.toThrow("redis write failed");
    await expect(getSessionUser(redis as never, req, res)).resolves.toMatchObject({ id: user.id });

    expect(redis.multi).toHaveBeenCalledTimes(2);
    expect(res.cookie).toHaveBeenCalledTimes(1);
  });
});
