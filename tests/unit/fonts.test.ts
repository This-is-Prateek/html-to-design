import { describe, expect, it } from "vitest";
import { FontResolver, parseStyle } from "../../src/main/fonts";

const fonts = [
  ...["Regular", "Medium", "Semi Bold", "Bold", "Italic", "Bold Italic"].map((style) => ({ family: "Inter", style })),
  ...["Light", "Regular", "Bold"].map((style) => ({ family: "Roboto", style })),
  { family: "Roboto", style: "Condensed Bold" },
  { family: "Roboto Mono", style: "Regular" },
];

describe("parseStyle", () => {
  it("maps style names to weights", () => {
    expect(parseStyle("SemiBold")).toMatchObject({ weight: 600, italic: false });
    expect(parseStyle("Semi Bold Italic")).toMatchObject({ weight: 600, italic: true });
    expect(parseStyle("ExtraBold")).toMatchObject({ weight: 800 });
    expect(parseStyle("Condensed Bold")).toMatchObject({ weight: 700, extra: 1 });
  });
});

describe("FontResolver", () => {
  const spec = (families: string[], weight = 400, italic = false) => ({ families, weight, italic });

  it("picks the exact family and weight without reporting", () => {
    const r = new FontResolver(fonts);
    expect(r.resolve(spec(["Inter", "sans-serif"], 600))).toEqual({ family: "Inter", style: "Semi Bold" });
    expect(r.substitutions.size).toBe(0);
  });
  it("prefers plain styles over width variants", () => {
    const r = new FontResolver(fonts);
    expect(r.resolve(spec(["Roboto"], 700))).toEqual({ family: "Roboto", style: "Bold" });
  });
  it("falls back using CSS weight matching and reports it", () => {
    const r = new FontResolver(fonts);
    // CSS: for 500, lighter weights are tried before heavier ones.
    expect(r.resolve(spec(["Roboto"], 500)).style).toBe("Regular");
    expect(r.resolve(spec(["Roboto"], 600)).style).toBe("Bold");
    expect([...r.substitutions.values()][0].requested).toBe("Roboto Medium");
  });
  it("maps generic families and reports missing named families", () => {
    const r = new FontResolver(fonts);
    expect(r.resolve(spec(["Poppins", "sans-serif"], 700))).toEqual({ family: "Inter", style: "Bold" });
    expect(r.resolve(spec(["monospace"]))).toEqual({ family: "Roboto Mono", style: "Regular" });
    expect([...r.substitutions.keys()]).toEqual(["Poppins Bold"]);
  });
  it("honours italics", () => {
    const r = new FontResolver(fonts);
    expect(r.resolve(spec(["Inter"], 700, true)).style).toBe("Bold Italic");
  });
});
