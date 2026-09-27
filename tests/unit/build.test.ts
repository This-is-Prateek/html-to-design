import { beforeEach, describe, expect, it } from "vitest";
import type { FrameNode as IRFrame, IRDocument, TextNode as IRText } from "../../src/shared/ir";
import { Builder, countNodes } from "../../src/main/build";
import { FontResolver } from "../../src/main/fonts";

// Minimal fake of the Figma Plugin API surface the builder uses.
class FakeNode {
  children: FakeNode[] = [];
  x = 0;
  y = 0;
  width = 0;
  height = 0;
  props: Record<string, unknown> = {};
  ranges: unknown[] = [];
  characters = "";
  fontSize = 16;
  textAutoResize = "NONE";
  constructor(public type: string) {}
  appendChild(c: FakeNode) {
    this.children.push(c);
  }
  resize(w: number, h: number) {
    this.width = w;
    this.height = this.type === "TEXT" && this.textAutoResize === "HEIGHT" ? this.textHeight(w) : h;
  }
  // Fake text metrics: 0.5em per character, 20px per line.
  textHeight(w: number) {
    const lines = Math.max(1, Math.ceil((this.characters.length * this.fontSize * 0.5) / w));
    return lines * 20;
  }
  setRangeFontSize(_s: number, _e: number, v: number) {
    this.fontSize = v;
  }
  setRangeFontName(...a: unknown[]) {
    this.ranges.push(["font", ...a]);
  }
  setRangeFills() {}
  setRangeLetterSpacing() {}
  setRangeLineHeight() {}
  setRangeTextDecoration() {}
}

function install() {
  const loaded: string[] = [];
  (globalThis as any).figma = {
    createFrame: () => new FakeNode("FRAME"),
    createText: () => {
      const t = new FakeNode("TEXT");
      return new Proxy(t, {
        set(target, key, value) {
          (target as any)[key] = value;
          if (key === "textAutoResize" && value === "WIDTH_AND_HEIGHT") target.width = target.characters.length * target.fontSize * 0.5;
          return true;
        },
      });
    },
    createNodeFromSvg: (svg: string) => Object.assign(new FakeNode("FRAME"), { width: 24, height: 24, props: { svg } }),
    createImage: () => ({ hash: "hash1" }),
    loadFontAsync: async (f: FontName) => void loaded.push(`${f.family} ${f.style}`),
  };
  return loaded;
}

const style = {
  font: { families: ["Poppins", "sans-serif"], weight: 600, italic: false },
  size: 16,
  lineHeight: 20,
  letterSpacing: 0,
  color: { r: 0, g: 0, b: 0, a: 1 },
  decoration: "NONE" as const,
};

const text = (over: Partial<IRText>): IRText => ({
  kind: "text",
  name: "p",
  x: 10,
  y: 10,
  w: 100,
  h: 20,
  opacity: 1,
  characters: "Hello",
  align: "LEFT",
  singleLine: true,
  runs: [{ ...style, start: 0, end: 5 }],
  ...over,
});

const frame = (over: Partial<IRFrame>): IRFrame => ({
  kind: "frame",
  name: "div",
  x: 0,
  y: 0,
  w: 200,
  h: 100,
  opacity: 1,
  fills: [],
  borders: null,
  radii: null,
  shadows: [],
  clip: false,
  children: [],
  ...over,
});

describe("Builder", () => {
  let loaded: string[];
  const fonts = () =>
    new FontResolver(["Regular", "Semi Bold", "Bold"].map((s) => ({ family: "Inter", style: s })));

  beforeEach(() => {
    loaded = install();
  });

  it("builds every IR node, loads resolved fonts once and reports substitutions", async () => {
    const root = frame({
      fills: [{ type: "linear", angle: 90, stops: [{ position: 0, color: style.color }, { position: 1, color: style.color }] }],
      borders: { top: 1, right: 1, bottom: 1, left: 4, color: { r: 1, g: 0, b: 0, a: 1 } },
      radii: { tl: 8, tr: 8, br: 0, bl: 0 },
      shadows: [{ inset: false, x: 0, y: 2, blur: 4, spread: 0, color: { r: 0, g: 0, b: 0, a: 0.2 } }],
      children: [
        text({}),
        text({ characters: "World" }),
        frame({ name: "img", fills: [{ type: "placeholder", label: "https://x/y.png" }] }),
        { kind: "svg", name: "svg", x: 0, y: 0, w: 32, h: 32, opacity: 1, svg: "<svg/>" },
      ],
    });
    const doc: IRDocument = { title: "t", viewport: 1440, root, images: {}, unsupported: [], placeholders: [] };
    const r = fonts();
    const b = new Builder(r, async () => {});
    await b.loadFonts([doc]);
    const page = new FakeNode("PAGE");
    const out = (await b.build(root, page as any, 1440)) as unknown as FakeNode;

    expect(b.count).toBe(countNodes(root));
    expect(loaded.sort()).toEqual(["Inter Regular", "Inter Semi Bold"]);
    expect([...r.substitutions.keys()]).toEqual(["Poppins SemiBold"]);
    expect((out as any).fills[0].type).toBe("GRADIENT_LINEAR");
    expect((out as any).strokeLeftWeight).toBe(4);
    expect((out as any).strokeAlign).toBe("INSIDE");
    expect((out as any).effects[0].type).toBe("DROP_SHADOW");
    expect(out.children[2].props).toBeDefined();
    expect((out.children[2] as any).name).toBe("image: https://x/y.png");
    expect(b.roots).toHaveLength(1);
  });

  it("anchors single-line text by alignment", async () => {
    const b = new Builder(fonts(), async () => {});
    const page = new FakeNode("PAGE");
    // "Hello" is 40px wide in the fake; the IR box is 100px wide at x=10.
    const c = (await b.build(text({ align: "CENTER" }), page as any, 1)) as unknown as FakeNode;
    const r = (await b.build(text({ align: "RIGHT" }), page as any, 1)) as unknown as FakeNode;
    expect(c.x).toBe(10 + (100 - 40) / 2);
    expect(r.x).toBe(10 + 100 - 40);
  });

  it("widens multi-line text until the line count matches the browser, within a cap", async () => {
    const b = new Builder(fonts(), async () => {});
    const page = new FakeNode("PAGE");
    const chars = "abcdefghijklmnopqrstuvwxyz"; // 208px wide in the fake
    // Browser fit it in 2 lines at 100px; the fake needs 104px for 2 lines.
    const t = (await b.build(text({ characters: chars, singleLine: false, w: 100, h: 40 }), page as any, 1)) as unknown as FakeNode;
    expect([t.width, t.height]).toEqual([104, 40]);
    // A real layout mismatch (4 lines vs 2) is not "fixed" by stretching past the 4px/4% cap.
    const capped = (await b.build(text({ characters: chars, singleLine: false, w: 50, h: 40 }), page as any, 1)) as unknown as FakeNode;
    expect(capped.width).toBe(54);
  });
});
