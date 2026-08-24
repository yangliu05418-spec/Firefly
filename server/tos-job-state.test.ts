import { describe, expect, it } from "vitest";
import { tosJobSucceeded } from "./tos.js";

describe("TOS asynchronous job states", () => {
  it.each(["Success", "Succeed", "Succeeded", "Done", "Complete", "Completed"])(
    "accepts the documented or observed success state %s",
    (state) => expect(tosJobSucceeded(state)).toBe(true),
  );

  it.each(["Running", "Pending", "Failed", "Cancelled", ""])(
    "does not treat the non-terminal-success state %s as successful",
    (state) => expect(tosJobSucceeded(state)).toBe(false),
  );
});
