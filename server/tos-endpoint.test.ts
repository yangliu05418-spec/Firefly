import { describe, expect, it } from "vitest";
import { tosEndpointMatches } from "./tos-endpoint.js";

describe("TOS endpoint validation", () => {
  it("accepts protocol and case differences", () => {
    expect(tosEndpointMatches("tos-cn-beijing.bytepluses.com.cn", "HTTPS://TOS-CN-BEIJING.BYTEPLUSES.COM.CN/")).toBe(true);
  });

  it("rejects a different TOS data plane", () => {
    expect(tosEndpointMatches("tos-cn-beijing.bytepluses.com.cn", "tos-cn-beijing.volces.com")).toBe(false);
  });

  it("rejects malformed or missing endpoints", () => {
    expect(tosEndpointMatches("", "tos-cn-beijing.bytepluses.com.cn")).toBe(false);
    expect(tosEndpointMatches("not a host", "tos-cn-beijing.bytepluses.com.cn")).toBe(false);
  });
});
