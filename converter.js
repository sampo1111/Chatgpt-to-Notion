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
  const CODE_LANGUAGE_LABELS = new Set((
    "abap|arduino|bash|basic|c|clojure|coffeescript|c++|c#|css|dart|diff|docker|elixir|elm|erlang|flow|fortran|f#|gherkin|glsl|go|graphql|groovy|haskell|html|java|javascript|json|julia|kotlin|latex|less|lisp|livescript|lua|makefile|markdown|markup|matlab|mermaid|nix|objective-c|ocaml|pascal|perl|php|plain text|powershell|prolog|protobuf|python|r|reason|ruby|rust|sass|scala|scheme|scss|shell|sql|swift|typescript|vb.net|verilog|vhdl|visual basic|webassembly|xml|yaml|java/c/c++/c#|js|jsx|ts|tsx|py|sh|md|cpp|csharp|cs|fsharp|fs|rb|rs|golang|yml|dockerfile|shellscript|text|plaintext|txt|ps1|objectivec|objc|tex|rscript"
  ).split("|"));

  function convertMessage(root) {
    const blocks = parseContainerChildren(root);
    return {
      blocks,
      markdown: renderBlocksMarkdown(blocks).trim(),
      html: renderBlocksHtml(blocks).trim()
    };
  }

  function convertFragment(root) {
    const blocks = parseSelectionContainer(root);
    return {
      blocks,
      markdown: renderBlocksMarkdown(blocks).trim(),
      html: renderBlocksHtml(blocks).trim()
    };
  }

  function convertMathElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const latex = extractLatex(element);
    if (!latex) {
      return null;
    }

    const blocks = isDisplayMathElement(element)
      ? [{ type: "equation", latex }]
      : [
          {
            type: "paragraph",
            children: [{ type: "math", latex }]
          }
        ];

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

  function parseSelectionContainer(container) {
    if (!container) {
      return [];
    }

    return compactBlocks(parseParagraphLike(container));
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

      const displayLatex = extractStandaloneDisplayLatex(text);
      if (displayLatex) {
        return [
          {
            type: "equation",
            latex: displayLatex
          }
        ];
      }

      return [
        {
          type: "paragraph",
          children: splitInlineMathText(text)
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

    const codeContainer = findCodeContainer(element);
    if (codeContainer) {
      return parseCodeBlock(codeContainer);
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
    const clone = code ? null : pre.cloneNode(true);
    if (clone) {
      codeHeader(clone)?.element.remove();
      clone.querySelectorAll("button, svg, [aria-hidden='true']").forEach(node => node.remove());
    }
    const source = (code?.textContent ?? clone.textContent ?? "").replace(/\n+$/, "");

    if (!source.trim()) {
      return [];
    }

    return [
      {
        type: "code",
        language: extractCodeLanguage(pre),
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

      if (isStandaloneBlockElement(element, options) || findCodeContainer(element)) {
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
      return text ? splitInlineMathText(text) : [];
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
    return normalizeBlocks(blocks).filter((block) => {
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

  function normalizeBlocks(blocks) {
    const normalized = [];

    for (const block of blocks || []) {
      normalized.push(...normalizeBlock(block));
    }

    return normalized;
  }

  function normalizeBlock(block) {
    if (!block) {
      return [];
    }

    if (block.type !== "list") {
      return [block];
    }

    return normalizeListBlock(block);
  }

  function normalizeListBlock(block) {
    if (isStructurallyEmptyListBlock(block)) {
      return [createBulletRunParagraph(countStructurallyEmptyListItems(block), block.ordered)];
    }

    const normalizedItems = [];

    for (const item of block.items || []) {
      const normalizedChildren = mergeAdjacentText(item.children || []);
      const normalizedBlocks = compactBlocks(item.blocks || []);
      const listBlocks = normalizedBlocks.filter((childBlock) => childBlock.type === "list");
      const nonListBlocks = normalizedBlocks.filter((childBlock) => childBlock.type !== "list");

      if (
        !hasMeaningfulInlineChildren(normalizedChildren) &&
        !nonListBlocks.length &&
        listBlocks.length === 1 &&
        listBlocks[0].ordered === block.ordered
      ) {
        normalizedItems.push(...listBlocks[0].items);
        continue;
      }

      normalizedItems.push({
        children: normalizedChildren,
        blocks: normalizedBlocks
      });
    }

    return [
      {
        ...block,
        items: normalizedItems.filter(
          (item) => hasMeaningfulInlineChildren(item.children) || item.blocks?.length
        )
      }
    ];
  }

  function hasMeaningfulInlineChildren(children) {
    for (const child of children || []) {
      if (!child) {
        continue;
      }

      if (child.type === "text") {
        if ((child.text || "").trim()) {
          return true;
        }
        continue;
      }

      if (child.type === "lineBreak") {
        continue;
      }

      if (child.children && hasMeaningfulInlineChildren(child.children)) {
        return true;
      }

      return true;
    }

    return false;
  }

  function isStructurallyEmptyListBlock(block) {
    return (
      block?.type === "list" &&
      Array.isArray(block.items) &&
      block.items.length > 0 &&
      block.items.every(isStructurallyEmptyListItem)
    );
  }

  function isStructurallyEmptyListItem(item) {
    if (hasMeaningfulInlineChildren(item?.children)) {
      return false;
    }

    const childBlocks = item?.blocks || [];
    const nonListBlocks = childBlocks.filter((block) => block.type !== "list");

    if (nonListBlocks.length) {
      return false;
    }

    return childBlocks.every(isStructurallyEmptyListBlock);
  }

  function countStructurallyEmptyListItems(block) {
    let count = 0;

    for (const item of block.items || []) {
      count += 1;

      for (const childBlock of item.blocks || []) {
        if (childBlock.type === "list") {
          count += countStructurallyEmptyListItems(childBlock);
        }
      }
    }

    return count;
  }

  function createBulletRunParagraph(count, ordered) {
    const safeCount = Math.max(Number(count) || 0, 1);
    const text = ordered
      ? Array.from({ length: safeCount }, (_, index) => `${index + 1}.`).join(" ")
      : Array.from({ length: safeCount }, () => "•").join(" ");

    return {
      type: "paragraph",
      children: [{ type: "text", text }]
    };
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

  const SOURCE_CITATION_SELECTOR = [
    "[data-testid*='citation']", "[data-test-id*='citation']", "[data-citation]", "[data-citation-id]", "[data-citation-index]",
    "[data-testid='sources-footer']", "[data-testid='sources-button']", "[data-testid='source-list']", "[data-testid='source-chip']",
    ".citation", ".citation-container", ".citation-marker", ".file-citation", ".source-chip", ".source-pill", "[class~='group/citation']"
  ].join(", ");

  function isSourceCitationElement(element) {
    if (!element?.closest || element.closest("pre, code")) return false;
    if (element.closest(SOURCE_CITATION_SELECTOR)) return true;
    const chip = element.closest("[role='button'], [aria-haspopup], [tabindex], [class*='rounded-full']");
    if (!chip || chip.querySelector("p, ul, ol, pre, table, h1, h2, h3, h4, [data-d-component='grid']")) return false;
    const text = (chip.textContent || "").trim();
    return text.length <= 500 && /\.(?:pdf|docx?|pptx?|xlsx?|csv|txt)(?:\s*\+\s*\d+)?$/i.test(text) &&
      Boolean(chip.querySelector("svg, img") || chip.hasAttribute("aria-haspopup"));
  }

  function shouldSkipElement(element) {
    if (!element) {
      return true;
    }

    if (isSourceCitationElement(element)) return true;

    if (hasMathSignal(element)) {
      return false;
    }

    return (
      element.matches("button, svg, path, textarea, input, select") ||
      element.closest("[data-chatgpt-to-notion-button]") !== null ||
      element.getAttribute("aria-hidden") === "true"
    );
  }

  function hasMathSignal(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    return Boolean(
      element.classList?.contains("katex") ||
        element.classList?.contains("katex-display") ||
        element.classList?.contains("math") ||
        element.classList?.contains("math-inline") ||
        element.classList?.contains("math-display") ||
        element.matches?.(
          "mjx-container, math, annotation[encoding='application/x-tex'], annotation[encoding='application/x-tex; mode=display'], script[type^='math/tex'], [data-latex], [data-tex], [data-math], [data-testid='inline-math'], [data-testid='display-math'], [data-math-style='display']"
        ) ||
        element.querySelector?.(
          "annotation[encoding='application/x-tex'], annotation[encoding='application/x-tex; mode=display'], script[type^='math/tex'], [data-latex], [data-tex], [data-math]"
        )
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

    const selector = [
      ".katex-display",
      ".math-display",
      "mjx-container[display='true']",
      "math[display='block']",
      "math[display='true']",
      "script[type='math/tex; mode=display']",
      "script[type='math/tex'][mode='display']",
      "[data-math-style='display']",
      "p",
      "pre",
      "ul",
      "ol",
      "table",
      "blockquote",
      "hr",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "figure",
      "img"
    ].join(", ");
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
    return Boolean(
      element?.querySelector?.(
        ".katex-display, .math-display, mjx-container[display='true'], math[display='block'], math[display='true'], script[type='math/tex; mode=display'], script[type='math/tex'][mode='display'], [data-math-style='display']"
      )
    );
  }

  function isDisplayMathElement(element) {
    return Boolean(
      element &&
        element.nodeType === Node.ELEMENT_NODE &&
        (element.classList.contains("katex-display") ||
          element.classList.contains("math-display") ||
          element.matches(
            "[data-testid='display-math'], [data-display='true'], [data-math-style='display'], mjx-container[display='true'], math[display='block'], math[display='true'], script[type='math/tex; mode=display'], script[type='math/tex'][mode='display']"
          ))
    );
  }

  function isInlineMathElement(element) {
    return Boolean(
      element &&
        element.nodeType === Node.ELEMENT_NODE &&
        (element.classList.contains("katex") ||
          element.classList.contains("math") ||
          element.classList.contains("math-inline") ||
          element.matches("[data-testid='inline-math'], mjx-container, math, script[type^='math/tex'], [data-latex], [data-tex], [data-math]")) &&
        !element.closest(".katex-display, .math-display, mjx-container[display='true'], math[display='block'], math[display='true'], script[type='math/tex; mode=display'], script[type='math/tex'][mode='display'], [data-math-style='display']")
    );
  }

  function hasMeaningfulText(element) {
    const text = collapseWhitespace(element.textContent || "");
    return Boolean(text.trim());
  }

  function extractLatex(element) {
    const annotationSelector =
      "annotation[encoding='application/x-tex'], annotation[encoding='application/x-tex; mode=display']";
    const annotation = element.matches?.(annotationSelector) ? element : element.querySelector(annotationSelector);
    const mathElement =
      element.matches?.("math") ? element : element.querySelector?.("math");
    const sourceSelector =
      "[data-chatgpt-to-notion-latex], [data-latex], [data-tex], [data-math]";
    const sourceElement = element.matches?.(sourceSelector)
      ? element
      : element.querySelector?.(sourceSelector);
    const trustedCandidates = [
      annotation?.textContent,
      element.getAttribute("data-chatgpt-to-notion-latex"),
      element.getAttribute("data-latex"),
      element.getAttribute("data-tex"),
      element.getAttribute("data-math"),
      sourceElement?.getAttribute("data-chatgpt-to-notion-latex"),
      sourceElement?.getAttribute("data-latex"),
      sourceElement?.getAttribute("data-tex"),
      sourceElement?.getAttribute("data-math"),
      element.matches?.("script[type^='math/tex']") ? element.textContent : "",
      mathElement ? convertMathMlToLatex(mathElement) : ""
    ];

    for (const candidate of trustedCandidates) {
      const latex = normalizeLatex(candidate);
      if (latex) {
        return latex;
      }
    }

    const labelCandidates = [
      element.getAttribute("alttext"),
      element.getAttribute("title"),
      element.getAttribute("aria-label")
    ];

    for (const candidate of labelCandidates) {
      const latex = normalizeLatex(candidate);
      if (looksLikeLatex(latex)) {
        return latex;
      }
    }

    if (element.matches(".katex, .katex-display") || element.querySelector(".katex")) {
      const error = new Error("A rendered formula has no recoverable source.");
      error.code = "MATH_SOURCE_UNAVAILABLE";
      throw error;
    }
    return "";
  }

  function normalizeLatex(source) {
    let latex = (source || "")
      .replace(/:?contentReference\[oaicite:\s*\d+\]\{index\s*=\s*\d+\}/g, "")
      .trim();

    if (!latex) {
      return "";
    }

    latex = latex
      .replace(/^LaTeX:\s*/i, "")
      .replace(/^\\\((.*)\\\)$/s, "$1")
      .replace(/^\\\[(.*)\\\]$/s, "$1")
      .replace(/^\$\$(.*)\$\$$/s, "$1")
      .replace(/^\$(.*)\$$/s, "$1");

    latex = latex.trim();
    return /contentReference\[oaicite:|\\(?:[dt]?frac|[dt]?binom|sqrt|boxed)\s*$/.test(latex) ? "" : latex;
  }

  function extractStandaloneDisplayLatex(text) {
    const trimmed = (text || "").trim();
    const match = trimmed.match(/^\\\[((?:.|\n)+)\\\]$/) || trimmed.match(/^\$\$((?:.|\n)+)\$\$$/);
    return match ? normalizeLatex(match[0]) : "";
  }

  function splitInlineMathText(text) {
    const parts = [];
    const source = text || "";
    // Single dollars in rendered prose can be currency, not math delimiters.
    const pattern = /(\\\((.+?)\\\)|\\\[((?:.|\n)+?)\\\]|\$\$((?:.|\n)+?)\$\$)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: "text", text: source.slice(lastIndex, match.index) });
      }

      const latex = normalizeLatex(match[0]);
      if (latex) {
        parts.push({ type: "math", latex });
      }

      lastIndex = pattern.lastIndex;
    }

    if (lastIndex < source.length) {
      parts.push({ type: "text", text: source.slice(lastIndex) });
    }

    return parts.length ? parts : [{ type: "text", text: source }];
  }

  function looksLikeLatex(source) {
    const text = source || "";
    return /\\[A-Za-z]+|[_^{}]|\d+\s*[=+\-*/]\s*\d+|[A-Za-z]\s*[=+\-*/]\s*[A-Za-z0-9]/.test(text);
  }

  function convertMathMlToLatex(node) {
    if (!node) {
      return "";
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return normalizeMathText(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }

    const element = node;
    const tagName = element.tagName.toLowerCase();
    const children = Array.from(element.childNodes).map(convertMathMlToLatex).filter(Boolean);

    if (tagName === "math" || tagName === "mrow" || tagName === "semantics" || tagName === "mstyle") {
      return joinLatexChildren(children);
    }

    if (tagName === "annotation") {
      return element.getAttribute("encoding")?.includes("tex") ? element.textContent || "" : "";
    }

    if (tagName === "mi" || tagName === "mn" || tagName === "mtext") {
      return normalizeMathText(element.textContent || "");
    }

    if (tagName === "mo") {
      return normalizeMathOperator(element.textContent || "");
    }

    if (tagName === "msup") {
      return `${wrapLatexAtom(children[0])}^{${children[1] || ""}}`;
    }

    if (tagName === "msub") {
      return `${wrapLatexAtom(children[0])}_{${children[1] || ""}}`;
    }

    if (tagName === "msubsup") {
      return `${wrapLatexAtom(children[0])}_{${children[1] || ""}}^{${children[2] || ""}}`;
    }

    if (tagName === "mfrac") {
      return `\\frac{${children[0] || ""}}{${children[1] || ""}}`;
    }

    if (tagName === "msqrt") {
      return `\\sqrt{${joinLatexChildren(children)}}`;
    }

    if (tagName === "mroot") {
      return `\\sqrt[${children[1] || ""}]{${children[0] || ""}}`;
    }

    if (tagName === "mover") {
      return `\\overset{${children[1] || ""}}{${children[0] || ""}}`;
    }

    if (tagName === "munder") {
      return `\\underset{${children[1] || ""}}{${children[0] || ""}}`;
    }

    if (tagName === "munderover") {
      return `\\overset{${children[2] || ""}}{\\underset{${children[1] || ""}}{${children[0] || ""}}}`;
    }

    if (tagName === "mtable") {
      return children.join(" \\\\ ");
    }

    if (tagName === "mtr") {
      return children.join(" & ");
    }

    if (tagName === "mtd") {
      return joinLatexChildren(children);
    }

    return joinLatexChildren(children) || normalizeMathText(element.textContent || "");
  }

  function normalizeMathText(text) {
    return (text || "")
      .replace(/\u2212/g, "-")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function normalizeMathOperator(text) {
    const operator = normalizeMathText(text);
    const operators = {
      "\u00d7": "\\times",
      "\u00f7": "\\div",
      "\u2260": "\\ne",
      "\u2264": "\\le",
      "\u2265": "\\ge",
      "\u2248": "\\approx",
      "\u221e": "\\infty",
      "\u2211": "\\sum",
      "\u220f": "\\prod",
      "\u222b": "\\int",
      "\u2208": "\\in",
      "\u2209": "\\notin",
      "\u2282": "\\subset",
      "\u2286": "\\subseteq",
      "\u2229": "\\cap",
      "\u222a": "\\cup",
      "\u2192": "\\to",
      "\u21d2": "\\Rightarrow",
      "\u223c": "\\sim",
      "\u03b1": "\\alpha",
      "\u03b2": "\\beta",
      "\u03b3": "\\gamma",
      "\u03b4": "\\delta",
      "\u03b5": "\\epsilon",
      "\u03b8": "\\theta",
      "\u03bb": "\\lambda",
      "\u03bc": "\\mu",
      "\u03c0": "\\pi",
      "\u03c1": "\\rho",
      "\u03c3": "\\sigma",
      "\u03c4": "\\tau",
      "\u03c6": "\\phi",
      "\u03c9": "\\omega"
    };

    return operators[operator] || operator;
  }

  function joinLatexChildren(children) {
    return (children || [])
      .filter(Boolean)
      .join(" ")
      .replace(/\s+([,.;:)])/g, "$1")
      .replace(/([({])\s+/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function wrapLatexAtom(source) {
    const latex = source || "";
    return /^[A-Za-z0-9\\]+$/.test(latex) ? latex : `{${latex}}`;
  }

  function codeHeader(container) {
    const first = container.firstElementChild;
    if (!first || first.matches("pre, code, p, h1, h2, h3, h4, h5, h6") || first.querySelector("pre, code")) return null;
    const clone = first.cloneNode(true);
    clone.querySelectorAll("button, svg, [hidden], [aria-hidden='true']").forEach(node => node.remove());
    const label = (clone.textContent || "").trim().toLowerCase();
    return CODE_LANGUAGE_LABELS.has(label) ? { element: first, language: label } : null;
  }

  function findCodeContainer(element) {
    if (!element.matches("div, section, figure, code-block")) return null;
    const pres = element.querySelectorAll("pre");
    if (pres.length !== 1) return null;
    // ChatGPT's code surface contains deeply nested scroll panes and controls.
    if (element.matches("[data-markdown-copy='code-block']")) return pres[0];
    if (!codeHeader(element)) return null;
    // Only consume a toolbar plus one code area, never the surrounding answer.
    const rest = Array.from(element.children).slice(1);
    if (rest.length !== 1 || !(rest[0] === pres[0] || rest[0].contains(pres[0]))) return null;
    for (let area = rest[0]; area !== pres[0]; area = area.firstElementChild) {
      if (area.children.length !== 1 || Array.from(area.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) return null;
    }
    return pres[0];
  }

  function extractCodeLanguage(pre) {
    const code = pre.querySelector("code");
    const surface = pre.closest("[data-markdown-copy='code-block']");
    for (const element of [code, pre, surface]) {
      if (!element) continue;
      for (const attribute of ["data-language", "data-lang", "lang"]) {
        const value = element.getAttribute(attribute)?.trim();
        if (value) return value.replace(/^(?:language|lang)-/i, "").toLowerCase();
      }
      const match = (element.getAttribute("class") || "").match(/(?:^|\s)(?:language|lang)-([^\s]+)/i);
      if (match) return match[1].toLowerCase();
    }
    const header = codeHeader(pre) || (surface && codeHeader(surface));
    if (header) return header.language;
    for (let parent = pre.parentElement, depth = 0; parent && depth < 3; parent = parent.parentElement, depth++) {
      if (findCodeContainer(parent) === pre) return codeHeader(parent).language;
    }
    return "";
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
    convertMessage,
    convertFragment,
    convertMathElement,
    isSourceCitationElement
  };
})();
