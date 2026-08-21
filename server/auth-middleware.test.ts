import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireAuth } from "./auth.js";

describe("authentication dependency failures", () => {
  it("fails closed with a retryable 503 instead of hanging or clearing the cookie", async () => {
    const redis = { get: vi.fn().mockRejectedValue(Object.assign(new Error("redis timeout"), { code: "ETIMEDOUT" })) };
    const req = { cookies: { firefly_session: "opaque-token" }, app: { locals: { redis } } } as unknown as Request;
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const setHeader = vi.fn();
    const res = { locals: { requestId: "request-1" }, status, setHeader } as unknown as Response;
    const next = vi.fn() as unknown as NextFunction;

    await requireAuth(req, res, next);

    expect(setHeader).toHaveBeenCalledWith("Retry-After", "2");
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ error: "登录状态暂时无法验证，请稍后重试", requestId: "request-1" });
    expect(next).not.toHaveBeenCalled();
  });
});
