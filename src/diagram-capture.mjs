import { toPng } from "html-to-image";

const EXCLUDED = "pre, code, table, button, script, style, template, .katex, .katex-display, math, mjx-container, [data-chatgpt-to-notion-button]";
const EXPLICIT = "[data-diagram], [data-testid*='diagram'], .mermaid, .recharts-wrapper, .vega-embed, [role='img']";
const MARKER = "data-ai-to-notion-capture";
const CAPTION_SELECTOR = "figcaption, [data-d-component='caption'], [data-diagram-caption], [data-testid='diagram-caption']";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

function styleOf(element) {
  return element.ownerDocument.defaultView.getComputedStyle(element);
}

function framed(element) {
  const style = styleOf(element);
  return ["Top", "Right", "Bottom", "Left"].some(side =>
    parseFloat(style["border" + side + "Width"]) > 0 &&
    !["none", "hidden"].includes(style["border" + side + "Style"])
  );
}

function visibleSize(element, allowSmall = false) {
  const rect = element.getBoundingClientRect();
  const style = styleOf(element);
  return rect.width >= (allowSmall ? 1 : 160) && rect.height >= (allowSmall ? 1 : 70) &&
    style.display !== "none" && style.visibility !== "hidden";
}

function isBoxLayout(element) {
  const style = styleOf(element);
  if (!["grid", "inline-grid", "flex", "inline-flex"].includes(style.display)) return false;
  const children = [...element.children].filter(child => child.getBoundingClientRect().width > 60);
  if (children.length < 2 || element.querySelector("pre, table")) return false;
  const boxes = children.filter(framed);
  const rects = children.map(child => child.getBoundingClientRect());
  const multipleColumns = rects.some(rect => rect.left > rects[0].left + 30);
  return multipleColumns && (framed(element) || boxes.length >= 2);
}

function isSourceCitation(element) {
  return element.ownerDocument.defaultView.ChatGPTToNotionConverter?.isSourceCitationElement?.(element) || false;
}

function isStructuredDiagram(element) {
  // The endpoints may be unbordered; the outer box owns the visual layout.
  if (!element.matches("[data-d-component='box'][data-d-has-border]")) return false;
  if ([...element.querySelectorAll("[data-d-component='grid']")].some(grid =>
      [...grid.children].filter(child => child.matches("[data-d-component='grid-item']")).length >= 2
    )) return true;
  const children = [...element.children];
  const stage = child => child.matches("[data-d-component='box']") && Boolean(child.textContent.trim());
  return children.some((child, index) => {
    const connector = child.matches("svg[data-d-component='icon']") ||
      (!child.textContent.trim() && Boolean(child.querySelector("svg[data-d-component='icon']")));
    return connector && children.slice(0, index).some(stage) && children.slice(index + 1).some(stage);
  });
}

function isSvgImage(element) {
  return element.localName === "img" && (
    element.matches("[data-d-component='svg']") ||
    /^data:image\/svg\+xml[;,]/i.test(element.getAttribute("src") || "")
  );
}

function sideBySide(elements) {
  const rects = elements.map(element => element.getBoundingClientRect());
  return rects.some((rect, index) => rects.slice(index + 1).some(other =>
    Math.abs(rect.left - other.left) > 30 && Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 20
  ));
}

function hasUnborderedColumns(element) {
  return [...element.querySelectorAll("*")].some(layout => {
    if (layout.closest(EXCLUDED) || isSourceCitation(layout)) return false;
    if (!["grid", "inline-grid", "flex", "inline-flex"].includes(styleOf(layout).display)) return false;
    const children = [...layout.children].filter(child => {
      if (child.closest(EXCLUDED) || isSourceCitation(child) || !child.textContent.trim()) return false;
      const rect = child.getBoundingClientRect();
      return rect.width >= 60 && rect.height >= 35;
    });
    return sideBySide(children);
  });
}

