import type { RGBA } from "../../shared/ir";
import { parseColor, TRANSPARENT } from "./color";

/** Mutable state shared across one extraction pass. */
export class ExtractContext {
  images: Record<string, Uint8Array> = {};
  pending: Promise<void>[] = [];
  unsupported = new Set<string>();
  placeholders = new Set<string>();
  private imageSeq = 0;
  private colorCache = new Map<string, RGBA>();
  private probe: CanvasRenderingContext2D;

  constructor(readonly win: Window) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    this.probe = c.getContext("2d", { willReadFrequently: true })!;
  }

  nextImageId(): string {
    return `img${this.imageSeq++}`;
  }

  /** Resolves any CSS color (including oklch/lab/p3) to sRGB. */
  color(css: string): RGBA {
    const cached = this.colorCache.get(css);
    if (cached) return cached;
    let c = parseColor(css);
    if (!c) c = this.probeColor(css);
    this.colorCache.set(css, c);
    return c;
  }

  /** Same as color() but returns null for strings that are not colors. */
  maybeColor(css: string): RGBA | null {
    if (parseColor(css)) return this.color(css);
    if (!CSS.supports("color", css)) return null;
    return this.color(css);
  }

  // Canvas converts any supported color space to sRGB when painting.
  private probeColor(css: string): RGBA {
    const ctx = this.probe;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    if (a === 0) return { ...TRANSPARENT };
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
  }
}

export const px = (v: string | null | undefined): number => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};
