import type { RGBA } from "../../shared/ir";
import type { ExtractContext } from "./context";

// Presentation properties that CSS classes commonly set on SVG and that
// figma.createNodeFromSvg can only read as attributes, with their initial values.
// Color props come last so the alpha they carry overrides the plain *-opacity values.
const INHERITED: Record<string, string> = {
  "stroke-width": "1px",
  "stroke-linecap": "butt",
  "stroke-linejoin": "miter",
  "fill-opacity": "1",
  "stroke-opacity": "1",
  "fill-rule": "nonzero",
  fill: "rgb(0, 0, 0)",
  stroke: "none",
};
const OWN: Record<string, string> = { opacity: "1", "stop-opacity": "1", "stop-color": "rgb(0, 0, 0)" };
const PROPS = [...Object.keys(OWN), ...Object.keys(INHERITED)].sort((a, b) => colorLast(a) - colorLast(b));
function colorLast(p: string) {
  return p === "fill" || p === "stroke" || p === "stop-color" ? 1 : 0;
}

function toHex(c: RGBA): string {
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Serializes an inline <svg> with computed styles baked in as attributes. */
export function serializeSvg(svg: SVGSVGElement, ctx: ExtractContext): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = [svg, ...svg.querySelectorAll("*")];
  const dst = [clone, ...clone.querySelectorAll("*")];

  src.forEach((el, i) => {
    const target = dst[i];
    const cs = ctx.win.getComputedStyle(el);
    const parentCs = el === svg ? null : ctx.win.getComputedStyle(el.parentElement!);
    for (const prop of PROPS) {
      let v = cs.getPropertyValue(prop);
      if (!v) continue;
      // Skip values the attribute would produce anyway: inherited from the parent, or the initial value.
      if (prop in INHERITED ? v === (parentCs ? parentCs.getPropertyValue(prop) : INHERITED[prop]) : v === OWN[prop]) continue;
      if (prop === "stroke-width") v = String(parseFloat(v));
      const isColor = prop === "fill" || prop === "stroke" || prop === "stop-color";
      const c = isColor && v !== "none" ? ctx.maybeColor(v) : null;
      if (!c) {
        target.setAttribute(prop, v);
        continue;
      }
      target.setAttribute(prop, toHex(c));
      // Hex drops alpha; carry it via the matching *-opacity attribute.
      if (c.a < 1) target.setAttribute(prop === "stop-color" ? "stop-opacity" : `${prop}-opacity`, String(c.a));
    }
    target.removeAttribute("class");
    target.removeAttribute("style");
  });

  const r = svg.getBoundingClientRect();
  clone.setAttribute("width", String(r.width));
  clone.setAttribute("height", String(r.height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (clone.querySelector("use[href^='#'], use[*|href^='#']") && !clone.querySelector("symbol, defs")) {
    ctx.unsupported.add("<use> referencing an external SVG sprite");
  }
  return new XMLSerializer().serializeToString(clone);
}
