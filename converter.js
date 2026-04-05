(function () {
  const BLOCK_TAGS = new Set([
    "P",
    "PRE",
    "UL",
    "OL",
    "TABLE",
    "BLOCKQUOTE",
    "HR",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "FIGURE",
    "IMG"
  ]);

  function convertMessage(root) {
    const blocks = parseContainerChildren(root);
    return {
      blocks,
      markdown: renderBlocksMarkdown(blocks).trim(),
      html: renderBlocksHtml(blocks).trim()
    };
  }

  function parseContainerChildren(container) {
    const blocks = [];

    for (const node of container.childNodes) {
      blocks.push(...parseNodeToBlocks(node));
    }

    return compactBlocks(blocks);
  }

  function parseNodeToBlocks(node) {
    if (!node) {
      return [];
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapseWhitespace(node.textContent || "");
      if (!text.trim()) {
        return [];
      }

      return [
        {
          type: "paragraph",
          children: [{ type: "text", text }]
        }
      ];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }

    const element = node;

    if (shouldSkipElement(element)) {
      return [];
    }

    if (isDisplayMathElement(element)) {
      const latex = extractLatex(element);
      return latex
        ? [
            {
              type: "equation",
              latex
            }
          ]
        : [];
    }

    const tagName = element.tagName;

    if (/^H[1-6]$/.test(tagName)) {
      return parseHeading(element);
    }

    if (tagName === "P") {
      return parseParagraphLike(element);
    }

    if (tagName === "PRE") {
      return parseCodeBlock(element);
    }

    if (tagName === "UL" || tagName === "OL") {
      return [parseList(element)];
    }

    if (tagName === "BLOCKQUOTE") {
      return parseBlockquote(element);
    }

    if (tagName === "TABLE") {
      return parseTable(element);
    }

    if (tagName === "HR") {
      return [{ type: "divider" }];
    }

    if (tagName === "IMG") {
      return parseImage(element);
    }

    if (tagName === "FIGURE") {
      const image = element.querySelector("img");
      if (image) {
        return parseImage(image);
      }
    }

    if (hasStandaloneDescendant(element)) {
      return parseContainerChildren(element);
    }

    if (hasMeaningfulText(element)) {
      return parseParagraphLike(element);
    }

    return [];
  }

  function parseHeading(element) {
    const level = Math.min(Number(element.tagName.slice(1)) || 1, 4);
    const children = parseInlineNodes(Array.from(element.childNodes));

    if (!children.length) {
      return [];
    }

    return [
      {
        type: "heading",
        level,
        children
      }
    ];
  }

  function parseParagraphLike(element) {
    const parts = splitMixedChildNodes(Array.from(element.childNodes));
    const blocks = [];

    for (const part of parts) {
      if (part.type === "inline") {
        const children = parseInlineNodes(part.nodes);
        if (children.length) {
          blocks.push({
            type: "paragraph",
            children
          });
        }
        continue;
      }

      if (part.type === "equation" && part.latex) {
        blocks.push({
          type: "equation",
          latex: part.latex
        });
        continue;
      }

      if (part.type === "block" && part.node) {
        blocks.push(...parseNodeToBlocks(part.node));
      }
    }

    return compactBlocks(blocks);
  }

  function parseCodeBlock(pre) {
    const code = pre.querySelector("code");
    const source = (code?.textContent || pre.textContent || "").replace(/\n+$/, "");

    if (!source.trim()) {
      return [];
    }

    return [
      {
        type: "code",
        language: extractCodeLanguage(code || pre),
        code: source
      }
    ];
  }

  function parseList(element) {
    const ordered = element.tagName === "OL";
    const items = [];

    for (const child of element.children) {
      if (child.tagName !== "LI") {
        continue;
      }

      items.push(parseListItem(child));
    }

    return {
      type: "list",
      ordered,
      items
    };
  }

  function parseListItem(li) {
    const parts = splitMixedChildNodes(Array.from(li.childNodes), {
      treatListsAsStandalone: true
    });

    const children = [];
    const blocks = [];
    let consumedTitle = false;

    for (const part of parts) {
      if (part.type === "inline") {
        const inlineChildren = parseInlineNodes(part.nodes);
        if (inlineChildren.length) {
          children.push(...inlineChildren);
          consumedTitle = true;
        }
        continue;
      }

      if (part.type === "equation" && part.latex) {
        blocks.push({
          type: "equation",
          latex: part.latex
        });
        continue;
      }

      if (part.type === "block" && part.node) {
        const nestedBlocks = parseNodeToBlocks(part.node);

        if (!consumedTitle && nestedBlocks[0]?.type === "paragraph") {
          children.push(...nestedBlocks[0].children);
          blocks.push(...nestedBlocks.slice(1));
          consumedTitle = true;
          continue;
        }

        blocks.push(...nestedBlocks);
      }
    }

    return {
      children: mergeAdjacentText(children),
      blocks: compactBlocks(blocks)
    };
  }

  function parseBlockquote(element) {
    const children = parseInlineNodes(Array.from(element.childNodes));

    if (!children.length) {
      return [];
    }

    return [
      {
        type: "quote",
        children
      }
    ];
  }

  function parseTable(table) {
    const rows = [];
    const rowElements = table.querySelectorAll("tr");

    for (const rowElement of rowElements) {
      const cells = [];

      for (const cell of rowElement.children) {
        if (cell.tagName !== "TD" && cell.tagName !== "TH") {
          continue;
        }

        cells.push({
          isHeader: cell.tagName === "TH",
          children: parseInlineNodes(Array.from(cell.childNodes))
        });
      }

      if (cells.length) {
        rows.push(cells);
      }
    }

    if (!rows.length) {
      return [];
    }

    const hasHeader =
      rows[0].some((cell) => cell.isHeader) || Boolean(table.querySelector("thead"));

    return [
      {
        type: "table",
        rows,
        hasHeader
      }
    ];
  }

  function parseImage(image) {
    const src = image.getAttribute("src");

    if (!src) {
      return [];
    }

    return [
      {
        type: "image",
        src,
        alt: image.getAttribute("alt") || ""
      }
    ];
  }

  function splitMixedChildNodes(nodes, options = {}) {
    const parts = [];
    let inlineNodes = [];

    const flushInline = () => {
      if (!inlineNodes.length) {
        return;
      }

      parts.push({
        type: "inline",
        nodes: inlineNodes
      });
      inlineNodes = [];
    };

    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if ((node.textContent || "").trim()) {
          inlineNodes.push(node);
        }
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const element = node;

      if (shouldSkipElement(element)) {
        continue;
      }

      if (isDisplayMathElement(element)) {
        flushInline();
        parts.push({
          type: "equation",
          latex: extractLatex(element)
        });
        continue;
      }

      if (isStandaloneBlockElement(element, options)) {
        flushInline();
        parts.push({
          type: "block",
          node: element
        });
        continue;
      }

      if (hasDisplayMathDescendant(element) || hasStandaloneDescendant(element, options)) {
        flushInline();
        parts.push(...splitMixedChildNodes(Array.from(element.childNodes), options));
        continue;
      }

      inlineNodes.push(element);
    }

    flushInline();

    return parts;
  }

  function parseInlineNodes(nodes) {
    const parts = [];

    for (const node of nodes) {
      parts.push(...parseInlineNode(node));
    }

    return mergeAdjacentText(parts);
  }

  function parseInlineNode(node) {
    if (!node) {
      return [];
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = collapseWhitespace(node.textContent || "");
      return text ? [{ type: "text", text }] : [];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }

    const element = node;

    if (shouldSkipElement(element)) {
      return [];
    }

    if (isDisplayMathElement(element)) {
      return [];
    }

    if (isInlineMathElement(element)) {
      const latex = extractLatex(element);
      return latex
        ? [
            {
              type: "math",
              latex
            }
          ]
        : [];
    }

    const tagName = element.tagName;

    if (tagName === "BR") {
      return [{ type: "lineBreak" }];
    }

    if (tagName === "CODE" && element.parentElement?.tagName !== "PRE") {
      return [
        {
          type: "code",
          text: element.textContent || ""
        }
      ];
    }

    if (tagName === "STRONG" || tagName === "B") {
      const children = parseInlineNodes(Array.from(element.childNodes));
      return children.length ? [{ type: "bold", children }] : [];
    }

    if (tagName === "EM" || tagName === "I") {
      const children = parseInlineNodes(Array.from(element.childNodes));
      return children.length ? [{ type: "italic", children }] : [];
    }

    if (tagName === "DEL" || tagName === "S" || tagName === "STRIKE") {
      const children = parseInlineNodes(Array.from(element.childNodes));
      return children.length ? [{ type: "strike", children }] : [];
    }

    if (tagName === "A") {
      const href = element.getAttribute("href") || "";
      const children = parseInlineNodes(Array.from(element.childNodes));

      if (!children.length) {
        return [];
      }

      return [
        {
          type: "link",
          href,
          children
        }
      ];
    }

    if (tagName === "IMG") {
      const alt = element.getAttribute("alt") || "";
      return alt ? [{ type: "text", text: alt }] : [];
    }

    return parseInlineNodes(Array.from(element.childNodes));
  }

  function compactBlocks(blocks) {
    return blocks.filter((block) => {
      if (!block) {
        return false;
      }

      if (block.type === "paragraph" || block.type === "heading" || block.type === "quote") {
        return block.children?.length;
      }

      if (block.type === "equation") {
        return Boolean(block.latex);
      }

      if (block.type === "code") {
        return Boolean(block.code);
      }

      if (block.type === "list") {
        return block.items?.length;
      }

      if (block.type === "table") {
        return block.rows?.length;
      }

      if (block.type === "image") {
        return Boolean(block.src);
      }

      return true;
    });
  }

  function mergeAdjacentText(parts) {
    const merged = [];

    for (const part of parts) {
      if (!part) {
        continue;
      }

      const previous = merged[merged.length - 1];

      if (part.type === "text" && previous?.type === "text") {
        previous.text += part.text;
        continue;
      }

      merged.push(part);
    }

    return merged;
  }

  function renderBlocksMarkdown(blocks, indentLevel = 0) {
    const rendered = [];

    for (const block of blocks) {
      const markdown = renderBlockMarkdown(block, indentLevel);
      if (markdown) {
        rendered.push(markdown);
      }
    }

    return rendered.join("\n\n");
  }

  function renderBlockMarkdown(block, indentLevel = 0) {
    if (!block) {
      return "";
    }

    if (block.type === "paragraph") {
      return indentMultiline(renderInlineMarkdown(block.children).trim(), indentLevel);
    }

    if (block.type === "heading") {
      const headingLine = `${"#".repeat(block.level)} ${renderInlineMarkdown(block.children).trim()}`;
      return indentMultiline(headingLine, indentLevel);
    }

    if (block.type === "quote") {
      const content = renderInlineMarkdown(block.children).trim().replace(/<br>/g, "<br>");
      return indentMultiline(`> ${content}`, indentLevel);
    }

    if (block.type === "code") {
      const language = block.language || "";
      const fence = `\`\`\`${language}`.trimEnd();
      return indentMultiline(`${fence}\n${block.code}\n\`\`\``, indentLevel);
    }

    if (block.type === "equation") {
      return indentMultiline(`$$\n${block.latex}\n$$`, indentLevel);
    }

    if (block.type === "divider") {
      return indentMultiline("---", indentLevel);
    }

    if (block.type === "image") {
      const alt = escapeInlineText(block.alt || "");
      return indentMultiline(`![${alt}](${block.src})`, indentLevel);
    }

    if (block.type === "list") {
      return renderListMarkdown(block, indentLevel);
    }

    if (block.type === "table") {
      return indentMultiline(renderTableMarkdown(block), indentLevel);
    }

    return "";
  }

  function renderListMarkdown(block, indentLevel) {
    const lines = [];

    block.items.forEach((item, index) => {
      const marker = block.ordered ? `${index + 1}.` : "-";
      const content = renderInlineMarkdown(item.children).trim();
      lines.push(`${"\t".repeat(indentLevel)}${marker} ${content}`.trimEnd());

      for (const childBlock of item.blocks || []) {
        const childMarkdown = renderBlockMarkdown(childBlock, indentLevel + 1);
        if (childMarkdown) {
          lines.push(childMarkdown);
        }
      }
    });

    return lines.join("\n");
  }

  function renderTableMarkdown(block) {
    const rows = block.rows.map((row) =>
      `| ${row.map((cell) => escapeTableCell(renderInlineMarkdown(cell.children).trim())).join(" | ")} |`
    );

    if (!rows.length) {
      return "";
    }

    const columnCount = block.rows[0].length;
    const separator = `| ${new Array(columnCount).fill("---").join(" | ")} |`;

    if (block.hasHeader) {
      return [rows[0], separator, ...rows.slice(1)].join("\n");
    }

    return [rows[0], separator, ...rows.slice(1)].join("\n");
  }

  function renderInlineMarkdown(children) {
    return children.map(renderInlineMarkdownPart).join("");
  }

  function renderInlineMarkdownPart(part) {
    if (!part) {
      return "";
    }

    if (part.type === "text") {
      return escapeInlineText(part.text);
    }

    if (part.type === "lineBreak") {
      return "<br>";
    }

    if (part.type === "code") {
      return `\`${(part.text || "").replace(/`/g, "\\`")}\``;
    }

    if (part.type === "math") {
      return `$$${part.latex}$$`;
    }

    if (part.type === "bold") {
      return `**${renderInlineMarkdown(part.children)}**`;
    }

    if (part.type === "italic") {
      return `*${renderInlineMarkdown(part.children)}*`;
    }

    if (part.type === "strike") {
      return `~~${renderInlineMarkdown(part.children)}~~`;
    }

    if (part.type === "link") {
      return `[${renderInlineMarkdown(part.children)}](${part.href})`;
    }

    return "";
  }

  function renderBlocksHtml(blocks) {
    return blocks.map(renderBlockHtml).join("");
  }

  function renderBlockHtml(block) {
    if (!block) {
      return "";
    }

    if (block.type === "paragraph") {
      return `<p>${renderInlineHtml(block.children)}</p>`;
    }

    if (block.type === "heading") {
      return `<h${block.level}>${renderInlineHtml(block.children)}</h${block.level}>`;
    }

    if (block.type === "quote") {
      return `<blockquote>${renderInlineHtml(block.children)}</blockquote>`;
    }

    if (block.type === "code") {
      const language = escapeHtml(block.language || "");
      return `<pre data-language="${language}"><code>${escapeHtml(block.code)}</code></pre>`;
    }

    if (block.type === "equation") {
      return `<div data-chatgpt-to-notion-math="block"><pre>$$\n${escapeHtml(block.latex)}\n$$</pre></div>`;
    }

    if (block.type === "divider") {
      return "<hr>";
    }

    if (block.type === "image") {
      return `<img src="${escapeAttribute(block.src)}" alt="${escapeAttribute(block.alt || "")}">`;
    }

    if (block.type === "list") {
      const tagName = block.ordered ? "ol" : "ul";
      const items = block.items
        .map((item) => {
          const content = renderInlineHtml(item.children);
          const children = renderBlocksHtml(item.blocks || []);
          return `<li>${content}${children}</li>`;
        })
        .join("");

      return `<${tagName}>${items}</${tagName}>`;
    }

    if (block.type === "table") {
      const rows = block.rows
        .map((row, rowIndex) => {
          const cells = row
            .map((cell) => {
              const tagName = block.hasHeader && rowIndex === 0 ? "th" : "td";
              return `<${tagName}>${renderInlineHtml(cell.children)}</${tagName}>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");

      return `<table>${rows}</table>`;
    }

    return "";
  }

  function renderInlineHtml(children) {
    return children.map(renderInlineHtmlPart).join("");
  }

  function renderInlineHtmlPart(part) {
    if (!part) {
      return "";
    }

    if (part.type === "text") {
      return escapeHtml(part.text);
    }

    if (part.type === "lineBreak") {
      return "<br>";
    }

    if (part.type === "code") {
      return `<code>${escapeHtml(part.text || "")}</code>`;
    }

    if (part.type === "math") {
      return `<span data-chatgpt-to-notion-math="inline">${escapeHtml(`$$${part.latex}$$`)}</span>`;
    }

    if (part.type === "bold") {
      return `<strong>${renderInlineHtml(part.children)}</strong>`;
    }

    if (part.type === "italic") {
      return `<em>${renderInlineHtml(part.children)}</em>`;
    }

    if (part.type === "strike") {
      return `<s>${renderInlineHtml(part.children)}</s>`;
    }

    if (part.type === "link") {
      return `<a href="${escapeAttribute(part.href)}">${renderInlineHtml(part.children)}</a>`;
    }

    return "";
  }

  function shouldSkipElement(element) {
    if (!element) {
      return true;
    }

    return (
      element.matches("button, svg, path, textarea, input, select") ||
      element.closest("[data-chatgpt-to-notion-button]") !== null ||
      element.getAttribute("aria-hidden") === "true"
    );
  }

  function isStandaloneBlockElement(element, options = {}) {
    if (!element) {
      return false;
    }

    if (isDisplayMathElement(element)) {
      return true;
    }

    if (!BLOCK_TAGS.has(element.tagName)) {
      return false;
    }

    if ((element.tagName === "UL" || element.tagName === "OL") && options.treatListsAsStandalone === false) {
      return false;
    }

    return true;
  }

  function hasStandaloneDescendant(element, options = {}) {
    if (!element || !element.querySelector) {
      return false;
    }

    const selector = ".katex-display, p, pre, ul, ol, table, blockquote, hr, h1, h2, h3, h4, h5, h6, figure, img";
    const descendants = element.querySelectorAll(selector);

    for (const descendant of descendants) {
      if (descendant === element) {
        continue;
      }

      if (isStandaloneBlockElement(descendant, options)) {
        return true;
      }
    }

    return false;
  }

  function hasDisplayMathDescendant(element) {
    return Boolean(element?.querySelector?.(".katex-display"));
  }

  function isDisplayMathElement(element) {
    return Boolean(
      element &&
        element.nodeType === Node.ELEMENT_NODE &&
        (element.classList.contains("katex-display") ||
          element.matches("[data-testid='display-math'], [data-display='true']"))
    );
  }

  function isInlineMathElement(element) {
    return Boolean(
      element &&
        element.nodeType === Node.ELEMENT_NODE &&
        (element.classList.contains("katex") || element.matches("[data-testid='inline-math']")) &&
        !element.closest(".katex-display")
    );
  }

  function hasMeaningfulText(element) {
    const text = collapseWhitespace(element.textContent || "");
    return Boolean(text.trim());
  }

  function extractLatex(element) {
    const annotation = element.querySelector("annotation[encoding='application/x-tex']");
    const source =
      annotation?.textContent ||
      element.getAttribute("data-latex") ||
      element.getAttribute("aria-label") ||
      "";

    return normalizeLatex(source);
  }

  function normalizeLatex(source) {
    let latex = (source || "").trim();

    if (!latex) {
      return "";
    }

    latex = latex.replace(/^\\\((.*)\\\)$/s, "$1").replace(/^\\\[(.*)\\\]$/s, "$1");

    return latex.trim();
  }

  function extractCodeLanguage(element) {
    const classNames = [element.className || "", element.getAttribute("data-language") || ""].join(" ");
    const match = classNames.match(/language-([A-Za-z0-9_+-]+)/);
    return match?.[1] || "";
  }

  function collapseWhitespace(text) {
    return text.replace(/\s+/g, " ");
  }

  function escapeInlineText(text) {
    return (text || "").replace(/([\\*~`\$\[\]<>|^{}])/g, "\\$1");
  }

  function escapeTableCell(text) {
    return text.replace(/\|/g, "\\|");
  }

  function indentMultiline(text, indentLevel) {
    const indent = "\t".repeat(indentLevel);
    return text
      .split("\n")
      .map((line) => `${indent}${line}`)
      .join("\n");
  }

  function escapeHtml(text) {
    return (text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeAttribute(text) {
    return escapeHtml(text);
  }

  window.ChatGPTToNotionConverter = {
    convertMessage
  };
})();
