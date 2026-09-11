(function () {
  const SOURCE_ATTRIBUTE = "data-chatgpt-to-notion-latex";
  const HYDRATE_EVENT = "chatgpt-to-notion:hydrate-math";
  const CONTENT_SELECTOR =
    ".markdown, [class*='markdown'], [data-testid='conversation-turn-content']";
  const REACT_FIBER_PREFIXES = ["__reactFiber$", "__reactInternalInstance$"];
  const REACT_PROPS_PREFIX = "__reactProps$";
  const MAX_FIBER_DEPTH = 40;
  const MAX_OBJECT_DEPTH = 12;
  const MAX_SOURCE_LENGTH = 1000000;
  let scanScheduled = false;

  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    window.requestAnimationFrame(() => {
      scanScheduled = false;
      hydrateMathSources(document);
    });
  }

  function hydrateMathSources(root) {
    const cache = { props: new WeakMap(), rendered: new Map() };
    for (const contentRoot of collectContentRoots(root)) {
      hydrateContentRoot(contentRoot, cache);
    }
  }

  function collectContentRoots(root) {
    const roots = [];
    const add = (element) => {
      if (element instanceof Element && !roots.includes(element)) roots.push(element);
    };
    if (root instanceof Element) {
      add(root.matches(CONTENT_SELECTOR) ? root : root.closest(CONTENT_SELECTOR));
    }
    root?.querySelectorAll?.(CONTENT_SELECTOR).forEach(add);
    return roots;
  }

  function hydrateContentRoot(contentRoot, cache) {
    const messageRoot =
      contentRoot.closest("[data-message-author-role='assistant']") ||
      contentRoot.closest("article[data-testid^='conversation-turn-']") ||
      contentRoot;
    const mathElements = Array.from(contentRoot.querySelectorAll(".katex")).filter(
      (element) => !element.parentElement?.closest(".katex")
    );

    for (const element of mathElements) {
      const cached = normalizeLatex(element.getAttribute(SOURCE_ATTRIBUTE));
      const latex = readDomLatex(element) ||
        (matchesRenderedMath(element, cached, cache) ? cached : "") ||
        findReactLatex(element, messageRoot, cache);
      if (latex) {
        writeLatexSource(element, latex);
      } else {
        element.removeAttribute(SOURCE_ATTRIBUTE);
        element.closest(".katex-display")?.removeAttribute(SOURCE_ATTRIBUTE);
      }
    }
  }

  function writeLatexSource(element, latex) {
    if (element.getAttribute(SOURCE_ATTRIBUTE) !== latex) {
      element.setAttribute(SOURCE_ATTRIBUTE, latex);
    }
    const displayElement = element.closest(".katex-display");
    if (displayElement && displayElement.getAttribute(SOURCE_ATTRIBUTE) !== latex) {
      displayElement.setAttribute(SOURCE_ATTRIBUTE, latex);
    }
  }

  function readDomLatex(element) {
    const annotation = element.querySelector("annotation[encoding*='tex' i]");
    const sourceOwner = element.closest("[data-latex], [data-tex], [data-math]");
    const candidates = [
      annotation?.textContent,
      sourceOwner?.getAttribute("data-latex"),
      sourceOwner?.getAttribute("data-tex"),
      sourceOwner?.getAttribute("data-math")
    ];
    return candidates.map(normalizeLatex).find(Boolean) || "";
  }

  function matchesRenderedMath(element, latex, cache) {
    return Boolean(latex && window.ChatGPTToNotionMathRenderer?.matches(element, latex, cache.rendered));
  }

  function findReactLatex(element, messageRoot, cache) {
    const visitedFibers = new Set();
    // HTML inserted by React has no fiber of its own. Its wrapper/owner carries the source.
    for (let current = element; current && messageRoot.contains(current); current = current.parentElement) {
      let cursor = getReactFiber(current);
      for (let depth = 0; cursor && depth < MAX_FIBER_DEPTH; depth += 1) {
        if (visitedFibers.has(cursor)) break;
        visitedFibers.add(cursor);
        if (cursor.stateNode instanceof Element && !messageRoot.contains(cursor.stateNode)) break;
        let candidates = cache.props.get(cursor);
        if (!candidates) {
          candidates = [];
          const seen = new WeakSet();
          collectStrings(cursor.memoizedProps, "props", candidates, seen, 0);
          collectStrings(cursor.pendingProps, "props", candidates, seen, 0);
          collectStrings(cursor.alternate?.memoizedProps, "props", candidates, seen, 0);
          cache.props.set(cursor, candidates);
        }
        const latex = chooseMatchingLatex(candidates, element, cache);
        if (latex) return latex;
        cursor = cursor.return;
      }
    }
    return "";
  }

  function getReactFiber(element) {
    const keys = Object.getOwnPropertyNames(element);
    const key = keys.find((name) => REACT_FIBER_PREFIXES.some((prefix) => name.startsWith(prefix)));
    if (key) return element[key];
    const propsKey = keys.find((name) => name.startsWith(REACT_PROPS_PREFIX));
    return propsKey ? { memoizedProps: element[propsKey], return: null } : null;
  }

  function collectStrings(value, path, output, seen, depth) {
    if (output.length >= 2000) return;
    if (typeof value === "string") {
      if (value.length > 0 && value.length <= MAX_SOURCE_LENGTH && !value.includes("<span")) {
        output.push({ value, path });
      }
      return;
    }
    if (!value || typeof value !== "object" || depth >= MAX_OBJECT_DEPTH || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.slice(0, 2000).forEach((item, index) => {
        collectStrings(item, path + "[" + index + "]", output, seen, depth + 1);
      });
      return;
    }
    for (const key of Object.keys(value).slice(0, 100)) {
      if (["dangerouslySetInnerHTML", "ref", "_owner", "stateNode", "alternate"].includes(key)) continue;
      collectStrings(value[key], path + "." + key, output, seen, depth + 1);
    }
  }

  function chooseMatchingLatex(candidates, element, cache) {
    let best = null;
    const checked = new Set();
    for (const candidate of candidates) {
      const expressions = extractDelimitedMath(candidate.value);
      if (!expressions.length && isDirectMathPath(candidate.path)) {
        expressions.push(normalizeLatex(candidate.value));
      }
      for (const latex of expressions) {
        if (!latex || latex.length > 20000 || checked.has(latex)) continue;
        checked.add(latex);
        if (!matchesRenderedMath(element, latex, cache)) continue;
        const score = scorePath(candidate.path);
        if (!best || score > best.score) best = { latex, score };
      }
    }
    return best?.latex || "";
  }

  function extractDelimitedMath(source) {
    const text = stripCitationMarkers(source);
    const expressions = [];
    const pattern = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1|(`+)[^\n]*?\2|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|(?<![\\$])\$([^\s$](?:\\.|[^$])*?)\$(?!\$)/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1] || match[2]) continue;
      const latex = normalizeLatex(match[3] || match[4] || match[5] || match[6] || "");
      if (latex) expressions.push(latex);
    }
    return expressions;
  }

  function sourceField(path) {
    return (path || "").match(/(?:^|\.)(\w+)(?:\[\d+\])*$/)?.[1] || "";
  }

  function isDirectMathPath(path) {
    return /^(?:latex|tex|math|formula|expression|children|value|content|source|text)$/i.test(sourceField(path));
  }

  function scorePath(path) {
    const source = sourceField(path);
    if (/^(?:latex|tex)$/i.test(source)) return 80;
    if (/^(?:math|formula|expression)$/i.test(source)) return 70;
    if (/^children$/i.test(source)) return 35;
    if (/^(?:value|content|source|text)$/i.test(source)) return 25;
    return 0;
  }

  function normalizeLatex(source) {
    const latex = stripCitationMarkers(source).trim()
      .replace(/^\\\[([\s\S]*)\\\]$/, "$1")
      .replace(/^\\\(([\s\S]*)\\\)$/, "$1")
      .replace(/^\$\$([\s\S]*)\$\$$/, "$1")
      .replace(/^\$([\s\S]*)\$$/, "$1")
      .trim();
    return /contentReference\[oaicite:/.test(latex) ? "" : latex;
  }

  function stripCitationMarkers(source) {
    return (source || "").replace(/:?contentReference\[oaicite:\s*\d+\]\{index\s*=\s*\d+\}/g, "");
  }

  document.addEventListener(HYDRATE_EVENT, () => hydrateMathSources(document));
  const observer = new MutationObserver((records) => {
    if (records.some((record) => Array.from(record.addedNodes || []).some(
      (node) => node instanceof Element &&
        (node.matches(".katex, " + CONTENT_SELECTOR) || node.querySelector(".katex, " + CONTENT_SELECTOR))
    ))) scheduleScan();
  });
  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
  }
  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();
