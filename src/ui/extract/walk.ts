import type { FrameNode, IRDocument, IRNode, Paint, TextNode } from "../../shared/ir";
import { isVisible } from "./color";
import { ExtractContext, px } from "./context";
import { loadImagePaint, objectFitScale } from "./image";
import { boxStyle, hasVisual } from "./style";
import { fontSpec, lineHeightPx, runStyle, textAlign, textFromInline } from "./text";
import { serializeSvg } from "./svg";

const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "HEAD", "META", "LINK", "TITLE", "BASE"]);
const REPLACED = new Set(["IMG", "SVG", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "VIDEO", "CANVAS", "IFRAME", "OBJECT", "EMBED", "PICTURE"]);

export function layerName(el: Element): string {
  let name = el.tagName.toLowerCase();
  if (el.id) name += `#${el.id}`;
  const cls = [...el.classList].slice(0, 3);
  if (cls.length) name += "." + cls.join(".");
  return name.length > 60 ? name.slice(0, 59) + "…" : name;
}

class Walker {
  private inlineCache = new Map<Element, boolean>();

  constructor(private ctx: ExtractContext) {}

  private cs(el: Element) {
    return this.ctx.win.getComputedStyle(el);
  }

  /** Page-space rect (the iframe never scrolls, but be safe). */
  private rect(el: Element | Range) {
    const r = el.getBoundingClientRect();
    return { x: r.left + this.ctx.win.scrollX, y: r.top + this.ctx.win.scrollY, w: r.width, h: r.height };
  }

  /** True when the node can be merged into a text run: text, <br>, or undecorated inline elements. */
  private isInlineFlow(n: Node): boolean {
    if (n.nodeType === Node.TEXT_NODE) return true;
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    const el = n as Element;
    if (el.tagName === "BR") return true;
    if (SKIP.has(el.tagName) || REPLACED.has(el.tagName.toUpperCase())) return false;
    const cached = this.inlineCache.get(el);
    if (cached !== undefined) return cached;
    const cs = this.cs(el);
    // Horizontal margin/padding on inline elements adds space a text layer can't represent.
    const spaced = px(cs.marginLeft) || px(cs.marginRight) || px(cs.paddingLeft) || px(cs.paddingRight);
    let ok = cs.display === "inline" && !spaced && !hasVisual(boxStyle(el, cs, 0, 0, this.ctx)) && parseFloat(cs.opacity) === 1;
    if (ok) ok = [...el.childNodes].every((c) => this.isInlineFlow(c) || c.nodeType === Node.COMMENT_NODE);
    this.inlineCache.set(el, ok);
    return ok;
  }

  children(container: Element): IRNode[] {
    const out: { node: IRNode; z: number }[] = [];
    let group: Node[] = [];
    const flush = () => {
      if (!group.length) return;
      const t = textFromInline(group, container, this.ctx, "text");
      if (t) out.push({ node: t, z: 0 });
      group = [];
    };
    for (const n of container.childNodes) {
      if (n.nodeType === Node.COMMENT_NODE) continue;
      if (this.isInlineFlow(n)) {
        group.push(n);
        continue;
      }
      flush();
      if (n.nodeType !== Node.ELEMENT_NODE) continue;
      const el = n as Element;
      const z = stackKey(this.cs(el), this.cs(container));
      for (const node of this.element(el)) out.push({ node, z });
    }
    flush();
    // Stable sort by paint layer approximates CSS stacking among siblings.
    return out
      .map((o, i) => ({ ...o, i }))
      .sort((a, b) => a.z - b.z || a.i - b.i)
      .map((o) => o.node);
  }

  element(el: Element): IRNode[] {
    if (SKIP.has(el.tagName.toUpperCase())) return [];
    const cs = this.cs(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return [];
    const opacity = parseFloat(cs.opacity);
    if (opacity === 0) return [];
    if (cs.display === "contents") return this.children(el);

    const r = this.rect(el);
    const name = layerName(el);
    const tag = el.tagName.toUpperCase();

    if (tag === "SVG") {
      if (!r.w || !r.h) return [];
      return [{ kind: "svg", name, ...r, opacity, svg: serializeSvg(el as SVGSVGElement, this.ctx) }];
    }

    const box = boxStyle(el, cs, r.w, r.h, this.ctx);
    const frame: FrameNode = { kind: "frame", name, ...r, opacity, ...box, children: [] };

    if (tag === "IMG" || tag === "CANVAS" || tag === "VIDEO") {
      frame.fills.push(this.mediaPaint(el, cs));
      return [frame];
    }
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      this.formControl(el as HTMLInputElement, cs, frame);
      return [frame];
    }

    if (tag === "LI") this.listMarker(el, cs, frame);
    frame.children.push(...this.children(el));

    const visual = hasVisual(box) || opacity < 1;
    if (!visual) {
      // Invisible wrappers with no size would become 0×0 frames: lift their children instead.
      if (r.w < 0.5 || r.h < 0.5) return frame.children;
      // A plain text block (<p>, <h1>…) becomes a single named text layer.
      if (frame.children.length === 1 && frame.children[0].kind === "text") {
        frame.children[0].name = name;
        return frame.children;
      }
    }
    return [frame];
  }

