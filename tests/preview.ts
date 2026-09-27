// Test-only: renders an IR document back to absolutely positioned HTML so it can
// be pixel-diffed against the source page in the same browser.
import type { FrameNode, IRDocument, IRNode, Paint, RGBA } from "../src/shared/ir";

const css = (c: RGBA) => `rgba(${c.r * 255},${c.g * 255},${c.b * 255},${c.a})`;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`);

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function layer(p: Paint, doc: IRDocument): string {
  switch (p.type) {
    case "solid":
      return `linear-gradient(${css(p.color)},${css(p.color)})`;
    case "linear":
      return `linear-gradient(${p.angle}deg,${p.stops.map((s) => `${css(s.color)} ${s.position * 100}%`).join(",")})`;
    case "radial":
      return `radial-gradient(${p.stops.map((s) => `${css(s.color)} ${s.position * 100}%`).join(",")})`;
    case "image": {
      const bytes = doc.images[p.imageId];
      return bytes ? `url(data:image/png;base64,${b64(bytes)}) center/${p.scaleMode === "FIT" ? "contain" : "cover"} no-repeat` : "#d9dbe0";
    }
    case "placeholder":
      return "linear-gradient(#d9dbe0,#d9dbe0)";
  }
}

const fam = (families: string[]) => families.map((f) => (/^[a-z-]+$/.test(f) ? f : `'${f}'`)).join(",");

function node(n: IRNode, doc: IRDocument): string {
  const base = `position:absolute;left:${n.x}px;top:${n.y}px;opacity:${n.opacity};`;
  if (n.kind === "svg") return `<div style="${base}width:${n.w}px;height:${n.h}px;line-height:0">${n.svg}</div>`;
  if (n.kind === "text") {
    const spans = n.runs
      .map((r) => {

        const deco = r.decoration === "UNDERLINE" ? "underline" : r.decoration === "STRIKETHROUGH" ? "line-through" : "none";
        return `<span style="font-family:${fam(r.font.families)};font-weight:${r.font.weight};font-style:${r.font.italic ? "italic" : "normal"};font-size:${r.size}px;line-height:${r.lineHeight ? r.lineHeight + "px" : "normal"};letter-spacing:${r.letterSpacing}px;color:${css(r.color)};text-decoration:${deco}">${esc(n.characters.slice(r.start, r.end))}</span>`;
      })
      .join("");
    const align = n.align === "JUSTIFIED" ? "justify" : n.align.toLowerCase();
    // Match the block's strut to the first run so the preview's line boxes aren't skewed by a default font.
    const r0 = n.runs[0];
    const strut = `font-family:${fam(r0.font.families)};font-size:${r0.size}px;font-weight:${r0.font.weight};`;
    const lh = strut + (r0.lineHeight ? `line-height:${r0.lineHeight}px;` : "");
    if (n.verticalCenter) return `<div style="${base}width:${n.w}px;height:${n.h}px;display:flex;align-items:center;white-space:pre;${lh}">${spans}</div>`;
    if (n.singleLine) {
      const just = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
      return `<div style="${base}width:${n.w}px;display:flex;justify-content:${just};white-space:pre;${lh}"><div>${spans}</div></div>`;
    }
    return `<div style="${base}width:${n.w}px;white-space:pre-wrap;text-align:${align};${lh}">${spans}</div>`;
  }
  return frame(n, doc, base);
}

function frame(n: FrameNode, doc: IRDocument, base: string): string {
  const bg = n.fills.length ? `background:${[...n.fills].reverse().map((p) => layer(p, doc)).join(",")};` : "";
  const b = n.borders;
  const border = b ? `border-style:solid;border-color:${css(b.color)};border-width:${b.top}px ${b.right}px ${b.bottom}px ${b.left}px;` : "";
  const r = n.radii ? `border-radius:${n.radii.tl}px ${n.radii.tr}px ${n.radii.br}px ${n.radii.bl}px;` : "";
  const sh = n.shadows.length
    ? `box-shadow:${n.shadows.map((s) => `${s.inset ? "inset " : ""}${s.x}px ${s.y}px ${s.blur}px ${s.spread}px ${css(s.color)}`).join(",")};`
    : "";
  const clip = n.clip ? "overflow:hidden;" : "";
  // Borders are drawn as an overlay so children keep border-box coordinates, like Figma's INSIDE strokes.
  const overlay = border ? `<div style="position:absolute;inset:0;${border}${r}pointer-events:none;z-index:2147483647"></div>` : "";
  return `<div style="${base}box-sizing:border-box;width:${n.w}px;height:${n.h}px;${bg}${r}${sh}${clip}">${n.children.map((c) => node(c, doc)).join("")}${overlay}</div>`;
}

export function irToHtml(doc: IRDocument): string {
  return `<!doctype html><html><head><style>body{margin:0}*{box-sizing:border-box}</style></head><body>${node(doc.root, doc)}</body></html>`;
}
