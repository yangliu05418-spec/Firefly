import { describe, expect, it } from "vitest";
import { tosEndpointMatches } from "./tos-endpoint.js";
import { providerObjectSigningInput } from "./tos.js";

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

  it("keeps provider media signatures free of response header overrides", () => {
    const input = providerObjectSigningInput("drama-firefly", "assets/ref.jpg", 7200);
    expect(input).toEqual({ bucket: "drama-firefly", key: "assets/ref.jpg", method: "GET", expires: 7200 });
    expect(input).not.toHaveProperty("response");
  });
});
