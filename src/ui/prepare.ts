/** Assembles the final HTML string from pasted text and/or uploaded files. */

export interface LocalAsset {
  name: string; // basename, lowercased
  text?: string; // for .css / .html
  dataUrl?: string; // for images and fonts
}

const basename = (path: string) => decodeURIComponent(path.split(/[?#]/)[0].split("/").pop() ?? "").toLowerCase();
const isRemote = (url: string) => /^(https?:)?\/\//i.test(url);

export async function readFiles(files: FileList | File[]): Promise<{ html: string | null; assets: Map<string, LocalAsset> }> {
  let html: string | null = null;
  const assets = new Map<string, LocalAsset>();
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (/\.html?$/.test(name)) {
      html ??= await f.text();
    } else if (name.endsWith(".css")) {
      assets.set(name, { name, text: await f.text() });
    } else {
      const dataUrl = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.onerror = () => rej(r.error);
        r.readAsDataURL(f);
      });
      assets.set(name, { name, dataUrl });
    }
  }
  return { html, assets };
}

/** Rewrites url(...) references in CSS to uploaded files' data URLs. */
export function rewriteCssUrls(css: string, assets: Map<string, LocalAsset>): string {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, _q, url: string) => {
    if (url.startsWith("data:") || isRemote(url)) return m;
    const a = assets.get(basename(url));
    return a?.dataUrl ? `url("${a.dataUrl}")` : m;
  });
}

export function prepareHtml(html: string, extraCss: string, assets: Map<string, LocalAsset>): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Inline uploaded stylesheets; leave remote ones (the extractor reports them).
  for (const link of [...doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')]) {
    const href = link.getAttribute("href")!;
    const a = isRemote(href) ? undefined : assets.get(basename(href));
    if (a?.text !== undefined) {
      const style = doc.createElement("style");
      style.textContent = rewriteCssUrls(a.text, assets);
      link.replaceWith(style);
    }
  }
  // Uploaded CSS not referenced by a <link> is applied too (e.g. user picked page.html + styles.css).
  const linked = new Set([...doc.querySelectorAll("link[href]")].map((l) => basename(l.getAttribute("href")!)));
  for (const a of assets.values()) {
    if (a.text !== undefined && !linked.has(a.name) && !html.includes(a.name)) {
      const style = doc.createElement("style");
      style.textContent = rewriteCssUrls(a.text, assets);
      doc.head.appendChild(style);
    }
  }

  for (const style of doc.querySelectorAll("style")) style.textContent = rewriteCssUrls(style.textContent ?? "", assets);
  for (const el of doc.querySelectorAll<HTMLElement>("[style]")) el.setAttribute("style", rewriteCssUrls(el.getAttribute("style")!, assets));

  for (const el of doc.querySelectorAll("img[src], video[poster], source[src], image[href]")) {
    const attr = el.hasAttribute("src") ? "src" : el.hasAttribute("poster") ? "poster" : "href";
    const url = el.getAttribute(attr)!;
    if (url.startsWith("data:") || isRemote(url)) continue;
    const a = assets.get(basename(url));
    if (a?.dataUrl) el.setAttribute(attr, a.dataUrl);
  }
  // srcset would override src with an unresolvable URL.
  for (const el of doc.querySelectorAll("img[srcset], source[srcset]")) el.removeAttribute("srcset");

  if (extraCss.trim()) {
    const style = doc.createElement("style");
    style.textContent = rewriteCssUrls(extraCss, assets);
    doc.head.appendChild(style);
  }
  for (const s of doc.querySelectorAll("script")) s.remove();

  return "<!doctype html>\n" + doc.documentElement.outerHTML;
}
