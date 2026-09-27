import type { IRDocument } from "../../shared/ir";
import { renderHtml } from "../render";
import { ExtractContext } from "./context";
import { extractDocument } from "./walk";

/** Renders HTML at the given viewport and returns its IR. */
export async function htmlToIR(html: string, width: number, height: number): Promise<IRDocument> {
  const { doc, win, dispose } = await renderHtml(html, width, height);
  try {
    return await extractDocument(doc, width, new ExtractContext(win));
  } finally {
    dispose();
  }
}
