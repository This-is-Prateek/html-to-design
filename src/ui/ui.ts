import type { IRDocument, MainToUI, UIToMain } from "../shared/ir";
import { htmlToIR } from "./extract";
import { type LocalAsset, hasScripts, prepareHtml, preRenderScripts, readFiles } from "./prepare";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const htmlInput = $<HTMLTextAreaElement>("html");
const cssInput = $<HTMLTextAreaElement>("css");
const filesInput = $<HTMLInputElement>("files");
const fileInfo = $<HTMLParagraphElement>("file-info");
const convertBtn = $<HTMLButtonElement>("convert");
const cancelBtn = $<HTMLButtonElement>("cancel");
const progress = $<HTMLDivElement>("progress");
const report = $<HTMLDivElement>("report");

let assets = new Map<string, LocalAsset>();

const send = (msg: UIToMain) => parent.postMessage({ pluginMessage: msg }, "*");

filesInput.addEventListener("change", async () => {
  const files = filesInput.files;
  if (!files?.length) return;
  const read = await readFiles(files);
  assets = read.assets;
  if (read.html !== null) htmlInput.value = read.html;
  const names = [...files].map((f) => f.name);
  fileInfo.hidden = false;
  fileInfo.textContent = `Loaded: ${names.join(", ")}`;
});

function viewports(): { width: number; height: number }[] {
  const out = [...document.querySelectorAll<HTMLInputElement>('input[name="vp"]:checked')].map((i) => ({
    width: Number(i.value),
    height: Number(i.dataset.h),
  }));
  if ($<HTMLInputElement>("vp-custom").checked) {
    const w = Math.round(Number($<HTMLInputElement>("vp-custom-w").value));
    if (w >= 200 && w <= 3840) out.push({ width: w, height: 900 });
  }
  return out;
}

function setProgress(fraction: number, label: string) {
  progress.hidden = false;
  (progress.querySelector(".bar span") as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
  (progress.querySelector(".hint") as HTMLElement).textContent = label;
}

function setBusy(busy: boolean) {
  convertBtn.disabled = busy;
  cancelBtn.hidden = !busy;
}

function list(title: string, items: string[], cls: string): string {
  if (!items.length) return "";
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<div class="${cls}"><h3>${esc(title)}</h3><ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
}

function showReport(html: string) {
  report.hidden = false;
  report.innerHTML = html;
}

convertBtn.addEventListener("click", async () => {
  let html = htmlInput.value.trim();
  const vps = viewports();
  report.hidden = true;
  if (!html) return showReport(`<p class="error">Paste HTML or upload an .html file first.</p>`);
  if (!vps.length) return showReport(`<p class="error">Select at least one viewport.</p>`);

  setBusy(true);
  try {
    // If the HTML contains inline <script> tags, pre-render them in a sandboxed
    // iframe first so JS-generated DOM content is captured before extraction.
    if (hasScripts(html)) {
      setProgress(0, "Executing scripts…");
      html = await preRenderScripts(html);
    }
    const source = prepareHtml(html, cssInput.value, assets);
    const docs: IRDocument[] = [];
    for (const [i, vp] of vps.entries()) {
      setProgress(i / vps.length / 2, `Rendering at ${vp.width}px…`);
      docs.push(await htmlToIR(source, vp.width, vp.height));
    }
    setProgress(0.5, "Building layers…");
    send({ type: "build", docs });
  } catch (e) {
    setBusy(false);
    progress.hidden = true;
    showReport(`<p class="error">Could not render the HTML: ${e instanceof Error ? e.message : String(e)}</p>`);
  }
});

cancelBtn.addEventListener("click", () => send({ type: "cancel" }));

window.onmessage = (event: MessageEvent) => {
  const msg = event.data?.pluginMessage as MainToUI | undefined;
  if (!msg) return;
  if (msg.type === "progress") {
    setProgress(0.5 + (msg.done / Math.max(msg.total, 1)) / 2, `Building layers… ${msg.done}/${msg.total}`);
    return;
  }
  setBusy(false);
  progress.hidden = true;
  if (msg.type === "error") {
    showReport(`<p class="error">${msg.message === "Cancelled" ? "Import cancelled." : `Import failed: ${msg.message}`}</p>`);
    return;
  }
  showReport(
    `<p class="ok">Created ${msg.nodes} layers.</p>` +
      list("Font substitutions (install these fonts and re-run for an exact match)", msg.substitutions.map((s) => `${s.requested} → ${s.used}`), "warn") +
      list("Images not available locally (placeholders used)", msg.placeholders, "warn") +
      list("CSS features approximated or skipped", msg.unsupported, "warn"),
  );
};
