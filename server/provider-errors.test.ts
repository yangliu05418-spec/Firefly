import { describe, expect, it } from "vitest";
import { classifyProviderError, ProviderRequestError } from "./provider.js";

describe("provider error classification", () => {
  it.each([
    ["content safety policy", 400, "CONTENT_POLICY_REJECTED"],
    ["model is not activated", 403, "PROVIDER_MODEL_UNAVAILABLE"],
    ["rate limit", 429, "PROVIDER_RATE_LIMITED"],
    ["upstream failure", 503, "PROVIDER_UNAVAILABLE"],
    ["request timeout", "network", "PROVIDER_TIMEOUT"],
    ["socket reset", "network", "PROVIDER_NETWORK_ERROR"],
    ["reference may contain real person", 400, "REFERENCE_ASSET_REJECTED"],
  ] as const)("maps %s to %s", (message, status, errorCode) => {
    expect(classifyProviderError(message, status).errorCode).toBe(errorCode);
  });

  it("preserves provider diagnostics without exposing its raw message", () => {
    const error = new ProviderRequestError("Name must be no more than 64 character", 400, { providerCode: "InvalidParameter", requestId: "req-1", stage: "submit" });
    expect(error).toMatchObject({
      message: "生成参数不符合当前模型要求，请检查模式和素材",
      errorCode: "PROVIDER_INVALID_PARAMETERS",
      providerCode: "InvalidParameter",
      requestId: "req-1",
      stage: "submit",
      retryable: false,
    });
  });

  it("returns the actionable mode hint for explicit task type conflicts", () => {
    expect(classifyProviderError("omni_reference_task_type conflicts with duration", 400).publicMessage).toContain("视频编辑模式");
  });
});
