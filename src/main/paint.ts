import type { Paint as IRPaint, RGBA, Shadow } from "../shared/ir";

const rgb = (c: RGBA): RGB => ({ r: c.r, g: c.g, b: c.b });

/**
 * Figma's gradientTransform maps node space (0–1) to gradient space, where the
 * gradient runs along u from 0 to 1. CSS defines u as the projection (in px) of
 * a point onto the gradient line, whose length makes the corners hit 0 and 1.
 */
export function linearTransform(angleDeg: number, w: number, h: number): Transform {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  const sx = w / 2 - (dx * len) / 2;
  const sy = h / 2 - (dy * len) / 2;
  // u = ((x·w − sx)·dx + (y·h − sy)·dy) / len
  const a = (w * dx) / len;
  const b = (h * dy) / len;
  const c = -(sx * dx + sy * dy) / len;
  // v only needs to be independent of u; centre it on the node.
  return [
    [a, b, c],
    [-b, a, 0.5 - (a - b) / 2],
  ];
}

// CSS default radial is "ellipse farthest-corner": radius reaches the corners (√2 × half-size).
const K = 1 / Math.SQRT2;
const RADIAL: Transform = [
  [K, 0, 0.5 - 0.5 * K],
  [0, K, 0.5 - 0.5 * K],
];

const PLACEHOLDER: SolidPaint = { type: "SOLID", color: { r: 0.85, g: 0.86, b: 0.88 } };

export function toFigmaPaint(p: IRPaint, w: number, h: number, imageHash: (id: string) => string | null): Paint | null {
  switch (p.type) {
    case "solid":
      return { type: "SOLID", color: rgb(p.color), opacity: p.color.a };
    case "linear":
    case "radial":
      return {
        type: p.type === "linear" ? "GRADIENT_LINEAR" : "GRADIENT_RADIAL",
        gradientTransform: p.type === "linear" ? linearTransform(p.angle, Math.max(w, 1), Math.max(h, 1)) : RADIAL,
        gradientStops: p.stops.map((s) => ({ position: s.position, color: { ...rgb(s.color), a: s.color.a } })),
      };
    case "image": {
      const hash = imageHash(p.imageId);
      if (!hash) return PLACEHOLDER;
      return { type: "IMAGE", imageHash: hash, scaleMode: p.scaleMode };
    }
    case "placeholder":
      return PLACEHOLDER;
  }
}

export function toEffect(s: Shadow): Effect {
  return {
    type: s.inset ? "INNER_SHADOW" : "DROP_SHADOW",
    color: { ...rgb(s.color), a: s.color.a },
    offset: { x: s.x, y: s.y },
    radius: s.blur,
    spread: s.spread,
    visible: true,
    blendMode: "NORMAL",
    ...(s.inset ? {} : { showShadowBehindNode: false }),
  } as Effect;
}
