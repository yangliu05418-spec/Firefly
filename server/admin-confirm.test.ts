import { describe, expect, it } from "vitest";
import { validateAdminWrite } from "./admin-confirm.js";

describe("admin CLI write confirmation", () => {
  it("requires an operator and an exact target echo", () => {
    expect(() => validateAdminWrite({ target: "task-1", confirmation: "task-1" })).toThrow("FIREFLY_OPERATOR");
    expect(() => validateAdminWrite({ target: "task-1", confirmation: "task-2", operator: "cto@dokuai.tv" })).toThrow("--confirm task-1");
    expect(validateAdminWrite({ target: "task-1", confirmation: "task-1", operator: " cto@dokuai.tv " })).toEqual({ target: "task-1", operator: "cto@dokuai.tv" });
  });
});
