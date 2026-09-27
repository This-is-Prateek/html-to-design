import { describe, expect, it } from "vitest";
import { parseColor } from "../../src/ui/extract/color";

describe("parseColor", () => {
  it("parses computed rgb/rgba", () => {
    expect(parseColor("rgb(255, 0, 0)")).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(parseColor("rgba(0, 0, 255, 0.5)")).toEqual({ r: 0, g: 0, b: 1, a: 0.5 });
  });
  it("parses space-separated syntax with slash alpha", () => {
    expect(parseColor("rgb(0 255 0 / 25%)")).toEqual({ r: 0, g: 1, b: 0, a: 0.25 });
  });
  it("parses hex forms", () => {
    expect(parseColor("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(parseColor("#00000080")!.a).toBeCloseTo(0.502, 2);
  });
  it("parses hsl", () => {
    const c = parseColor("hsl(120, 100%, 50%)")!;
    expect(c.r).toBeCloseTo(0);
    expect(c.g).toBeCloseTo(1);
    expect(c.b).toBeCloseTo(0);
  });
  it("parses color(srgb)", () => {
    expect(parseColor("color(srgb 1 0.5 0 / 0.5)")).toEqual({ r: 1, g: 0.5, b: 0, a: 0.5 });
  });
  it("treats transparent as zero alpha and rejects unknown spaces", () => {
    expect(parseColor("transparent")!.a).toBe(0);
    expect(parseColor("oklch(0.7 0.1 200)")).toBeNull();
  });
});
