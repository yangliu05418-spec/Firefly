import { describe, expect, it } from "vitest";
import { readJourneySlos } from "./journey-observability.js";

describe("journey SLO aggregation", () => {
  it("computes availability and p95 from bounded minute buckets", async () => {
    const redis = {
      mget: async (...keys: string[]) => keys.map((key) => key.includes(":poster_load:")
        ? key.endsWith(":total") ? "5" : key.endsWith(":success") ? "4" : key.endsWith(":failure") ? "1" : null
        : null),
      lrange: async (key: string) => key.includes(":poster_load:") ? ["100", "200", "300", "400"] : [],
    };
    const result = await readJourneySlos(redis as never, 1);
    const poster = result.find((item) => item.journey === "poster_load");
    expect(poster).toMatchObject({ total: 5, success: 4, failure: 1, availability: 0.8, p95Ms: 400, sampleStatus: "breached" });
  });

  it("does not alert on tiny samples", async () => {
    const redis = { mget: async () => ["1", "0", "1"], lrange: async () => [] };
    const result = await readJourneySlos(redis as never, 1);
    expect(result.every((item) => item.sampleStatus === "insufficient")).toBe(true);
  });
});
