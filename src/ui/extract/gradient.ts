import type { GradientStop, Paint, RGBA } from "../../shared/ir";

/** Splits on commas that are not inside parentheses. */
export function splitTopLevel(input: string, sep = ","): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const SIDE_ANGLES: Record<string, number> = {
  "to top": 0,
  "to right": 90,
  "to bottom": 180,
  "to left": 270,
  "to top right": 45,
  "to right top": 45,
  "to bottom right": 135,
  "to right bottom": 135,
  "to bottom left": 225,
  "to left bottom": 225,
  "to top left": 315,
  "to left top": 315,
};

function parseAngle(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t in SIDE_ANGLES) return SIDE_ANGLES[t];
  const m = t.match(/^(-?[\d.]+)(deg|rad|turn|grad)$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case "rad":
      return (v * 180) / Math.PI;
    case "turn":
      return v * 360;
    case "grad":
      return v * 0.9;
    default:
      return v;
  }
}

/** Separates "rgb(1, 2, 3) 40%" into color and optional position tokens. */
function splitStop(stop: string): { color: string; positions: string[] } {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of stop) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === " " && depth === 0) {
      if (cur) parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  // Color is either first or last token (CSS allows both orders).
  const isPos = (p: string) => /^-?[\d.]+(%|px)?$/.test(p);
  const color = parts.find((p) => !isPos(p)) ?? "transparent";
  return { color, positions: parts.filter(isPos) };
}

function toFraction(pos: string, length: number): number {
  if (pos.endsWith("%")) return parseFloat(pos) / 100;
  return length > 0 ? parseFloat(pos) / length : 0;
}

/**
 * Parses one computed background-image layer. `length` is the gradient line
 * length in px, used to convert px stop positions to fractions.
 */
export function parseGradient(
  layer: string,
  resolve: (css: string) => RGBA | null,
  length: number,
): Paint | null {
  const m = layer.trim().match(/^(repeating-)?(linear|radial|conic)-gradient\((.*)\)$/s);
  if (!m) return null;
  const kind = m[2];
  const parts = splitTopLevel(m[3]);

  let angle = 180;
  if (kind === "linear") {
    const a = parseAngle(parts[0]);
    if (a !== null) {
      angle = a;
      parts.shift();
    }
  } else if (parts.length && !resolve(splitStop(parts[0]).color)) {
    // Radial/conic shape/position prelude, e.g. "circle at center".
    parts.shift();
  }

  const raw: { color: RGBA; pos: number | null }[] = [];
  for (const p of parts) {
    const { color, positions } = splitStop(p);
    const c = resolve(color);
    if (!c) continue;
    if (positions.length === 0) raw.push({ color: c, pos: null });
    for (const pos of positions) raw.push({ color: c, pos: toFraction(pos, length) });
  }
  if (raw.length < 2) return null;

  // Fill missing positions: first=0, last=1, others spread evenly between known neighbours.
  if (raw[0].pos === null) raw[0].pos = 0;
  if (raw[raw.length - 1].pos === null) raw[raw.length - 1].pos = 1;
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].pos !== null) continue;
    let j = i;
    while (raw[j].pos === null) j++;
    const a = raw[i - 1].pos!;
    const b = raw[j].pos!;
    for (let k = i; k < j; k++) raw[k].pos = a + ((b - a) * (k - i + 1)) / (j - i + 1);
  }
  // Positions must be non-decreasing.
  let last = 0;
  const stops: GradientStop[] = raw.map((s) => {
    last = Math.max(last, Math.min(1, Math.max(0, s.pos!)));
    return { color: s.color, position: last };
  });

  return kind === "linear" ? { type: "linear", angle, stops } : { type: "radial", stops };
}

/** Length of the CSS gradient line for an angle across a w×h box. */
export function gradientLength(angleDeg: number, w: number, h: number): number {
  const a = (angleDeg * Math.PI) / 180;
  return Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
}
