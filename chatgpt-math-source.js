(function () {
  const SOURCE_ATTRIBUTE = "data-chatgpt-to-notion-latex";
  const HYDRATE_EVENT = "chatgpt-to-notion:hydrate-math";
  const CONTENT_SELECTOR =
    ".markdown, [class*='markdown'], [data-testid='conversation-turn-content']";
  const REACT_FIBER_PREFIXES = ["__reactFiber$", "__reactInternalInstance$"];
  const REACT_PROPS_PREFIX = "__reactProps$";
  const MAX_FIBER_DEPTH = 24;
  const MAX_OBJECT_DEPTH = 8;
  const MAX_SOURCE_LENGTH = 20000;
  let scanScheduled = false;

  function scheduleScan() {
    if (scanScheduled) {
      return;
    }

    scanScheduled = true;
    window.requestAnimationFrame(() => {
      scanScheduled = false;
      hydrateMathSources(document);
    });
  }

  function hydrateMathSources(root) {
    const contentRoots = collectContentRoots(root);

    for (const contentRoot of contentRoots) {
      hydrateContentRoot(contentRoot);
    }
  }

  function collectContentRoots(root) {
    const roots = [];
    const add = (element) => {
      if (element instanceof Element && !roots.includes(element)) {
        roots.push(element);
      }
    };

    if (root instanceof Element) {
      add(root.matches(CONTENT_SELECTOR) ? root : root.closest(CONTENT_SELECTOR));
    }

    if (root?.querySelectorAll) {
      root.querySelectorAll(CONTENT_SELECTOR).forEach(add);
    }

    return roots;
  }

  function hydrateContentRoot(contentRoot) {
    const mathElements = Array.from(contentRoot.querySelectorAll(".katex")).filter(
      (element) => !element.parentElement?.closest(".katex")
    );

    if (!mathElements.length) {
      return;
    }

    const unresolved = [];

    mathElements.forEach((element, index) => {
      if (readDomLatex(element)) {
        return;
      }

      const latex = findNearestReactLatex(element);
      if (latex) {
        writeLatexSource(element, latex);
      } else {
        unresolved.push({ element, index });
      }
    });

    if (!unresolved.length) {
      return;
    }

    const orderedSources = findOrderedMessageSources(contentRoot, mathElements.length);
    if (!orderedSources) {
      return;
    }

    for (const { element, index } of unresolved) {
      const source = orderedSources[index];
      if (source) {
        writeLatexSource(element, source);
      }
    }
  }

  function writeLatexSource(element, latex) {
    element.setAttribute(SOURCE_ATTRIBUTE, latex);

    const displayElement = element.closest(".katex-display");
    if (displayElement) {
      displayElement.setAttribute(SOURCE_ATTRIBUTE, latex);
    }
  }

  function readDomLatex(element) {
    const annotation = element.querySelector(
      ".katex-mathml annotation[encoding='application/x-tex']"
    );
    const sourceOwner = element.closest(
      "[data-chatgpt-to-notion-latex], [data-latex], [data-tex], [data-math]"
    );
    return normalizeLatex(
      annotation?.textContent ||
        element.getAttribute(SOURCE_ATTRIBUTE) ||
        element.getAttribute("data-latex") ||
        element.getAttribute("data-tex") ||
        sourceOwner?.getAttribute(SOURCE_ATTRIBUTE) ||
        sourceOwner?.getAttribute("data-latex") ||
        sourceOwner?.getAttribute("data-tex") ||
        sourceOwner?.getAttribute("data-math") ||
        ""
    );
  }

  function findNearestReactLatex(element) {
    for (let current = element; current; current = current.parentElement) {
      const fiber = getReactFiber(current);
      if (!fiber) {
        continue;
      }

      let cursor = fiber;
      for (let depth = 0; cursor && depth < MAX_FIBER_DEPTH; depth += 1) {
        const candidates = [];
        collectStrings(cursor.memoizedProps, "props", candidates, new WeakSet(), 0);
        collectStrings(cursor.pendingProps, "pendingProps", candidates, new WeakSet(), 0);
        const latex = chooseSingleLatex(candidates);
        if (latex) {
          return latex;
        }
        cursor = cursor.return;
      }
    }

    return "";
  }

  function findOrderedMessageSources(contentRoot, expectedCount) {
    const messageRoot =
      contentRoot.closest("article[data-testid^='conversation-turn-']") ||
      contentRoot.closest("[data-message-author-role='assistant']") ||
      contentRoot;
    const candidates = [];

    for (const element of [contentRoot, messageRoot]) {
      const fiber = getReactFiber(element);
      let cursor = fiber;

      for (let depth = 0; cursor && depth < MAX_FIBER_DEPTH; depth += 1) {
        collectStrings(cursor.memoizedProps, "props", candidates, new WeakSet(), 0);
        collectStrings(cursor.pendingProps, "pendingProps", candidates, new WeakSet(), 0);
        cursor = cursor.return;
      }
    }

    let best = null;

    for (const candidate of candidates) {
      const expressions = extractDelimitedMath(candidate.value);
      if (expressions.length !== expectedCount) {
        continue;
      }

      const score = scorePath(candidate.path) - candidate.value.length / 10000;
      if (!best || score > best.score) {
        best = { expressions, score };
      }
    }

    return best?.expressions || null;
  }

  function getReactFiber(element) {
    if (!(element instanceof Element)) {
      return null;
    }

    const key = Object.getOwnPropertyNames(element).find((name) =>
      REACT_FIBER_PREFIXES.some((prefix) => name.startsWith(prefix))
    );
    if (key) {
      return element[key];
    }

    const propsKey = Object.getOwnPropertyNames(element).find((name) =>
      name.startsWith(REACT_PROPS_PREFIX)
    );
    return propsKey
      ? { memoizedProps: element[propsKey], pendingProps: null, return: null }
      : null;
  }

  function collectStrings(value, path, output, seen, depth) {
    if (typeof value === "string") {
      if (value.length > 0 && value.length <= MAX_SOURCE_LENGTH && !value.includes("<span")) {
        output.push({ value, path });
      }
      return;
    }

    if (!value || typeof value !== "object" || depth >= MAX_OBJECT_DEPTH) {
      return;
    }

    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      value.slice(0, 200).forEach((item, index) => {
        collectStrings(item, `${path}[${index}]`, output, seen, depth + 1);
      });
      return;
    }

    for (const key of Object.keys(value).slice(0, 100)) {
      if (
        key === "dangerouslySetInnerHTML" ||
        key === "ref" ||
        key === "_owner" ||
        key === "stateNode"
      ) {
        continue;
      }
      collectStrings(value[key], `${path}.${key}`, output, seen, depth + 1);
    }
  }

  function chooseSingleLatex(candidates) {
    let best = null;

    for (const candidate of candidates) {
      const expressions = extractDelimitedMath(candidate.value);
      let latex = "";
      let score = scorePath(candidate.path);

      if (expressions.length === 1) {
        latex = expressions[0];
        score += 200;
      } else if (expressions.length === 0 && isDirectMathPath(candidate.path)) {
        latex = normalizeLatex(candidate.value);
        if (!looksLikeLatex(latex, candidate.path)) {
          continue;
        }
        score += 100;
      } else {
        continue;
      }

      score -= latex.length / 10000;
      if (latex && (!best || score > best.score)) {
        best = { latex, score };
      }
    }

    return best?.latex || "";
  }

  function extractDelimitedMath(source) {
    const text = source || "";
    const expressions = [];
    const pattern = /\\\[((?:.|\n)*?)\\\]|\\\(((?:.|\n)*?)\\\)|\$\$((?:.|\n)*?)\$\$/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const latex = normalizeLatex(match[1] || match[2] || match[3] || "");
      if (latex) {
        expressions.push(latex);
      }
    }

    return expressions;
  }

  function isDirectMathPath(path) {
    return /(?:latex|tex|math|formula|expression|children|value|content|source)/i.test(path || "");
  }

  function scorePath(path) {
    const source = path || "";
    if (/(?:latex|tex)/i.test(source)) return 80;
    if (/(?:math|formula|expression)/i.test(source)) return 70;
    if (/children/i.test(source)) return 35;
    if (/(?:value|content|source)/i.test(source)) return 25;
    return 0;
  }

  function looksLikeLatex(source, path) {
    const text = (source || "").trim();
    if (!text || text.length > 5000 || /[<>]/.test(text)) {
      return false;
    }

    if (/(?:latex|tex|math|formula|expression)/i.test(path || "")) {
      return true;
    }

    return /\\[A-Za-z]+|[_^{}]|[=+\-*/<>]|[\u2200-\u22ff]|[\u0370-\u03ff]/.test(text);
  }

  function normalizeLatex(source) {
    return (source || "")
      .trim()
      .replace(/^\\\[((?:.|\n)*)\\\]$/s, "$1")
      .replace(/^\\\(((?:.|\n)*)\\\)$/s, "$1")
      .replace(/^\$\$((?:.|\n)*)\$\$$/s, "$1")
      .trim();
  }

  document.addEventListener(HYDRATE_EVENT, () => hydrateMathSources(document));

  const observer = new MutationObserver((records) => {
    if (
      records.some((record) =>
        Array.from(record.addedNodes || []).some(
          (node) =>
            node instanceof Element &&
            (node.matches?.(".katex, " + CONTENT_SELECTOR) ||
              node.querySelector?.(".katex, " + CONTENT_SELECTOR))
        )
      )
    ) {
      scheduleScan();
    }
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scheduleScan();
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  }
})();
