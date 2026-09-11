import katex from "katex";

const STRUCTURES = [".mfrac", ".sqrt", ".enclosing", ".msupsub", ".vlist-t2", ".mtable", ".accent-body"];

function signature(element) {
  const html = element.matches(".katex-html") ? element : element.querySelector(".katex-html");
  if (!html) return "";
  const text = (html.textContent || "").normalize("NFKC")
    .replace(/[\s\u200b-\u200f\u2060\ufeff]/g, "");
  const structures = STRUCTURES.map(selector => html.querySelectorAll(selector).length);
  return JSON.stringify([text, structures]);
}

export function matches(element, latex, cache = new Map()) {
  if (!latex || latex.length > 20000) return false;
  const expected = signature(element);
  if (!expected) return false;
  const displayMode = Boolean(element.closest(".katex-display, .math-display"));
  const key = JSON.stringify([displayMode, latex]);
  if (!cache.has(key)) {
    try {
      const container = element.ownerDocument.createElement("span");
      container.innerHTML = katex.renderToString(latex, {
        output: "html",
        displayMode,
        throwOnError: true,
        strict: "ignore",
        trust: false,
        maxExpand: 1000,
        maxSize: 50
      });
      cache.set(key, signature(container));
    } catch {
      cache.set(key, "");
    }
  }
  return cache.get(key) === expected;
}
