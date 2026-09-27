import type { FontSpec, TextNode, TextRun } from "../../shared/ir";
import { isVisible } from "./color";
import { ExtractContext, px } from "./context";

export function fontFamilies(value: string): string[] {
  return value
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function fontSpec(cs: CSSStyleDeclaration): FontSpec {
  return {
    families: fontFamilies(cs.fontFamily),
    weight: parseInt(cs.fontWeight, 10) || 400,
    italic: /italic|oblique/.test(cs.fontStyle),
  };
}

export function textAlign(cs: CSSStyleDeclaration): TextNode["align"] {
  const a = cs.textAlign;
  const rtl = cs.direction === "rtl";
  if (a.includes("center")) return "CENTER";
  if (a === "justify") return "JUSTIFIED";
  if (a.includes("right") || (a === "end" && !rtl) || (a === "start" && rtl)) return "RIGHT";
  return "LEFT";
}

export function lineHeightPx(cs: CSSStyleDeclaration): number | null {
  return cs.lineHeight === "normal" ? null : px(cs.lineHeight);
}

function applyTransform(text: string, transform: string, prev: string): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") {
    return text.replace(/(^|\s)(\p{L})/gu, (m, sp: string, ch: string, offset: number) =>
      offset === 0 && sp === "" && prev && !/\s/.test(prev) ? m : sp + ch.toUpperCase(),
    );
  }
  return text;
}

/** Accumulates characters and styled runs while applying CSS whitespace collapsing. */
export class RunBuilder {
  text = "";
  runs: TextRun[] = [];

  private collapsibleTail(): boolean {
    return this.text === "" || this.text.endsWith(" ") || this.text.endsWith("\n");
  }

  /** Removes trailing collapsible spaces and shortens runs to match. */
  trimEnd() {
    const trimmed = this.text.replace(/ +$/, "");
    const cut = this.text.length - trimmed.length;
    if (!cut) return;
    this.text = trimmed;
    for (const r of this.runs) r.end = Math.min(r.end, trimmed.length);
    this.runs = this.runs.filter((r) => r.end > r.start);
  }

  push(raw: string, whiteSpace: string, style: Omit<TextRun, "start" | "end">, transform = "none") {
    let chunk = raw;
    const preserveSpaces = /^(pre|pre-wrap|break-spaces)$/.test(whiteSpace);
    const preserveNewlines = preserveSpaces || whiteSpace === "pre-line";
    if (!preserveSpaces) {
      chunk = preserveNewlines
        ? chunk.replace(/[ \t\f]+/g, " ").replace(/ ?\n ?/g, "\n")
        : chunk.replace(/[ \t\n\r\f]+/g, " ");
      if (chunk.startsWith(" ") && this.collapsibleTail()) chunk = chunk.slice(1);
    }
    chunk = applyTransform(chunk, transform, this.text.slice(-1));
    if (!chunk) return;
    const start = this.text.length;
    this.text += chunk;
    const last = this.runs[this.runs.length - 1];
    if (last && last.end === start && sameStyle(last, style)) last.end = this.text.length;
    else this.runs.push({ ...style, start, end: this.text.length });
  }

  newline(style: Omit<TextRun, "start" | "end">) {
    this.trimEnd();
    this.push("\n", "pre", style);
  }
}

function sameStyle(a: Omit<TextRun, "start" | "end">, b: Omit<TextRun, "start" | "end">): boolean {
  return (
    a.size === b.size &&
    a.lineHeight === b.lineHeight &&
    a.letterSpacing === b.letterSpacing &&
    a.decoration === b.decoration &&
    a.font.weight === b.font.weight &&
    a.font.italic === b.font.italic &&
    a.font.families.join() === b.font.families.join() &&
    a.color.r === b.color.r &&
    a.color.g === b.color.g &&
    a.color.b === b.color.b &&
    a.color.a === b.color.a
  );
}

/** Text decoration is not inherited but paints through descendants, so walk up to the block container. */
function decoration(el: Element, container: Element, win: Window): TextRun["decoration"] {
  for (let e: Element | null = el; e && e !== container.parentElement; e = e.parentElement) {
    const line = win.getComputedStyle(e).textDecorationLine;
    if (line.includes("underline")) return "UNDERLINE";
    if (line.includes("line-through")) return "STRIKETHROUGH";
  }
  return "NONE";
}

export function runStyle(el: Element, container: Element, ctx: ExtractContext): Omit<TextRun, "start" | "end"> {
  const cs = ctx.win.getComputedStyle(el);
  const fill = ctx.color((cs as unknown as Record<string, string>).webkitTextFillColor || cs.color);
  return {
    font: fontSpec(cs),
    size: px(cs.fontSize),
    lineHeight: lineHeightPx(cs),
    letterSpacing: cs.letterSpacing === "normal" ? 0 : px(cs.letterSpacing),
    color: isVisible(fill) ? fill : ctx.color(cs.color),
    decoration: decoration(el, container, ctx.win),
  };
}

/**
 * Builds one text node from a run of inline-level sibling nodes inside `container`.
 * Returns null when the group renders no characters.
 */
export function textFromInline(nodes: Node[], container: Element, ctx: ExtractContext, name: string): TextNode | null {
  const b = new RunBuilder();
  const win = ctx.win;

  const visit = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const parent = n.parentElement!;
      const cs = win.getComputedStyle(parent);
      b.push((n as Text).data, cs.whiteSpace, runStyle(parent, container, ctx), cs.textTransform);
    } else if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as Element;
      if (el.tagName === "BR") b.newline(runStyle(el.parentElement ?? el, container, ctx));
      else el.childNodes.forEach(visit);
    }
  };
  nodes.forEach(visit);
  b.trimEnd();
  if (!b.text.trim()) return null;

  const range = win.document.createRange();
  range.setStartBefore(nodes[0]);
  range.setEndAfter(nodes[nodes.length - 1]);
  const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
  if (!rects.length) return null;

  const left = Math.min(...rects.map((r) => r.left));
  const right = Math.max(...rects.map((r) => r.right));
  const top = Math.min(...rects.map((r) => r.top));
  const bottom = Math.max(...rects.map((r) => r.bottom));
  const lineTops = new Set(rects.map((r) => Math.round(r.top / 4)));
  const singleLine = lineTops.size <= 1 && !b.text.includes("\n");

  const ccs = win.getComputedStyle(container);
  const align = textAlign(ccs);

  // CSS centres glyphs in the line box (half-leading); Figma does the same, so shift up by half the leading.
  const lh = lineHeightPx(ccs) ?? b.runs[0].lineHeight;
  const firstLine = rects.reduce((a, r) => (r.top < a.top ? r : a));
  const halfLeading = lh ? (lh - firstLine.height) / 2 : 0;

  let x = left;
  let w = right - left;
  if (!singleLine && /^(block|list-item|inline-block|table-cell|flow-root)$/.test(ccs.display)) {
    const cr = container.getBoundingClientRect();
    x = cr.left + px(ccs.borderLeftWidth) + px(ccs.paddingLeft);
    w = cr.width - px(ccs.borderLeftWidth) - px(ccs.paddingLeft) - px(ccs.borderRightWidth) - px(ccs.paddingRight);
  }

  return {
    kind: "text",
    name,
    x: x + win.scrollX,
    y: top - halfLeading + win.scrollY,
    w,
    h: bottom - top + 2 * halfLeading,
    opacity: 1,
    characters: b.text,
    align,
    singleLine,
    runs: b.runs,
  };
}
