// Intermediate representation passed from the UI (extractor) to the main thread (builder).
// All colors are 0–1 channels. All geometry is in CSS px, relative to the parent IR node.

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface GradientStop {
  color: RGBA;
  position: number; // 0–1
}

export type Paint =
  | { type: "solid"; color: RGBA }
  | { type: "linear"; angle: number; stops: GradientStop[] } // CSS angle in degrees
  | { type: "radial"; stops: GradientStop[] }
  | { type: "image"; imageId: string; scaleMode: "FILL" | "FIT" | "CROP" | "TILE" }
  | { type: "placeholder"; label: string };

export interface Shadow {
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: RGBA;
}

export interface Borders {
  top: number;
  right: number;
  bottom: number;
  left: number;
  color: RGBA; // Figma supports one stroke paint per node; we use the first visible side's color.
}

export interface Radii {
  tl: number;
  tr: number;
  br: number;
  bl: number;
}

interface BaseNode {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
}

export interface FrameNode extends BaseNode {
  kind: "frame";
  fills: Paint[];
  borders: Borders | null;
  radii: Radii | null;
  shadows: Shadow[];
  clip: boolean;
  children: IRNode[];
}

export interface FontSpec {
  families: string[]; // CSS font-family stack, unquoted, in order
  weight: number;
  italic: boolean;
}

export interface TextRun {
  start: number;
  end: number; // exclusive
  font: FontSpec;
  size: number;
  lineHeight: number | null; // px, null = normal
  letterSpacing: number; // px
  color: RGBA;
  decoration: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
}

export interface TextNode extends BaseNode {
  kind: "text";
  characters: string;
  align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  singleLine: boolean;
  /** Fixed-size box with text centered vertically (form controls). */
  verticalCenter?: boolean;
  runs: TextRun[];
}

export interface SvgNode extends BaseNode {
  kind: "svg";
  svg: string;
}

export type IRNode = FrameNode | TextNode | SvgNode;

export interface IRDocument {
  title: string;
  viewport: number;
  root: FrameNode;
  images: Record<string, Uint8Array>; // imageId → PNG bytes
  unsupported: string[]; // CSS features we skipped, deduped
  placeholders: string[]; // image URLs we could not load
}

// ---- messages ----

export type UIToMain =
  | { type: "build"; docs: IRDocument[] }
  | { type: "cancel" };

export interface FontSubstitution {
  requested: string;
  used: string;
}

export type MainToUI =
  | { type: "progress"; done: number; total: number }
  | {
      type: "done";
      nodes: number;
      substitutions: FontSubstitution[];
      placeholders: string[];
      unsupported: string[];
    }
  | { type: "error"; message: string };
