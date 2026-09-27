import type { FrameNode as IRFrame, IRDocument, IRNode, SvgNode as IRSvg, TextNode as IRText } from "../shared/ir";
import { FontResolver } from "./fonts";
import { toEffect, toFigmaPaint } from "./paint";

const MIN = 0.01; // Figma rejects zero-sized nodes

export class Builder {
  private hashes = new Map<string, string>();
  private loaded = new Set<string>();
  count = 0;
  /** Top-level frames created so far, so a cancelled/failed run can be cleaned up. */
  roots: SceneNode[] = [];

  constructor(
    private fonts: FontResolver,
    private onProgress: () => Promise<void>,
  ) {}

  /** Collects every font the documents use, resolves and loads them once. */
  async loadFonts(docs: IRDocument[]) {
    const pending: Promise<void>[] = [];
    const load = (f: FontName) => {
      const key = `${f.family}|${f.style}`;
      if (this.loaded.has(key)) return;
      this.loaded.add(key);
      pending.push(figma.loadFontAsync(f));
    };
    load({ family: "Inter", style: "Regular" });
    const visit = (n: IRNode) => {
      if (n.kind === "text") for (const r of n.runs) load(this.fonts.resolve(r.font));
      if (n.kind === "frame") n.children.forEach(visit);
    };
    docs.forEach((d) => visit(d.root));
    await Promise.all(pending);
  }

  registerImages(doc: IRDocument) {
    for (const [id, bytes] of Object.entries(doc.images)) {
      try {
        this.hashes.set(`${doc.viewport}:${id}`, figma.createImage(bytes).hash);
      } catch {
        // Unsupported/oversized image: the paint falls back to a placeholder.
      }
    }
  }

  async build(node: IRNode, parent: BaseNode & ChildrenMixin, viewport: number): Promise<SceneNode | null> {
    let out: SceneNode | null;
    if (node.kind === "frame") out = await this.frame(node, parent, viewport);
    else if (node.kind === "text") out = this.text(node, parent);
    else out = this.svg(node, parent);
    this.count++;
    if (this.count % 150 === 0) await this.onProgress();
    return out;
  }

  private async frame(n: IRFrame, parent: BaseNode & ChildrenMixin, viewport: number): Promise<FrameNode> {
    const f = figma.createFrame();
    parent.appendChild(f);
    if (parent.type === "PAGE") this.roots.push(f);
    f.name = n.name;
    f.resize(Math.max(n.w, MIN), Math.max(n.h, MIN));
    f.x = n.x;
    f.y = n.y;
    f.opacity = n.opacity;
    f.clipsContent = n.clip;
    f.fills = n.fills
      .map((p) => toFigmaPaint(p, n.w, n.h, (id) => this.hashes.get(`${viewport}:${id}`) ?? null))
      .filter((p): p is Paint => !!p);

    if (n.radii) {
      f.topLeftRadius = n.radii.tl;
      f.topRightRadius = n.radii.tr;
      f.bottomRightRadius = n.radii.br;
      f.bottomLeftRadius = n.radii.bl;
    }
    if (n.borders) {
      const b = n.borders;
      f.strokes = [{ type: "SOLID", color: { r: b.color.r, g: b.color.g, b: b.color.b }, opacity: b.color.a }];
      f.strokeAlign = "INSIDE";
      if (b.top === b.right && b.top === b.bottom && b.top === b.left) f.strokeWeight = b.top;
      else {
        f.strokeTopWeight = b.top;
        f.strokeRightWeight = b.right;
        f.strokeBottomWeight = b.bottom;
        f.strokeLeftWeight = b.left;
      }
    }
    if (n.shadows.length) f.effects = n.shadows.map(toEffect);
    const placeholder = n.fills.find((p) => p.type === "placeholder");
    if (placeholder && placeholder.type === "placeholder") f.name = `image: ${placeholder.label}`.slice(0, 200);

    for (const c of n.children) await this.build(c, f, viewport);
    return f;
  }

  private text(n: IRText, parent: BaseNode & ChildrenMixin): TextNode {
    const t = figma.createText();
    parent.appendChild(t);
    t.name = n.name;
    const first = this.fonts.resolve(n.runs[0].font);
    t.fontName = first;
    t.characters = n.characters;

    for (const r of n.runs) {
      const end = Math.min(r.end, n.characters.length);
      if (end <= r.start) continue;
      t.setRangeFontName(r.start, end, this.fonts.resolve(r.font));
      t.setRangeFontSize(r.start, end, Math.max(1, r.size));
      t.setRangeFills(r.start, end, [{ type: "SOLID", color: { r: r.color.r, g: r.color.g, b: r.color.b }, opacity: r.color.a }]);
      t.setRangeLetterSpacing(r.start, end, { unit: "PIXELS", value: r.letterSpacing });
      t.setRangeLineHeight(r.start, end, r.lineHeight ? { unit: "PIXELS", value: r.lineHeight } : { unit: "AUTO" });
      t.setRangeTextDecoration(r.start, end, r.decoration);
    }

    if (n.verticalCenter) {
      t.textAutoResize = "NONE";
      t.resize(Math.max(n.w, 1), Math.max(n.h, 1));
      t.textAlignHorizontal = n.align;
      t.textAlignVertical = "CENTER";
      t.x = n.x;
      t.y = n.y;
    } else if (n.singleLine) {
      // Auto width never re-wraps; re-anchor by alignment so metric drift spreads the same way the browser's would.
      t.textAutoResize = "WIDTH_AND_HEIGHT";
      t.textAlignHorizontal = "LEFT";
      t.y = n.y;
      if (n.align === "CENTER") t.x = n.x + (n.w - t.width) / 2;
      else if (n.align === "RIGHT") t.x = n.x + n.w - t.width;
      else t.x = n.x;
    } else {
      t.textAutoResize = "HEIGHT";
      t.textAlignHorizontal = n.align;
      const w = fitWidth(t, n);
      // Keep the growth centred/right-anchored the way the alignment would in the browser.
      const dx = w - n.w;
      t.x = n.x - (n.align === "CENTER" ? dx / 2 : n.align === "RIGHT" ? dx : 0);
      t.y = n.y;
    }
    return t;
  }

  private svg(n: IRSvg, parent: BaseNode & ChildrenMixin): SceneNode | null {
    try {
      const s = figma.createNodeFromSvg(n.svg);
      parent.appendChild(s);
      s.name = n.name;
      s.x = n.x;
      s.y = n.y;
      if (Math.abs(s.width - n.w) > 0.5 || Math.abs(s.height - n.h) > 0.5) s.resize(Math.max(n.w, MIN), Math.max(n.h, MIN));
      s.opacity = n.opacity;
      return s;
    } catch {
      return null;
    }
  }
}

/**
 * Figma's glyph metrics differ slightly from Chromium's, which can push a word
 * onto an extra line. Widen the box a few px at a time until the height (line
 * count) matches what the browser produced.
 */
function fitWidth(t: TextNode, n: IRText): number {
  let w = Math.max(n.w, 1);
  t.resize(w, Math.max(n.h, 1));
  const lineH = n.runs[0].lineHeight ?? n.runs[0].size * 1.2;
  const limit = w + Math.max(4, w * 0.04);
  while (t.height > n.h + lineH / 2 && w < limit) {
    w += 1;
    t.resize(w, t.height);
  }
  return w;
}

export function countNodes(n: IRNode): number {
  return 1 + (n.kind === "frame" ? n.children.reduce((a, c) => a + countNodes(c), 0) : 0);
}
