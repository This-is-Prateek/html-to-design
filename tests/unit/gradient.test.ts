import { describe, expect, it } from "vitest";
import { parseColor } from "../../src/ui/extract/color";
import { gradientLength, parseGradient, splitTopLevel } from "../../src/ui/extract/gradient";

const resolve = (c: string) => parseColor(c);

describe("splitTopLevel", () => {
  it("ignores commas inside parentheses", () => {
    expect(splitTopLevel("rgb(1, 2, 3) 0%, rgb(4, 5, 6) 100%")).toEqual(["rgb(1, 2, 3) 0%", "rgb(4, 5, 6) 100%"]);
  });
});

describe("parseGradient", () => {
  it("defaults to 180deg and distributes missing stops", () => {
    const g = parseGradient("linear-gradient(rgb(255, 0, 0), rgb(0, 255, 0), rgb(0, 0, 255))", resolve, 100)!;
    expect(g.type).toBe("linear");
    if (g.type !== "linear") return;
    expect(g.angle).toBe(180);
    expect(g.stops.map((s) => s.position)).toEqual([0, 0.5, 1]);
  });
  it("reads angles, side keywords and px stops", () => {
    const g = parseGradient("linear-gradient(to right, rgb(0, 0, 0) 20px, rgb(255, 255, 255) 80%)", resolve, 200)!;
    if (g.type !== "linear") throw new Error("expected linear");
    expect(g.angle).toBe(90);
    expect(g.stops[0].position).toBeCloseTo(0.1);
    expect(g.stops[1].position).toBeCloseTo(0.8);
    const t = parseGradient("linear-gradient(0.25turn, #000, #fff)", resolve, 1) as { angle: number };
    expect(t.angle).toBe(90);
  });
  it("parses radial gradients with a shape prelude", () => {
    const g = parseGradient("radial-gradient(circle at center, rgb(0, 0, 0) 0%, rgb(255, 255, 255) 100%)", resolve, 1)!;
    expect(g.type).toBe("radial");
  });
  it("computes gradient line length", () => {
    expect(gradientLength(90, 200, 100)).toBeCloseTo(200);
    expect(gradientLength(180, 200, 100)).toBeCloseTo(100);
  });
});
