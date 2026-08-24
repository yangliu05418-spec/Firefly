import { describe, expect, it } from "vitest";
import { tosArchiveErrorCode } from "./tos-errors.js";

describe("TOS archive error codes", () => {
  it("classifies resumable and operational failures", () => {
    expect(tosArchiveErrorCode(Object.assign(new Error("pending"), { code: "TOS_FETCH_PENDING" }))).toBe("TOS_FETCH_PENDING");
    expect(tosArchiveErrorCode(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe("TOS_REQUEST_TIMEOUT");
    expect(tosArchiveErrorCode(Object.assign(new Error("busy"), { statusCode: 503 }))).toBe("TOS_UNAVAILABLE");
    expect(tosArchiveErrorCode(Object.assign(new Error("missing"), { statusCode: 404 }))).toBe("TOS_SOURCE_EXPIRED");
  });
});
