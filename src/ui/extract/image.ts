import type { Paint } from "../../shared/ir";
import type { ExtractContext } from "./context";

const MAX_SIDE = 4096; // Figma's image size limit

type Drawable = HTMLImageElement | HTMLCanvasElement | SVGImageElement;

async function rasterize(source: Drawable, w: number, h: number): Promise<Uint8Array> {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  canvas.getContext("2d")!.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("canvas export failed");
  return new Uint8Array(await blob.arrayBuffer());
}

function placeholder(url: string, ctx: ExtractContext): Paint {
  ctx.placeholders.add(url.length > 120 ? url.slice(0, 117) + "…" : url);
  return { type: "placeholder", label: url };
}

const isLocal = (url: string) => url.startsWith("data:") || url.startsWith("blob:");

/**
 * Returns an image paint immediately and fills in the bytes asynchronously
 * (awaited via ctx.pending). On failure the paint is turned into a placeholder.
 */
export function loadImagePaint(
  url: string,
  scaleMode: "FILL" | "FIT" | "CROP" | "TILE",
  ctx: ExtractContext,
  existing?: HTMLImageElement | HTMLCanvasElement,
): Paint {
  if (!existing && !isLocal(url)) return placeholder(url, ctx);

  const id = ctx.nextImageId();
  const paint: Paint = { type: "image", imageId: id, scaleMode };
  ctx.pending.push(
    (async () => {
      let source: HTMLImageElement | HTMLCanvasElement;
      if (existing) {
        source = existing;
      } else {
        const img = new Image();
        img.src = url;
        await img.decode();
        source = img;
      }
      // Elements may come from the render iframe, so avoid cross-realm instanceof.
      const isImg = source.tagName === "IMG";
      const w = isImg ? (source as HTMLImageElement).naturalWidth : source.width;
      const h = isImg ? (source as HTMLImageElement).naturalHeight : source.height;
      if (!w || !h) throw new Error("empty image");
      ctx.images[id] = await rasterize(source, w, h);
    })().catch(() => {
      Object.assign(paint, placeholder(url || "image", ctx));
    }),
  );
  return paint;
}

export function objectFitScale(fit: string): "FILL" | "FIT" | "CROP" {
  if (fit === "contain" || fit === "scale-down") return "FIT";
  return "FILL"; // cover, fill (stretch) and none all map best to FILL
}