function isFramedDiagram(element, frames) {
  if (!framed(element)) return false;
  const descendants = frames.filter(frame => frame !== element && element.contains(frame));
  // Wrappers (including display:contents and custom tags) need not be boxes.
  const boxes = descendants.filter(frame => !descendants.some(other => other !== frame && other.contains(frame)));
  const hasConnector = /[\u2190-\u2199\u21d0-\u21d9\u27f5-\u27ff]/u.test(element.textContent || "") ||
    Boolean(element.querySelector("svg line, svg path[marker-end]"));
  if (boxes.length >= 2 && (sideBySide(boxes) || hasConnector)) return true;
  return hasConnector && hasUnborderedColumns(element);
}

export function find(root, range = null) {
  if (!root?.querySelectorAll) return [];
  const candidates = [];
  const elements = [...root.querySelectorAll("*")].filter(element =>
    !element.closest(EXCLUDED) && !isSourceCitation(element)
  );
  const frames = elements.filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.width >= 60 && rect.height >= 35 && framed(element);
  });
  for (const element of elements) {
    const svgImage = isSvgImage(element);
    if (!visibleSize(element, svgImage)) continue;
    const visual = svgImage || ["svg", "canvas", "iframe"].includes(element.localName);
    if (!visual && !element.matches(EXPLICIT) && !isStructuredDiagram(element) &&
        !isBoxLayout(element) && !isFramedDiagram(element, frames)) continue;
    if (element.querySelector("pre, table")) continue;
    let target = element;
    // Keep the surrounding title, frame and arrows with a multi-column diagram.
    for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
      if (parent.matches(EXCLUDED) || parent.querySelector("pre, table") ||
          (parent.textContent || "").length > 12000) break;
      if (framed(parent) || parent.tagName === "FIGURE") target = parent;
    }
    if (range && !range.intersectsNode(target)) continue;
    if (!candidates.includes(target)) candidates.push(target);
  }
  return candidates.filter(element => !candidates.some(other => other !== element && other.contains(element)));
}

function backgroundColor(element) {
  for (let current = element; current; current = current.parentElement) {
    const color = styleOf(current).backgroundColor;
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)") return color;
  }
  const channels = (styleOf(element).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  return channels.length === 3 && channels.reduce((a, b) => a + b, 0) > 550 ? "#111111" : "#ffffff";
}

function failure(message) {
  const error = new Error(message);
  error.code = "DIAGRAM_CAPTURE_FAILED";
  return error;
}

function embeddedBody(frame) {
  let body;
  try { body = frame.contentDocument?.body; } catch { /* Cross-origin frames are inaccessible. */ }
  if (!body) throw failure("This embedded diagram cannot be captured. Copy its image directly instead.");
  return body;
}

function checkEmbeddedFrames(element) {
  for (const frame of element.querySelectorAll("iframe")) {
    checkEmbeddedFrames(embeddedBody(frame));
  }
}

function diagramCaption(element) {
  const nodes = [];
  const children = [...element.children].filter(child =>
    !child.matches("button, [hidden], [aria-hidden='true']") && !isSourceCitation(child)
  );
  for (const child of children.reverse()) {
    let caption = child.matches(CAPTION_SELECTOR) ? child : null;
    if (!caption && !child.matches("[data-d-component='box'], [data-d-component='grid'], [data-d-component='grid-item']")) {
      const nested = child.querySelector(CAPTION_SELECTOR);
      if (nested && child.textContent.trim() === nested.textContent.trim() && !child.querySelector("img, svg, canvas, iframe")) caption = nested;
    }
    if (!caption || styleOf(child).display === "none" || styleOf(child).visibility === "hidden") break;
    nodes.unshift(child);
  }
  const text = nodes.map(node => {
    const clone = node.cloneNode(true);
    for (const child of clone.querySelectorAll("*")) {
      if (child.matches("button, [hidden], [aria-hidden='true']") || isSourceCitation(child)) child.remove();
    }
    return clone.textContent;
  }).join(" ").trim().replace(/\s+/g, " ");
  return { nodes: new Set(nodes), text };
}

