import { htmlToIR } from "../src/ui/extract";
import { prepareHtml } from "../src/ui/prepare";
import { irToHtml } from "./preview";

(window as unknown as { h2d: unknown }).h2d = {
  /** Returns the IR (images stripped for JSON) and a re-rendered preview of it. */
  run: async (html: string, w: number, h: number) => {
    const doc = await htmlToIR(prepareHtml(html, "", new Map()), w, h);
    const preview = irToHtml(doc);
    const imageSizes = Object.fromEntries(Object.entries(doc.images).map(([k, v]) => [k, v.length]));
    return { ir: { ...doc, images: imageSizes }, preview };
  },
};
