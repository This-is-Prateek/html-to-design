import type { Borders, Paint, Radii, RGBA, Shadow } from "../../shared/ir";
import { isVisible } from "./color";
import { ExtractContext, px } from "./context";
import { gradientLength, parseGradient, splitTopLevel } from "./gradient";
import { loadImagePaint } from "./image";

export interface BoxStyle {
  fills: Paint[];
  borders: Borders | null;
  radii: Radii | null;
  shadows: Shadow[];
  clip: boolean;
}

export function hasVisual(b: BoxStyle): boolean {
  return b.fills.length > 0 || !!b.borders || b.shadows.length > 0 || b.clip;
}

/** Parses a computed box-shadow list. Computed form puts the color first. */
export function parseShadows(value: string, resolve: (css: string) => RGBA | null): Shadow[] {
  if (!value || value === "none") return [];
  const out: Shadow[] = [];
  for (const layer of splitTopLevel(value)) {
    let rest = layer;
    const inset = /\binset\b/.test(rest);
    rest = rest.replace(/\binset\b/, "").trim();
    const colorMatch = rest.match(/^((?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)|#[0-9a-f]+|[a-z]+)\s*/i);
    let color: RGBA | null = null;
    if (colorMatch && !/^-?[\d.]/.test(colorMatch[1])) {
      color = resolve(colorMatch[1]);
      rest = rest.slice(colorMatch[0].length);
    } else {
      // Color may trail the lengths.
      const tail = rest.match(/\s((?:rgba?|hsla?|color|oklch|oklab|lab|lch)\([^)]*\)|#[0-9a-f]+|[a-z]+)$/i);
      if (tail) {
        color = resolve(tail[1]);
        rest = rest.slice(0, tail.index);
      }
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = rest.trim().split(/\s+/).map((t) => parseFloat(t) || 0);
    if (!isVisible(color)) continue;
    out.push({ inset, x, y, blur, spread, color: color! });
  }
  return out;
}

function radius(value: string, w: number): number {
  // Computed radii can be "10px", "50%" or elliptical "10px 20px"; Figma only supports circular corners.
  const first = value.trim().split(/\s+/)[0];
  if (first.endsWith("%")) return (parseFloat(first) / 100) * w;
  return px(first);
}

const BORDER_OFF = new Set(["none", "hidden"]);

export function boxStyle(el: Element, cs: CSSStyleDeclaration, w: number, h: number, ctx: ExtractContext): BoxStyle {
  const fills: Paint[] = [];

  const bg = ctx.color(cs.backgroundColor);
  if (isVisible(bg)) fills.push({ type: "solid", color: bg });

  // CSS lists background layers top-first; Figma paints the last fill on top.
  const layers = cs.backgroundImage && cs.backgroundImage !== "none" ? splitTopLevel(cs.backgroundImage) : [];
  for (const layer of layers.reverse()) {
    const url = layer.match(/^url\(["']?(.*?)["']?\)$/);
    if (url) {
      fills.push(loadImagePaint(url[1], backgroundScale(cs.backgroundSize), ctx));
      continue;
    }
    const probe = parseGradient(layer, (c) => ctx.maybeColor(c), 0);
    if (!probe) {
      ctx.unsupported.add(`background-image: ${layer.split("(")[0]}`);
      continue;
    }
    const len = probe.type === "linear" ? gradientLength(probe.angle, w, h) : Math.max(w, h);
    const g = parseGradient(layer, (c) => ctx.maybeColor(c), len)!;
    if (layer.startsWith("repeating-") || layer.startsWith("conic")) ctx.unsupported.add(`${layer.split("(")[0]} (approximated)`);
    fills.push(g);
  }

  // Gradient text: painting the gradient on the box would cover the text, so drop it.
  const bgClip = (cs as unknown as Record<string, string>).webkitBackgroundClip || cs.backgroundClip;
  if (bgClip === "text") fills.length = 0;

  const sides = ["Top", "Right", "Bottom", "Left"] as const;
  const widths = sides.map((s) =>
    BORDER_OFF.has(cs.getPropertyValue(`border-${s.toLowerCase()}-style`)) ? 0 : px(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)),
  );
  let borders: Borders | null = null;
  const firstSide = widths.findIndex((wd) => wd > 0);
  if (firstSide >= 0) {
    const color = ctx.color(cs.getPropertyValue(`border-${sides[firstSide].toLowerCase()}-color`));
    if (isVisible(color)) borders = { top: widths[0], right: widths[1], bottom: widths[2], left: widths[3], color };
  }

  const r = {
    tl: radius(cs.borderTopLeftRadius, w),
    tr: radius(cs.borderTopRightRadius, w),
    br: radius(cs.borderBottomRightRadius, w),
    bl: radius(cs.borderBottomLeftRadius, w),
  };
  const radii = r.tl || r.tr || r.br || r.bl ? r : null;

  const shadows = parseShadows(cs.boxShadow, (c) => ctx.maybeColor(c));
  const clip = cs.overflowX !== "visible" || cs.overflowY !== "visible";

  noteUnsupported(el, cs, ctx);
  return { fills, borders, radii, shadows, clip };
}

function backgroundScale(size: string): "FILL" | "FIT" | "CROP" | "TILE" {
  if (size.includes("contain")) return "FIT";
  return "FILL";
}

function noteUnsupported(el: Element, cs: CSSStyleDeclaration, ctx: ExtractContext) {
  const s = cs as unknown as Record<string, string>;
  if (cs.transform && cs.transform !== "none" && !/^matrix\(1, 0, 0, 1,/.test(cs.transform)) ctx.unsupported.add("transform (rotation/scale flattened)");
  if (cs.filter && cs.filter !== "none") ctx.unsupported.add("filter");
  if (s.backdropFilter && s.backdropFilter !== "none") ctx.unsupported.add("backdrop-filter");
  if (cs.mixBlendMode && cs.mixBlendMode !== "normal") ctx.unsupported.add("mix-blend-mode");
  if (cs.clipPath && cs.clipPath !== "none") ctx.unsupported.add("clip-path");
  if ((s.maskImage && s.maskImage !== "none") || (s.webkitMaskImage && s.webkitMaskImage !== "none")) ctx.unsupported.add("mask");
  if (s.webkitBackgroundClip === "text" || cs.backgroundClip === "text") ctx.unsupported.add("background-clip: text");
  if (el.tagName === "VIDEO" || el.tagName === "IFRAME") ctx.unsupported.add(`<${el.tagName.toLowerCase()}>`);
}