  private mediaPaint(el: Element, cs: CSSStyleDeclaration): Paint {
    const scale = objectFitScale(cs.objectFit);
    if (el.tagName.toUpperCase() === "CANVAS") return loadImagePaint("canvas", scale, this.ctx, el as HTMLCanvasElement);
    if (el.tagName.toUpperCase() === "VIDEO") {
      const poster = (el as HTMLVideoElement).poster;
      return loadImagePaint(poster || "video", scale, this.ctx);
    }
    const img = el as HTMLImageElement;
    const src = img.currentSrc || img.src;
    if (img.complete && img.naturalWidth > 0) return loadImagePaint(src, scale, this.ctx, img);
    return loadImagePaint(src || img.alt || "image", scale, this.ctx);
  }

  private formControl(el: HTMLInputElement, cs: CSSStyleDeclaration, frame: FrameNode) {
    const tag = el.tagName.toUpperCase();
    const type = tag === "INPUT" ? (el.type || "text").toLowerCase() : tag.toLowerCase();
    if (type === "hidden") return;

    if (type === "checkbox" || type === "radio") {
      if (cs.appearance !== "none") {
        const accent = cs.accentColor === "auto" ? { r: 0, g: 0.459, b: 1, a: 1 } : this.ctx.color(cs.accentColor);
        const on = el.checked;
        frame.fills = [{ type: "solid", color: on ? accent : { r: 1, g: 1, b: 1, a: 1 } }];
        frame.borders = on ? null : { top: 1, right: 1, bottom: 1, left: 1, color: { r: 0.46, g: 0.46, b: 0.46, a: 1 } };
        const rad = type === "radio" ? frame.w / 2 : 2;
        frame.radii = { tl: rad, tr: rad, br: rad, bl: rad };
        if (on && type === "checkbox") {
          const s = frame.w;
          frame.children.push({
            kind: "svg",
            name: "check",
            x: frame.x,
            y: frame.y,
            w: s,
            h: s,
            opacity: 1,
            svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
          });
        } else if (on) {
          const d = frame.w * 0.4;
          frame.children.push({
            kind: "frame",
            name: "dot",
            x: frame.x + (frame.w - d) / 2,
            y: frame.y + (frame.h - d) / 2,
            w: d,
            h: d,
            opacity: 1,
            fills: [{ type: "solid", color: { r: 1, g: 1, b: 1, a: 1 } }],
            borders: null,
            radii: { tl: d / 2, tr: d / 2, br: d / 2, bl: d / 2 },
            shadows: [],
            clip: false,
            children: [],
          });
        }
      }
      return;
    }
    if (["range", "color", "file", "image"].includes(type)) {
      this.ctx.unsupported.add(`<input type="${type}">`);
      return;
    }

    let text = "";
    let placeholder = false;
    if (tag === "SELECT") {
      const sel = el as unknown as HTMLSelectElement;
      text = sel.selectedOptions[0]?.text ?? "";
    } else {
      text = el.value;
      if (type === "password") text = "•".repeat(text.length);
      if (!text && el.placeholder) {
        text = el.placeholder;
        placeholder = true;
      }
    }
    if (!text) return;

    const style = runStyle(el, el, this.ctx);
    if (placeholder) {
      const pc = this.ctx.color(this.ctx.win.getComputedStyle(el, "::placeholder").color);
      if (isVisible(pc)) style.color = pc;
    }
    style.decoration = "NONE";
    const left = px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const top = px(cs.borderTopWidth) + px(cs.paddingTop);
    const w = frame.w - left - px(cs.borderRightWidth) - px(cs.paddingRight);
    const h = frame.h - top - px(cs.borderBottomWidth) - px(cs.paddingBottom);
    const multi = tag === "TEXTAREA";
    frame.children.push({
      kind: "text",
      name: placeholder ? "placeholder" : "value",
      x: frame.x + left,
      y: frame.y + top,
      w: Math.max(1, w),
      h: Math.max(1, h),
      opacity: 1,
      characters: text,
      align: textAlign(cs),
      singleLine: !multi,
      verticalCenter: !multi,
      runs: [{ ...style, start: 0, end: text.length }],
    });
  }

