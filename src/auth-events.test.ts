// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { listenForSignedOut, notifySignedOut } from "./api";

describe("auth lifecycle events", () => {
  it("distinguishes an expired session from an intentional logout", () => {
    const reasons: string[] = [];
    const stop = listenForSignedOut((reason) => reasons.push(reason));
    notifySignedOut();
    notifySignedOut("explicit");
    stop();
    expect(reasons).toEqual(["expired", "explicit"]);
  });
});
