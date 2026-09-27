import { describe, expect, it } from "vitest";
import { linearTransform } from "../../src/main/paint";

// Applies the inverse (node → gradient) transform to a node-space point.
const apply = (t: number[][], x: number, y: number) => [t[0][0] * x + t[0][1] * y + t[0][2], t[1][0] * x + t[1][1] * y + t[1][2]];

describe("linearTransform", () => {
  it("maps a top-to-bottom gradient onto the node's vertical axis", () => {
    const t = linearTransform(180, 100, 50) as unknown as number[][];
    expect(apply(t, 0.5, 0)[0]).toBeCloseTo(0);
    expect(apply(t, 0.5, 1)[0]).toBeCloseTo(1);
  });
  it("maps a left-to-right gradient onto the horizontal axis", () => {
    const t = linearTransform(90, 100, 50) as unknown as number[][];
    expect(apply(t, 0, 0.5)[0]).toBeCloseTo(0);
    expect(apply(t, 1, 0.5)[0]).toBeCloseTo(1);
  });
  it("reaches the corners for diagonal angles like CSS", () => {
    const t = linearTransform(135, 200, 100) as unknown as number[][];
    expect(apply(t, 0, 0)[0]).toBeCloseTo(0);
    expect(apply(t, 1, 1)[0]).toBeCloseTo(1);
  });
});