  /** ::marker isn't reachable through the CSSOM, so synthesize bullets/numbers for outside markers. */
  private listMarker(el: Element, cs: CSSStyleDeclaration, frame: FrameNode) {
    if (cs.display !== "list-item" || cs.listStyleType === "none" || cs.listStyleImage !== "none") return;
    if (cs.listStylePosition === "inside") return; // inside markers render inline; rare, skipped
    const list = el.parentElement;
    let index = 1;
    if (list?.tagName === "OL") index = (parseInt(list.getAttribute("start") ?? "1", 10) || 1) + [...list.children].filter((c) => c.tagName === "LI").indexOf(el);
    const marker = markerText(cs.listStyleType, index);
    if (!marker) return;
    const mcs = this.ctx.win.getComputedStyle(el, "::marker");
    const style = runStyle(el, el, this.ctx);
    const mColor = this.ctx.color(mcs.color);
    if (isVisible(mColor)) style.color = mColor;
    style.decoration = "NONE";
    style.font = fontSpec(mcs.fontFamily ? mcs : cs);
    const contentLeft = frame.x + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const lh = lineHeightPx(cs);
    const text: TextNode = {
      kind: "text",
      name: "marker",
      x: contentLeft - 1, // right edge anchor (singleLine + RIGHT)
      y: frame.y + px(cs.borderTopWidth) + px(cs.paddingTop),
      w: 1,
      h: lh ?? style.size * 1.2,
      opacity: 1,
      characters: marker,
      align: "RIGHT",
      singleLine: true,
      runs: [{ ...style, start: 0, end: marker.length }],
    };
    frame.children.push(text);
    frame.clip = false;
  }
}

export function markerText(type: string, i: number): string | null {
  switch (type) {
    case "disc":
      return "•  ";
    case "circle":
      return "◦  ";
    case "square":
      return "▪  ";
    case "decimal":
      return `${i}. `;
    case "decimal-leading-zero":
      return `${String(i).padStart(2, "0")}. `;
    case "lower-alpha":
    case "lower-latin":
      return `${String.fromCharCode(96 + ((i - 1) % 26) + 1)}. `;
    case "upper-alpha":
    case "upper-latin":
      return `${String.fromCharCode(64 + ((i - 1) % 26) + 1)}. `;
    case "lower-roman":
      return `${roman(i).toLowerCase()}. `;
    case "upper-roman":
      return `${roman(i)}. `;
    default:
      return "•  ";
  }
}

function roman(n: number): string {
  const map: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) (out += s), (n -= v);
  return out;
}

/** Paint-order key among siblings: negative z < in-flow < positioned/auto < positive z. */
function stackKey(cs: CSSStyleDeclaration, parent: CSSStyleDeclaration): number {
  const positioned = cs.position !== "static";
  const flexItem = /flex|grid/.test(parent.display);
  const z = cs.zIndex === "auto" ? null : parseInt(cs.zIndex, 10);
  if ((positioned || flexItem) && z !== null) return z < 0 ? z - 1 : z === 0 ? 1 : 1 + z;
  return positioned ? 1 : 0;
}

/** Converts page-space coordinates to parent-relative, as Figma expects. */
function relativize(node: IRNode, ox: number, oy: number) {
  const ax = node.x;
  const ay = node.y;
  node.x = ax - ox;
  node.y = ay - oy;
  if (node.kind === "frame") for (const c of node.children) relativize(c, ax, ay);
}

export async function extractDocument(doc: Document, viewport: number, ctx: ExtractContext): Promise<IRDocument> {
  const win = ctx.win;
  const html = doc.documentElement;
  const body = doc.body;
  const walker = new Walker(ctx);

  // CSS propagates the root (or body) background to the whole canvas.
  let canvas = ctx.color(win.getComputedStyle(html).backgroundColor);
  let bodyPropagated = false;
  if (!isVisible(canvas)) {
    canvas = ctx.color(win.getComputedStyle(body).backgroundColor);
    bodyPropagated = true;
  }
  if (!isVisible(canvas)) canvas = { r: 1, g: 1, b: 1, a: 1 };

  const height = Math.max(html.scrollHeight, body.scrollHeight, win.innerHeight);
  const root: FrameNode = {
    kind: "frame",
    name: doc.title || "HTML import",
    x: 0,
    y: 0,
    w: viewport,
    h: height,
    opacity: 1,
    fills: [{ type: "solid", color: canvas }],
    borders: null,
    radii: null,
    shadows: [],
    clip: true,
    children: walker.element(body),
  };

  if (bodyPropagated) {
    const bodyNode = root.children.find((c) => c.kind === "frame" && c.name.startsWith("body"));
    if (bodyNode?.kind === "frame") bodyNode.fills = bodyNode.fills.filter((f) => f.type !== "solid");
  }

  for (const link of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    ctx.unsupported.add(`remote stylesheet not loaded: ${link.getAttribute("href")}`);
  }

  await Promise.all(ctx.pending);
  for (const c of root.children) relativize(c, 0, 0);

  return {
    title: root.name,
    viewport,
    root,
    images: ctx.images,
    unsupported: [...ctx.unsupported],
    placeholders: [...ctx.placeholders],
  };
}
