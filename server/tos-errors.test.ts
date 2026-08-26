import { describe, expect, it } from "vitest";
import { tosArchiveErrorCode, withTosArchiveStage } from "./tos-errors.js";

describe("TOS archive error classification", () => {
  it("does not misclassify a TOS permission failure as an expired provider URL", () => {
    const error = withTosArchiveStage(Object.assign(new Error("AccessDenied"), { statusCode: 403, code: "AccessDenied" }), "tos_list_parts");
    expect(tosArchiveErrorCode(error)).toBe("TOS_PERMISSION_DENIED");
  });

  it("classifies a provider source 403 as expired", () => {
    const error = withTosArchiveStage(Object.assign(new Error("forbidden"), { statusCode: 403 }), "source_read");
    expect(tosArchiveErrorCode(error)).toBe("TOS_SOURCE_EXPIRED");
  });

  it("classifies a missing multipart upload separately", () => {
    const error = withTosArchiveStage(Object.assign(new Error("NoSuchUpload"), { statusCode: 404, code: "NoSuchUpload" }), "tos_list_parts");
    expect(tosArchiveErrorCode(error)).toBe("TOS_UPLOAD_MISSING");
  });
});