async function capture(element, caption) {
  const target = element.tagName === "IFRAME" ? embeddedBody(element) : element;
  checkEmbeddedFrames(target);
  const rect = target.getBoundingClientRect();
  const width = Math.ceil(Math.max(rect.width, target.scrollWidth || 0));
  let height = Math.ceil(Math.max(rect.height, target.scrollHeight || 0));
  if (caption.nodes.size && target === element) {
    const remaining = [...target.children].filter(child => !caption.nodes.has(child) &&
      !child.matches("button, [hidden], [aria-hidden='true']") && !isSourceCitation(child));
    const bottom = Math.max(...remaining.map(child => child.getBoundingClientRect().bottom + (parseFloat(styleOf(child).marginBottom) || 0)));
    const style = styleOf(target);
    const contentHeight = bottom - rect.top + (parseFloat(style.paddingBottom) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    if (Number.isFinite(contentHeight) && contentHeight > 0) height = Math.min(height, Math.ceil(contentHeight));
  }
  if (!width || !height || width > 16000 || height > 16000) {
    throw failure("The diagram is too large to copy. Select a smaller diagram.");
  }
  const ratio = Math.min(2, 4096 / Math.max(width, height), Math.sqrt(8000000 / (width * height)));
  for (const pixelRatio of [ratio, ratio / 2]) {
    const src = await toPng(target, {
      width, height, pixelRatio,
      backgroundColor: backgroundColor(target),
      skipFonts: true,
      style: { margin: "0", overflow: "visible", maxWidth: "none", maxHeight: "none", ...(caption.nodes.size ? { minHeight: "0" } : {}) },
      filter: node => !node.matches?.("button, [data-chatgpt-to-notion-button], [data-ai-to-notion-action-slot]") &&
        !caption.nodes.has(node) &&
        !(node.nodeType === 1 && isSourceCitation(node))
    });
    if (!src.startsWith("data:image/png;base64,")) throw failure("The diagram could not be captured.");
    if (src.length * 3 / 4 <= MAX_IMAGE_BYTES) return src;
  }
  throw failure("The diagram image is too large. Select a smaller diagram.");
}

export async function prepare(root, range = null) {
  const elements = find(root, range);
  if (!elements.length) return null;
  if (elements.length > 20) throw failure("Too many diagrams. Copy a smaller selection.");
  const captures = [];
  let totalBytes = 0;
  for (const element of elements) {
    let timeout;
    try {
      const caption = diagramCaption(element);
      const src = await Promise.race([
        capture(element, caption),
        new Promise((_, reject) => { timeout = setTimeout(() => reject(failure("Diagram capture timed out. Please try again.")), 20000); })
      ]);
      totalBytes += src.length * 3 / 4;
      if (totalBytes > MAX_TOTAL_BYTES) throw failure("The images are too large together. Copy fewer diagrams.");
      const title = caption.text || element.getAttribute("aria-label") || element.getAttribute("alt") ||
        element.querySelector("h1, h2, h3, h4")?.textContent || "";
      captures.push({ element, src, alt: title.trim().replace(/\s+/g, " ") });
    } catch (error) {
      if (error.code === "DIAGRAM_CAPTURE_FAILED") throw error;
      throw failure("A diagram could not be captured. Try copying it separately.");
    } finally {
      clearTimeout(timeout);
    }
  }

  const selectedRange = range?.cloneRange();
  if (selectedRange) {
    for (const { element } of captures) {
      if (element.contains(selectedRange.startContainer)) selectedRange.setStartBefore(element);
      if (element.contains(selectedRange.endContainer)) selectedRange.setEndAfter(element);
    }
  }
  const container = root.ownerDocument.createElement("div");
  const originals = captures.map(({ element }) => element.getAttribute(MARKER));
  try {
    captures.forEach(({ element }, index) => element.setAttribute(MARKER, String(index)));
    container.appendChild(selectedRange ? selectedRange.cloneContents() : root.cloneNode(true));
  } finally {
    captures.forEach(({ element }, index) => {
      if (originals[index] === null) element.removeAttribute(MARKER);
      else element.setAttribute(MARKER, originals[index]);
    });
  }
  captures.forEach(({ src, alt }, index) => {
    const clone = container.querySelector("[" + MARKER + "='" + index + "']");
    if (!clone) throw failure("The diagram changed while copying. Please copy again.");
    const image = root.ownerDocument.createElement("img");
    image.src = src;
    image.alt = alt;
    clone.replaceWith(image);
  });
  return container;
}
