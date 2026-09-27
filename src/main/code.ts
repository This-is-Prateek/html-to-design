import type { MainToUI, UIToMain } from "../shared/ir";
import { Builder, countNodes } from "./build";
import { FontResolver } from "./fonts";

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

const post = (msg: MainToUI) => figma.ui.postMessage(msg);
const tick = () => new Promise<void>((res) => setTimeout(res, 0));

let cancelled = false;

figma.ui.onmessage = async (msg: UIToMain) => {
  if (msg.type === "cancel") {
    cancelled = true;
    return;
  }
  if (msg.type !== "build") return;
  cancelled = false;
  let builder: Builder | null = null;

  try {
    const fonts = new FontResolver(await figma.listAvailableFontsAsync().then((l) => l.map((f) => f.fontName)));
    const total = msg.docs.reduce((a, d) => a + countNodes(d.root), 0);
    const b = (builder = new Builder(fonts, async () => {
      if (cancelled) throw new Error("Cancelled");
      post({ type: "progress", done: b.count, total });
      await tick();
    }));

    await builder.loadFonts(msg.docs);

    const created: FrameNode[] = [];
    const center = figma.viewport.center;
    let x = Math.round(center.x);
    const y = Math.round(center.y);
    for (const doc of msg.docs) {
      builder.registerImages(doc);
      const frame = (await builder.build({ ...doc.root, name: `${doc.title} — ${doc.viewport}` }, figma.currentPage, doc.viewport)) as FrameNode;
      frame.x = x;
      frame.y = y;
      x += frame.width + 120;
      created.push(frame);
    }

    figma.currentPage.selection = created;
    figma.viewport.scrollAndZoomIntoView(created);
    post({
      type: "done",
      nodes: builder.count,
      substitutions: [...fonts.substitutions.values()],
      placeholders: [...new Set(msg.docs.flatMap((d) => d.placeholders))],
      unsupported: [...new Set(msg.docs.flatMap((d) => d.unsupported))],
    });
  } catch (e) {
    for (const n of builder?.roots ?? []) if (!n.removed) n.remove();
    post({ type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
