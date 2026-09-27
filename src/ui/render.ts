/** Renders HTML in a hidden, script-less iframe so the browser computes layout for us. */
export async function renderHtml(html: string, width: number, height: number): Promise<{ doc: Document; win: Window; dispose: () => void }> {
  const iframe = document.createElement("iframe");
  // allow-same-origin lets us read the DOM; omitting allow-scripts keeps user JS from running.
  iframe.setAttribute("sandbox", "allow-same-origin");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
    border: "0",
    pointerEvents: "none",
  });
  const loaded = new Promise<void>((res) => iframe.addEventListener("load", () => res(), { once: true }));
  iframe.srcdoc = html;
  document.body.appendChild(iframe);
  await loaded;

  const doc = iframe.contentDocument!;
  const win = iframe.contentWindow!;
  await withTimeout(doc.fonts.ready, 3000);
  await withTimeout(
    Promise.all([...doc.images].map((img) => (img.complete ? null : img.decode().catch(() => null)))),
    3000,
  );
  materializePseudos(doc, win);
  return { doc, win, dispose: () => iframe.remove() };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([p, new Promise<void>((res) => setTimeout(res, ms))]);
}

const NO_PSEUDO = new Set(["IMG", "INPUT", "BR", "HR", "TEXTAREA", "SELECT", "IFRAME", "VIDEO", "CANVAS", "svg"]);

function contentText(content: string, el: Element): string | null {
  // Computed content is a sequence of quoted strings, attr(), counter() and url() tokens.
  let out = "";
  const re = /"((?:[^"\\]|\\.)*)"|attr\(([^)]+)\)|(counters?\([^)]*\))|url\([^)]*\)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = re.exec(content))) {
    matched = true;
    if (m[1] !== undefined) out += m[1].replace(/\\([0-9a-f]{1,6}) ?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, "$1");
    else if (m[2]) out += el.getAttribute(m[2].trim()) ?? "";
  }
  return matched ? out : null;
}

/**
 * ::before/::after have no DOM nodes or rects. Replace each with a real <span>
 * carrying the pseudo's computed style, then disable the original pseudo.
 */
export function materializePseudos(doc: Document, win: Window) {
  const jobs: { host: Element; which: "before" | "after"; style: string; text: string }[] = [];
  for (const el of doc.body.querySelectorAll("*")) {
    if (NO_PSEUDO.has(el.tagName)) continue;
    for (const which of ["before", "after"] as const) {
      const cs = win.getComputedStyle(el, `::${which}`);
      if (cs.display === "none" || cs.content === "none" || cs.content === "normal") continue;
      const text = contentText(cs.content, el);
      if (text === null) continue;
      let style = "";
      for (let i = 0; i < cs.length; i++) {
        const prop = cs[i];
        if (prop === "content") continue;
        style += `${prop}:${cs.getPropertyValue(prop)};`;
      }
      jobs.push({ host: el, which, style, text });
    }
  }
  // Read everything first, then write, so mutations don't affect later reads.
  for (const j of jobs) {
    const span = doc.createElement("span");
    span.setAttribute("data-h2d-pseudo", j.which);
    span.setAttribute("style", j.style);
    span.textContent = j.text;
    j.host.setAttribute("data-h2d-host", "");
    if (j.which === "before") j.host.prepend(span);
    else j.host.append(span);
  }
  if (jobs.length) {
    const s = doc.createElement("style");
    s.textContent = "[data-h2d-host]::before,[data-h2d-host]::after{content:none!important}";
    doc.head.appendChild(s);
  }
}
