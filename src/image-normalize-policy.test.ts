import { describe, expect, it } from "vitest";
import { imageNormalizationPlan } from "./image-normalize-policy";

describe("image upload normalization policy", () => {
  it("keeps compliant images byte-for-byte eligible", () => {
    expect(imageNormalizationPlan(1920, 1080).adjusted).toBe(false);
    expect(imageNormalizationPlan(6000, 3000).adjusted).toBe(false);
  });

  it("pads an extremely wide image to the nearest standard ratio", () => {
    const plan = imageNormalizationPlan(5000, 500);
    expect(plan.adjusted).toBe(true);
    expect(plan.targetWidth / plan.targetHeight).toBeCloseTo(21 / 9, 2);
    expect(plan.drawY).toBeGreaterThan(0);
    expect(plan.targetWidth).toBeLessThanOrEqual(4096);
  });

  it("pads an extremely tall image to portrait video ratio", () => {
    const plan = imageNormalizationPlan(400, 4000);
    expect(plan.targetWidth / plan.targetHeight).toBeCloseTo(9 / 16, 2);
    expect(plan.drawX).toBeGreaterThan(0);
  });

  it("rescales undersized and oversized compliant-ratio images without changing ratio", () => {
    const small = imageNormalizationPlan(120, 120);
    expect(small.targetWidth).toBeGreaterThanOrEqual(512);
    expect(small.targetHeight).toBeGreaterThanOrEqual(512);
    const large = imageNormalizationPlan(9000, 4500);
    expect(Math.max(large.targetWidth, large.targetHeight)).toBeLessThanOrEqual(4096);
    expect(large.targetWidth / large.targetHeight).toBeCloseTo(2, 2);
  });
});
