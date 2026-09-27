import type { RGBA } from "../../shared/ir";

export const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function channel(token: string, max: number): number {
  token = token.trim();
  if (token === "none") return 0;
  if (token.endsWith("%")) return clamp01(parseFloat(token) / 100);
  return clamp01(parseFloat(token) / max);
}

function alpha(token: string | undefined): number {
  if (token === undefined) return 1;
  token = token.trim();
  if (token.endsWith("%")) return clamp01(parseFloat(token) / 100);
  return clamp01(parseFloat(token));
}

// Splits "a b c / d" or "a, b, c, d" into [a, b, c, d?].
function args(inner: string): string[] {
  if (inner.includes(",")) return inner.split(",").map((s) => s.trim());
  const [main, a] = inner.split("/");
  const parts = main.trim().split(/\s+/);
  if (a !== undefined) parts.push(a.trim());
  return parts;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/**
 * Parses the color syntaxes getComputedStyle returns for sRGB colors.
 * Returns null for anything else (oklch, lab, color(display-p3 …)); callers
 * resolve those through a canvas, see resolveColor in dom.ts.
 */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s || s === "transparent" || s === "none") return { ...TRANSPARENT };

  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 };
  }

  const m = s.match(/^(rgba?|hsla?|color)\((.*)\)$/);
  if (!m) return null;
  const [, fn, inner] = m;

  if (fn === "rgb" || fn === "rgba") {
    const p = args(inner);
    if (p.length < 3) return null;
    return { r: channel(p[0], 255), g: channel(p[1], 255), b: channel(p[2], 255), a: alpha(p[3]) };
  }

  if (fn === "hsl" || fn === "hsla") {
    const p = args(inner);
    if (p.length < 3) return null;
    const [r, g, b] = hslToRgb(parseFloat(p[0]), channel(p[1], 100), channel(p[2], 100));
    return { r, g, b, a: alpha(p[3]) };
  }

  // color(srgb r g b / a) — values are already 0–1.
  const p = args(inner);
  if (p[0] !== "srgb" || p.length < 4) return null;
  return { r: channel(p[1], 1), g: channel(p[2], 1), b: channel(p[3], 1), a: alpha(p[4]) };
}

export const isVisible = (c: RGBA | null): c is RGBA => !!c && c.a > 0.001;
