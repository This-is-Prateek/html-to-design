import { describe, expect, it } from "vitest";
import { parseColor } from "../../src/ui/extract/color";
import { parseShadows } from "../../src/ui/extract/style";
import { RunBuilder } from "../../src/ui/extract/text";
import { markerText } from "../../src/ui/extract/walk";

const style = {
  font: { families: ["Inter"], weight: 400, italic: false },
  size: 16,
  lineHeight: null,
  letterSpacing: 0,
  color: { r: 0, g: 0, b: 0, a: 1 },
  decoration: "NONE" as const,
};

describe("parseShadows", () => {
  it("parses computed multi-layer shadows with inset", () => {
    const s = parseShadows("rgba(0, 0, 0, 0.1) 0px 1px 3px 0px, rgb(255, 0, 0) 2px 4px 6px 1px inset", parseColor);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ inset: false, x: 0, y: 1, blur: 3, spread: 0 });
    expect(s[1]).toMatchObject({ inset: true, x: 2, y: 4, blur: 6, spread: 1 });
  });
  it("drops transparent shadows and none", () => {
    expect(parseShadows("none", parseColor)).toEqual([]);
    expect(parseShadows("rgba(0, 0, 0, 0) 0px 0px 0px 0px", parseColor)).toEqual([]);
  });
});

describe("RunBuilder", () => {
  it("collapses whitespace across nodes and trims ends", () => {
    const b = new RunBuilder();
    b.push("\n  Hello   ", "normal", style);
    b.push("  world ", "normal", { ...style, font: { ...style.font, weight: 700 } });
    b.trimEnd();
    expect(b.text).toBe("Hello world");
    expect(b.runs.map((r) => [r.start, r.end, r.font.weight])).toEqual([
      [0, 6, 400],
      [6, 11, 700],
    ]);
  });
  it("keeps whitespace in pre and handles <br>", () => {
    const b = new RunBuilder();
    b.push("a  b", "pre", style);
    b.newline(style);
    b.push(" c", "normal", style);
    expect(b.text).toBe("a  b\nc");
    expect(b.runs).toHaveLength(1);
  });
  it("applies text-transform", () => {
    const b = new RunBuilder();
    b.push("hello world", "normal", style, "capitalize");
    expect(b.text).toBe("Hello World");
  });
});

describe("markerText", () => {
  it("formats list markers", () => {
    expect(markerText("decimal", 3)).toBe("3. ");
    expect(markerText("upper-roman", 4)).toBe("IV. ");
    expect(markerText("lower-alpha", 2)).toBe("b. ");
  });
});
