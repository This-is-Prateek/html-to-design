# HTML to Design (Figma plugin)

Paste or upload HTML/CSS and get Figma frames that match the browser rendering. Fonts, sizes, weights, colors, borders, radii, shadows, gradients, images and positions carry over. Everything runs locally: no backend, and `networkAccess` is `none`.

## How it works

```
Plugin UI (Chromium iframe)                          Main thread (Figma sandbox)
┌──────────────────────────────────────────┐        ┌─────────────────────────────┐
│ prepare.ts  inline uploaded CSS/images   │        │ fonts.ts  resolve + load    │
│ render.ts   hidden <iframe srcdoc>,      │  IR    │ build.ts  frames, text,     │
│             no scripts, per viewport     │ ─────▶ │           SVG, images       │
│ extract/*   DOM + computed styles → IR   │        │ code.ts   progress, report  │
└──────────────────────────────────────────┘        └─────────────────────────────┘
```

The browser does the layout; the plugin never re-implements CSS. Each element becomes an absolutely positioned frame, and runs of inline text become one text layer with styled ranges. The IR types live in `src/shared/ir.ts`.

## Develop

```bash
npm install
npm run build          # or: npm run watch
npm test               # unit tests (parsers, fonts, gradient math, builder vs. fake Figma API)
npm run test:e2e       # Playwright: extract fixtures in Chromium, pixel-diff IR re-render vs source
```

Load the plugin in **Figma Desktop**: *Plugins → Development → Import plugin from manifest…* → pick `manifest.json`.

E2E artefacts (IR JSON, source/IR screenshots, diff images) are written to `test-results/`.

## Use

1. Paste HTML, including `<style>` blocks, or click **Upload files…** and select the `.html` file together with its `.css` and image files. Uploaded files are matched to references by file name.
2. Optionally add extra CSS.
3. Pick one or more viewports (1440 / 768 / 375 / custom). Each viewport becomes its own frame.
4. Click **Convert to Figma**. When the build finishes, the plugin shows:
   - fonts that were substituted (install them and re-run for an exact match)
   - images that were unavailable and replaced with a grey placeholder named `image: <url>`
   - CSS features that were approximated or skipped

## Known limits (v1)

- **No JavaScript execution**, by design (safety and deterministic output). Paste the *rendered* HTML of JS apps, e.g. "Copy outerHTML" from DevTools.
- **No network**: remote stylesheets, web fonts and images are not fetched. Upload them alongside the HTML instead.
- **Absolute layout only**: the output is visually faithful but not Auto Layout.
- **Colors and fonts are raw values**: no Variables or Styles are created.
- Transforms keep only the bounding box. `filter`, `backdrop-filter`, `mix-blend-mode`, `clip-path`, masks and `background-clip: text` are skipped. Repeating and conic gradients are approximated. All of these are reported after import.
- Figma supports one stroke color per layer, so per-side border *colors* use the first visible side's color. Per-side *widths* are kept.
- Text wraps at the browser's measured width. If Figma's glyph metrics add a line, the box widens by at most 4px or 4%.

## Publishing checklist (Figma Community)

- [ ] Create the plugin in Figma (*Plugins → Development → New plugin*) and copy its ID into `manifest.json` → `id`.
- [ ] Icon 128×128 and cover 1920×1080 (not in repo).
- [ ] Listing description: include the "Known limits" section above and state that nothing leaves the machine.
- [ ] `npm run build`, then publish from Figma Desktop (*Plugins → Development → Publish*).
- [ ] Manual check before submitting: run each fixture in `tests/fixtures/` at every viewport in Figma, and overlay a browser screenshot at 50% opacity.
