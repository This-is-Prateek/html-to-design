import type { FontSpec, FontSubstitution } from "../shared/ir";

export interface AvailableFont {
  family: string;
  style: string;
}

interface StyleInfo {
  style: string;
  weight: number;
  italic: boolean;
  extra: number; // count of unrecognised words, e.g. "Condensed", "Display"
}

// Longest keywords first so "extrabold" doesn't match "bold".
const WEIGHT_WORDS: [string, number][] = [
  ["extralight", 200],
  ["ultralight", 200],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["semibold", 600],
  ["demibold", 600],
  ["hairline", 100],
  ["regular", 400],
  ["medium", 500],
  ["normal", 400],
  ["black", 900],
  ["heavy", 900],
  ["light", 300],
  ["thin", 100],
  ["bold", 700],
  ["book", 400],
  ["roman", 400],
];

export function parseStyle(style: string): StyleInfo {
  let s = style.toLowerCase().replace(/[\s_-]+/g, "");
  const italic = /italic|oblique/.test(s);
  s = s.replace(/italic|oblique/g, "");
  let weight = 400;
  for (const [word, w] of WEIGHT_WORDS) {
    if (s.includes(word)) {
      weight = w;
      s = s.replace(word, "");
      break;
    }
  }
  return { style, weight, italic, extra: s.length ? 1 : 0 };
}

const WEIGHT_NAMES: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};

export const describe = (f: FontSpec, family = f.families[0] ?? "(none)") =>
  `${family} ${WEIGHT_NAMES[Math.round(f.weight / 100) * 100] ?? f.weight}${f.italic ? " Italic" : ""}`;

const GENERIC: Record<string, string[]> = {
  "sans-serif": ["Inter", "Roboto", "Arial", "Helvetica"],
  "system-ui": ["Inter", "Roboto", "Arial"],
  "-apple-system": ["Inter", "Roboto"],
  blinkmacsystemfont: ["Inter", "Roboto"],
  "ui-sans-serif": ["Inter", "Roboto"],
  serif: ["Times New Roman", "Georgia", "Noto Serif", "Roboto Serif", "Merriweather", "PT Serif"],
  "ui-serif": ["Georgia", "Times New Roman", "Noto Serif", "Roboto Serif"],
  monospace: ["Roboto Mono", "SF Mono", "Menlo", "Consolas", "Courier New", "Source Code Pro"],
  "ui-monospace": ["Roboto Mono", "SF Mono", "Menlo", "Consolas"],
  cursive: ["Inter"],
  fantasy: ["Inter"],
};

export const FALLBACK: AvailableFont = { family: "Inter", style: "Regular" };

export class FontResolver {
  private families = new Map<string, { family: string; styles: StyleInfo[] }>();
  private cache = new Map<string, AvailableFont>();
  readonly substitutions = new Map<string, FontSubstitution>();

  constructor(fonts: AvailableFont[]) {
    for (const f of fonts) {
      const key = f.family.toLowerCase();
      let entry = this.families.get(key);
      if (!entry) this.families.set(key, (entry = { family: f.family, styles: [] }));
      entry.styles.push(parseStyle(f.style));
    }
  }

  private pickStyle(styles: StyleInfo[], weight: number, italic: boolean): { info: StyleInfo; exact: boolean } {
    let best = styles[0];
    let bestScore = Infinity;
    for (const s of styles) {
      // Italic mismatch dominates, then weight distance; prefer heavier on ties above 400 (CSS matching rule).
      const dist = Math.abs(s.weight - weight) + (weight > 400 && s.weight < weight ? 1 : 0);
      const score = (s.italic !== italic ? 10000 : 0) + dist * 10 + s.extra;
      if (score < bestScore) (best = s), (bestScore = score);
    }
    return { info: best, exact: best.weight === weight && best.italic === italic };
  }

  resolve(spec: FontSpec): AvailableFont {
    const key = `${spec.families.join(",")}|${spec.weight}|${spec.italic}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const isGeneric = (f: string) => f.toLowerCase() in GENERIC;
    const requestedFamily = spec.families.find((f) => !isGeneric(f)) ?? null;
    let result: AvailableFont | null = null;
    let exact = false;

    outer: for (const fam of spec.families) {
      for (const c of GENERIC[fam.toLowerCase()] ?? [fam]) {
        const entry = this.families.get(c.toLowerCase());
        if (!entry) continue;
        const pick = this.pickStyle(entry.styles, spec.weight, spec.italic);
        result = { family: entry.family, style: pick.info.style };
        exact = pick.exact && fam === requestedFamily;
        break outer;
      }
    }
    if (!result) {
      const inter = this.families.get("inter");
      result = inter ? { family: inter.family, style: this.pickStyle(inter.styles, spec.weight, spec.italic).info.style } : FALLBACK;
    }

    // Report when the first named family (the design intent) couldn't be used exactly.
    if (requestedFamily && !exact) {
      const requested = describe(spec, requestedFamily);
      this.substitutions.set(requested, { requested, used: `${result.family} ${result.style}` });
    }
    this.cache.set(key, result);
    return result;
  }
}
