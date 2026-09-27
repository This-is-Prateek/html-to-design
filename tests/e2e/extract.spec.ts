import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import type { FrameNode, IRDocument, IRNode, TextNode } from "../../src/shared/ir";

type Result = { ir: IRDocument; preview: string };

const fixture = (name: string) => readFileSync(`tests/fixtures/${name}.html`, "utf8");

async function run(page: Page, html: string, width: number, height = 900): Promise<Result> {
  await page.setViewportSize({ width, height });
  await page.goto("about:blank");
  await page.addScriptTag({ path: "dist/harness.js" });
  return page.evaluate(([h, w, vh]) => (window as any).h2d.run(h, w, vh), [html, width, height] as const);
}

async function shot(page: Page, html: string, width: number): Promise<PNG> {
  await page.setViewportSize({ width, height: 900 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  return PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled" }));
}

/** Fraction of differing pixels between the source page and the IR re-render. */
async function diff(page: Page, name: string, html: string, preview: string, width: number): Promise<number> {
  const a = await shot(page, html, width);
  const b = await shot(page, preview, width);
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const crop = (p: PNG) => {
    const out = new PNG({ width: w, height: h });
    PNG.bitblt(p, out, 0, 0, w, h, 0, 0);
    return out;
  };
  const out = new PNG({ width: w, height: h });
  const bad = pixelmatch(crop(a).data, crop(b).data, out.data, w, h, { threshold: 0.15 });
  mkdirSync("test-results/diff", { recursive: true });
  writeFileSync(`test-results/diff/${name}-${width}.png`, PNG.sync.write(out));
  writeFileSync(`test-results/diff/${name}-${width}.source.png`, PNG.sync.write(a));
  writeFileSync(`test-results/diff/${name}-${width}.ir.png`, PNG.sync.write(b));
  writeFileSync(`test-results/diff/${name}-${width}.preview.html`, preview);
  expect(Math.abs(a.height - b.height), "page heights should match").toBeLessThanOrEqual(2);
  return bad / (w * h);
}

function all(n: IRNode): IRNode[] {
  return [n, ...(n.kind === "frame" ? n.children.flatMap(all) : [])];
}
const texts = (ir: IRDocument) => all(ir.root).filter((n): n is TextNode => n.kind === "text");

for (const name of ["typography", "cards", "landing"]) {
  for (const width of [1440, 375]) {
    test(`${name} @${width}: IR re-render matches the browser`, async ({ page }) => {
      const html = fixture(name);
      const { ir, preview } = await run(page, html, width);
      writeFileSync(`test-results/${name}-${width}.ir.json`, JSON.stringify(ir, null, 1));
      const ratio = await diff(page, name, html, preview, width);
      console.log(`${name}@${width}: ${(ratio * 100).toFixed(2)}% pixels differ, ${all(ir.root).length} nodes`);
      expect(ratio).toBeLessThan(0.005);
    });
  }
}

test("typography: fonts, runs, whitespace and markers", async ({ page }) => {
  const { ir } = await run(page, fixture("typography"), 1440);
  const t = texts(ir);
  const h1 = t.find((n) => n.characters === "The quick brown fox")!;
  expect(h1.name).toBe("h1");
  expect(h1.runs[0]).toMatchObject({ size: 48, lineHeight: 56, letterSpacing: -1 });
  expect(h1.runs[0].font).toMatchObject({ families: ["Arial", "sans-serif"], weight: 700 });

  const body = t.find((n) => n.characters.startsWith("Body copy"))!;
  expect(body.singleLine).toBe(false);
  const styleAt = (s: string) => body.runs.find((r) => r.start === body.characters.indexOf(s))!;
  expect(styleAt("bold").font.weight).toBe(700);
  expect(styleAt("italic").font.italic).toBe(true);
  expect(styleAt("link").decoration).toBe("UNDERLINE");
  expect(styleAt("red text").color.r).toBeCloseTo(0.863, 2);

  expect(t.find((n) => n.characters === "OVERLINE LABEL")).toBeTruthy();
  expect(t.some((n) => n.characters === "Line one\nLine two after a break")).toBe(true);
  expect(t.some((n) => n.characters.includes("const x = 1;\n  indented()"))).toBe(true);
  expect(t.find((n) => n.characters === "Centered paragraph")!.align).toBe("CENTER");
  expect(t.filter((n) => n.name === "marker").map((n) => n.characters.trim())).toEqual(["•", "•", "3.", "4."]);
});

test("cards: oklch tokens, gradients, borders, radii, shadows, stacking", async ({ page }) => {
  const { ir } = await run(page, fixture("cards"), 1440);
  const frames = all(ir.root).filter((n): n is FrameNode => n.kind === "frame");
  const card = frames.find((f) => f.name === "div.card")!;
  expect(card.radii).toEqual({ tl: 12, tr: 12, br: 12, bl: 12 });
  expect(card.shadows).toHaveLength(2);
  expect(card.clip).toBe(true);

  const media = frames.find((f) => f.name === "div.media")!;
  expect(media.fills[0]).toMatchObject({ type: "linear", angle: 135 });
  expect(frames.find((f) => f.name === "div.media.c")!.fills[0].type).toBe("radial");

  const btn = frames.find((f) => f.name === "button.btn")!;
  const fill = btn.fills[0];
  expect(fill.type).toBe("solid");
  if (fill.type === "solid") expect(fill.color.b).toBeGreaterThan(fill.color.r); // oklch blue resolved to sRGB

  const outline = frames.find((f) => f.name === "div.outline")!;
  expect(outline.borders).toMatchObject({ top: 2, right: 2, bottom: 2, left: 6 });
  expect(outline.radii).toEqual({ tl: 4, tr: 16, br: 4, bl: 16 });

  const abs = frames.find((f) => f.name === "div.abs")!;
  expect(abs.children.map((c) => c.name)).toEqual(["i", "span"]); // z-index:2 paints last
});

test("landing: images, placeholders, svg, pseudo-elements, forms, hidden", async ({ page }) => {
  const { ir } = await run(page, fixture("landing"), 1440);
  const nodes = all(ir.root);
  expect(nodes.filter((n) => n.kind === "svg" && n.name !== "check")).toHaveLength(4);
  expect(nodes.find((n) => n.kind === "svg")!.kind === "svg" && (nodes.find((n) => n.kind === "svg") as any).svg).toContain('fill="#2563eb"');

  const img = nodes.find((n): n is FrameNode => n.kind === "frame" && n.name === "img")!;
  expect(img.fills[0]).toMatchObject({ type: "image", scaleMode: "FILL" });
  expect(img.radii?.tl).toBe(16);

  const t = texts(ir);
  expect(t.some((n) => n.characters === "★ Rated 4.9 by teams")).toBe(true);
  const ph = t.find((n) => n.name === "placeholder")!;
  expect(ph.characters).toBe("you@company.com");
  expect(ph.verticalCenter).toBe(true);
  expect(t.some((n) => n.characters === "Hidden")).toBe(false);
  expect(nodes.some((n) => n.name === "check")).toBe(true);

  const underline = nodes.find((n) => n.kind === "frame" && n.name === "span" && n.h === 2);
  expect(underline, "::after underline materialized").toBeTruthy();
});

test("remote images become named placeholders and remote CSS is reported", async ({ page }) => {
  const html = `<link rel="stylesheet" href="https://cdn.example.com/site.css"><img src="https://example.com/remote.png" style="width:120px;height:80px">`;
  const { ir } = await run(page, html, 1440);
  expect(ir.placeholders).toContain("https://example.com/remote.png");
  const img = all(ir.root).find((n): n is FrameNode => n.kind === "frame" && n.name === "img")!;
  expect(img).toMatchObject({ w: 120, h: 80 });
  expect(img.fills[0].type).toBe("placeholder");
  expect(ir.unsupported).toContain("remote stylesheet not loaded: https://cdn.example.com/site.css");
});

test("inline elements with horizontal spacing stay separate layers", async ({ page }) => {
  const html = `<nav style="font:14px Arial"><a href="#" style="margin-left:24px">Pricing</a><a href="#" style="margin-left:24px">Docs</a></nav>`;
  const { ir } = await run(page, html, 1440);
  expect(texts(ir).map((t) => t.characters)).toEqual(["Pricing", "Docs"]);
});

test("large page (2.5k elements) extracts quickly", async ({ page }) => {
  const rows = Array.from(
    { length: 500 },
    (_, i) => `<div class="row"><span class="dot"></span><p>Row ${i} <b>bold</b></p><button>Action</button><em>meta</em></div>`,
  ).join("");
  const html = `<style>.row{display:flex;gap:8px;padding:8px;border-bottom:1px solid #eee;font:14px Arial}.dot{width:8px;height:8px;border-radius:4px;background:#22c55e}p{margin:0}</style>${rows}`;
  const t0 = Date.now();
  const { ir } = await run(page, html, 1440);
  const ms = Date.now() - t0;
  const n = all(ir.root).length;
  console.log(`large page: ${n} IR nodes in ${ms}ms`);
  expect(n).toBeGreaterThan(2000);
  expect(ms).toBeLessThan(5000);
});
