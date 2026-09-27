import * as esbuild from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const watch = process.argv.includes("--watch");

// Figma refuses to start plugins whose manifest id isn't numeric ("error while loading the plugin environment").
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
if (!/^\d+$/.test(manifest.id)) throw new Error(`manifest.json id must be the numeric ID Figma assigns, got "${manifest.id}"`);
await mkdir("dist", { recursive: true });

const common = { bundle: true, minify: !watch, sourcemap: false, logLevel: "info" };

// Main thread runs in Figma's sandbox: keep syntax conservative.
const main = { ...common, entryPoints: ["src/main/code.ts"], outfile: "dist/code.js", target: "es2017", format: "iife" };

// UI is inlined into a single HTML file (Figma loads ui as a string).
const ui = { ...common, entryPoints: ["src/ui/ui.ts"], write: false, target: "chrome110", format: "iife" };
async function writeUi(js) {
  const css = await readFile("src/ui/ui.css", "utf8");
  const tpl = await readFile("src/ui/ui.html", "utf8");
  const code = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  await writeFile("dist/ui.html", tpl.replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => code));
}

// Extractor as a standalone global for Playwright tests.
const harness = { ...common, entryPoints: ["tests/harness.ts"], outfile: "dist/harness.js", target: "chrome110", format: "iife", minify: false };

if (watch) {
  const uiPlugin = { name: "ui", setup: (b) => b.onEnd((result) => result.outputFiles && writeUi(result)) };
  const ctxMain = await esbuild.context(main);
  const ctxUi = await esbuild.context({ ...ui, plugins: [uiPlugin] });
  await Promise.all([ctxMain.watch(), ctxUi.watch()]);
} else {
  await Promise.all([esbuild.build(main), esbuild.build(ui).then(writeUi), esbuild.build(harness)]);
}
