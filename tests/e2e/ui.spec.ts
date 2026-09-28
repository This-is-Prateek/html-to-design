import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

test("plugin UI renders HTML, posts IR per viewport and shows the report", async ({ page }) => {
  // In Figma the UI posts to its parent frame; capture those messages instead.
  await page.addInitScript(() => {
    (window as any).__sent = [];
    (window as any).parent = { postMessage: (m: unknown) => (window as any).__sent.push(m) };
  });
  await page.goto(pathToFileURL(resolve("dist/ui.html")).href);

  await page.click("#convert");
  await expect(page.locator("#report")).toContainText("Paste HTML");

  await page.fill("#html", `<h1 style="font:700 32px Arial">Hello</h1>`);
  await page.check('input[value="375"]');
  await page.click("#convert");
  await expect.poll(() => page.evaluate(() => (window as any).__sent.length)).toBe(1);

  const msg = await page.evaluate(() => (window as any).__sent[0].pluginMessage);
  expect(msg.type).toBe("build");
  expect(msg.docs.map((d: any) => d.viewport)).toEqual([1440, 375]);
  expect(JSON.stringify(msg.docs[0].root)).toContain('"characters":"Hello"');
  await expect(page.locator("#convert")).toBeDisabled();

  await page.evaluate(() =>
    window.postMessage(
      {
        pluginMessage: {
          type: "done",
          nodes: 4,
          substitutions: [{ requested: "Poppins Bold", used: "Inter Bold" }],
          placeholders: [],
          unsupported: ["filter"],
        },
      },
      "*",
    ),
  );
  await expect(page.locator("#report")).toContainText("Created 4 layers.");
  await expect(page.locator("#report")).toContainText("Poppins Bold → Inter Bold");
  await expect(page.locator("#report")).toContainText("filter");
  await expect(page.locator("#convert")).toBeEnabled();
});

test("plugin UI inlines uploaded CSS and images", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__sent = [];
    (window as any).parent = { postMessage: (m: unknown) => (window as any).__sent.push(m) };
  });
  await page.goto(pathToFileURL(resolve("dist/ui.html")).href);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.setInputFiles("#files", [
    { name: "page.html", mimeType: "text/html", buffer: Buffer.from(`<link rel="stylesheet" href="css/site.css"><div class="box"></div><img src="./img/dot.png" style="width:10px;height:10px">`) },
    { name: "site.css", mimeType: "text/css", buffer: Buffer.from(`.box{width:50px;height:50px;background:rgb(255,0,0)}`) },
    { name: "dot.png", mimeType: "image/png", buffer: png },
  ]);
  await expect(page.locator("#file-info")).toContainText("page.html");
  await page.click("#convert");
  await expect.poll(() => page.evaluate(() => (window as any).__sent.length)).toBe(1);
  const doc = await page.evaluate(() => (window as any).__sent[0].pluginMessage.docs[0]);
  const json = JSON.stringify(doc.root);
  expect(json).toContain('"name":"div.box"');
  expect(json).toContain('"r":1,"g":0,"b":0');
  expect(json).toContain('"type":"image"');
  expect(Object.keys(doc.images)).toHaveLength(1);
  expect(doc.unsupported).toEqual([]);
});

test("inline scripts cannot stall conversion by suppressing animation frames", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).__sent = [];
    (window as any).parent = { postMessage: (m: unknown) => (window as any).__sent.push(m) };
  });
  await page.goto(pathToFileURL(resolve("dist/ui.html")).href);
  await page.fill(
    "#html",
    `<main></main><script>requestAnimationFrame=()=>{};document.querySelector('main').textContent='Generated';</script>`,
  );

  await page.click("#convert");
  await expect.poll(() => page.evaluate(() => (window as any).__sent.length), { timeout: 3_000 }).toBe(1);

  const msg = await page.evaluate(() => (window as any).__sent[0].pluginMessage);
  expect(msg.type).toBe("build");
  expect(JSON.stringify(msg.docs[0].root)).toContain('"characters":"Generated"');
});
