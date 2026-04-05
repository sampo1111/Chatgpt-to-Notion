const SETTINGS_KEY = "chatgptToNotionSettings";
const LAST_COPY_KEY = "chatgptToNotionLastCopy";
const NOTION_VERSION = "2026-03-11";
const TEXT_CHUNK_SIZE = 2000;
const CHILDREN_CHUNK_SIZE = 20;
const REQUEST_BODY_SOFT_LIMIT_BYTES = 120000;
const DEFAULT_ANNOTATIONS = {
  bold: false,
  italic: false,
  strikethrough: false,
  underline: false,
  code: false,
  color: "default"
};
const SUPPORTED_CODE_LANGUAGES = new Set([
  "abap",
  "arduino",
  "bash",
  "basic",
  "c",
  "clojure",
  "coffeescript",
  "c++",
  "c#",
  "css",
  "dart",
  "diff",
  "docker",
  "elixir",
  "elm",
  "erlang",
  "flow",
  "fortran",
  "f#",
  "gherkin",
  "glsl",
  "go",
  "graphql",
  "groovy",
  "haskell",
  "html",
  "java",
  "javascript",
  "json",
  "julia",
  "kotlin",
  "latex",
  "less",
  "lisp",
  "livescript",
  "lua",
  "makefile",
  "markdown",
  "markup",
  "matlab",
  "mermaid",
  "nix",
  "objective-c",
  "ocaml",
  "pascal",
  "perl",
  "php",
  "plain text",
  "powershell",
  "prolog",
  "protobuf",
  "python",
  "r",
  "reason",
  "ruby",
  "rust",
  "sass",
  "scala",
  "scheme",
  "scss",
  "shell",
  "sql",
  "swift",
  "typescript",
  "vb.net",
  "verilog",
  "vhdl",
  "visual basic",
  "webassembly",
  "xml",
  "yaml",
  "java/c/c++/c#"
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      console.error("ChatGPT to Notion background error", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "saveNotionSettings":
      return saveNotionSettings(message.token || "");
    case "getNotionSettings":
      return getNotionSettings();
    case "testNotionConnection":
      return testNotionConnection(message.token);
    case "appendBlocksToNotionPage":
      return appendBlocksToNotionPage({
        pageId: message.pageId,
        blocks: message.blocks,
        anchorBlockId: message.anchorBlockId
      });
    case "appendStoredBlocksToNotionPage":
      return appendStoredBlocksToNotionPage(message.pageId, message.anchorBlockId);
    case "getLastCopySummary":
      return getLastCopySummary();
    default:
      throw new Error("Unsupported message type");
  }
}

async function saveNotionSettings(token) {
  const trimmedToken = token.trim();

  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      notionToken: trimmedToken
    }
  });

  return {
    saved: true,
    hasToken: Boolean(trimmedToken)
  };
}

async function getNotionSettings() {
  const settings = await readSettings();
  return {
    hasToken: Boolean(settings.notionToken),
    maskedToken: maskToken(settings.notionToken)
  };
}

async function testNotionConnection(tokenOverride) {
  const settings = await readSettings();
  const token = (tokenOverride || settings.notionToken || "").trim();

  if (!token) {
    throw new Error("Save a Notion integration token first.");
  }

  const bot = await notionFetch("/users/me", {
    method: "GET",
    token
  });

  return {
    hasToken: true,
    botName: bot?.name || "Connected",
    botType: bot?.type || "bot"
  };
}

async function appendStoredBlocksToNotionPage(pageId, anchorBlockId) {
  const stored = await chrome.storage.local.get([LAST_COPY_KEY]);
  const lastCopy = stored[LAST_COPY_KEY];

  if (!lastCopy?.blocks?.length) {
    throw new Error("No captured ChatGPT reply found. Copy from ChatGPT first.");
  }

  return appendBlocksToNotionPage({
    pageId,
    blocks: lastCopy.blocks,
    anchorBlockId
  });
}

async function appendBlocksToNotionPage({ pageId, blocks, anchorBlockId }) {
  if (!pageId) {
    throw new Error("Could not detect the current Notion page.");
  }

  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new Error("No blocks were provided.");
  }

  const settings = await readSettings();
  const token = (settings.notionToken || "").trim();

  if (!token) {
    throw new Error("No Notion token is saved. Open the extension popup and add one.");
  }

  const normalizedPageId = normalizeNotionId(pageId);
  const children = blocksToNotionChildren(blocks);
  const appendTarget = await resolveAppendTarget({
    pageId: normalizedPageId,
    anchorBlockId,
    token
  });

  if (!children.length) {
    throw new Error("There was nothing to send to Notion.");
  }

  let afterBlockId = appendTarget.afterBlockId;
  const parentId = appendTarget.parentId;

  for (const childChunk of buildAppendChunks(children, parentId, afterBlockId)) {
    const appendResult = await appendChunkWithRetry({
      parentId,
      afterBlockId,
      childChunk,
      token
    });
    afterBlockId = appendResult.lastInsertedId || null;
  }

  return {
    appendedBlocks: children.length,
    pageId: normalizedPageId,
    parentId,
    anchorBlockId: appendTarget.anchorBlockId || null
  };
}

async function getLastCopySummary() {
  const stored = await chrome.storage.local.get([LAST_COPY_KEY]);
  const lastCopy = stored[LAST_COPY_KEY];

  return {
    hasLastCopy: Boolean(lastCopy?.blocks?.length),
    copiedAt: lastCopy?.copiedAt || null,
    blockCount: lastCopy?.blocks?.length || 0
  };
}

async function notionFetch(path, options) {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${options.token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.message || data?.code || response.statusText;
    throw new Error(`Notion API error: ${detail}`);
  }

  return data;
}

async function readSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  return stored[SETTINGS_KEY] || {};
}

async function resolveAppendTarget({ pageId, anchorBlockId, token }) {
  if (!anchorBlockId) {
    return {
      parentId: pageId,
      afterBlockId: null,
      anchorBlockId: null
    };
  }

  const normalizedAnchorBlockId = normalizeNotionId(anchorBlockId);

  try {
    const block = await notionFetch(`/blocks/${normalizedAnchorBlockId}`, {
      method: "GET",
      token
    });

    const parentId = parentObjectToId(block?.parent) || pageId;

    return {
      parentId,
      afterBlockId: normalizedAnchorBlockId,
      anchorBlockId: normalizedAnchorBlockId
    };
  } catch (error) {
    console.warn("Falling back to page-end append because anchor block lookup failed.", error);
    return {
      parentId: pageId,
      afterBlockId: null,
      anchorBlockId: null
    };
  }
}

function blocksToNotionChildren(blocks) {
  const output = [];

  for (const block of blocks) {
    output.push(...blockToNotionBlocks(block));
  }

  return output;
}

function createAppendBody(children, afterBlockId) {
  return {
    children,
    ...(afterBlockId
      ? {
          position: {
            type: "after_block",
            after_block: {
              id: afterBlockId
            }
          }
        }
      : {})
  };
}

async function appendChunkWithRetry({ parentId, afterBlockId, childChunk, token }) {
  try {
    const response = await notionFetch(`/blocks/${parentId}/children`, {
      method: "PATCH",
      token,
      body: createAppendBody(childChunk, afterBlockId)
    });

    return {
      response,
      lastInsertedId: response?.results?.[response.results.length - 1]?.id || afterBlockId || null
    };
  } catch (error) {
    if (!isRequestBodyTooLargeError(error) || childChunk.length <= 1) {
      throw error;
    }

    const midpoint = Math.ceil(childChunk.length / 2);
    const firstHalf = childChunk.slice(0, midpoint);
    const secondHalf = childChunk.slice(midpoint);

    const firstResult = await appendChunkWithRetry({
      parentId,
      afterBlockId,
      childChunk: firstHalf,
      token
    });

    if (!secondHalf.length) {
      return firstResult;
    }

    return appendChunkWithRetry({
      parentId,
      afterBlockId: firstResult.lastInsertedId,
      childChunk: secondHalf,
      token
    });
  }
}

function buildAppendChunks(children, parentId, initialAfterBlockId) {
  const chunks = [];
  let currentChunk = [];
  let currentAfterBlockId = initialAfterBlockId;

  for (const child of children) {
    if (!currentChunk.length) {
      currentChunk.push(child);
      continue;
    }

    const candidateChunk = [...currentChunk, child];
    const body = createAppendBody(candidateChunk, currentAfterBlockId);
    const estimatedBytes = byteLengthUtf8(
      JSON.stringify({
        parentId,
        body
      })
    );

    if (
      candidateChunk.length > CHILDREN_CHUNK_SIZE ||
      estimatedBytes > REQUEST_BODY_SOFT_LIMIT_BYTES
    ) {
      chunks.push(currentChunk);
      currentChunk = [child];
      currentAfterBlockId = null;
      continue;
    }

    currentChunk = candidateChunk;
  }

  if (currentChunk.length) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function blockToNotionBlocks(block) {
  if (!block) {
    return [];
  }

  switch (block.type) {
    case "paragraph":
      return [createRichTextBlock("paragraph", block.children)];
    case "heading":
      return [createHeadingBlock(block.level, block.children)];
    case "quote":
      return [createRichTextBlock("quote", block.children)];
    case "code":
      return [createCodeBlock(block)];
    case "equation":
      return [
        {
          object: "block",
          type: "equation",
          equation: {
            expression: block.latex || ""
          }
        }
      ];
    case "divider":
      return [
        {
          object: "block",
          type: "divider",
          divider: {}
        }
      ];
    case "image":
      return [createImageFallbackBlock(block)];
    case "list":
      return block.items.flatMap((item) => createListItemBlock(block.ordered, item));
    case "table":
      return [createTableFallbackBlock(block)];
    default:
      return [];
  }
}

function createRichTextBlock(type, children) {
  return {
    object: "block",
    type,
    [type]: {
      rich_text: inlineChildrenToRichText(children),
      color: "default"
    }
  };
}

function createHeadingBlock(level, children) {
  const headingLevel = Number(level) >= 4 ? 4 : Math.max(Number(level) || 1, 1);
  const type = `heading_${headingLevel}`;

  return {
    object: "block",
    type,
    [type]: {
      rich_text: inlineChildrenToRichText(children),
      color: "default",
      is_toggleable: false
    }
  };
}

function createCodeBlock(block) {
  const language = normalizeCodeLanguage(block.language || "");
  return {
    object: "block",
    type: "code",
    code: {
      rich_text: chunkTextRichText(block.code || ""),
      caption: [],
      language
    }
  };
}

function createImageFallbackBlock(block) {
  const parts = [];

  if (block.alt) {
    parts.push(block.alt);
  }

  if (block.src) {
    parts.push(block.src);
  }

  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: chunkTextRichText(parts.join(" ").trim() || "Image omitted."),
      color: "default"
    }
  };
}

function createTableFallbackBlock(block) {
  const lines = [];

  for (const row of block.rows || []) {
    const cells = row.map((cell) => inlineChildrenToPlainText(cell.children));
    lines.push(`| ${cells.join(" | ")} |`);
  }

  const markdown = lines.join("\n");

  return {
    object: "block",
    type: "code",
    code: {
      rich_text: chunkTextRichText(markdown),
      caption: [],
      language: "markdown"
    }
  };
}

function createListItemBlock(ordered, item) {
  const type = ordered ? "numbered_list_item" : "bulleted_list_item";
  const children = blocksToNotionChildren(item.blocks || []);

  return [
    {
      object: "block",
      type,
      [type]: {
        rich_text: inlineChildrenToRichText(item.children || []),
        color: "default",
        ...(children.length ? { children } : {})
      }
    }
  ];
}

function inlineChildrenToRichText(children) {
  const segments = flattenInline(children || [], DEFAULT_ANNOTATIONS, null);
  const mergedSegments = mergeSegments(segments);
  const richText = [];

  for (const segment of mergedSegments) {
    if (segment.kind === "text") {
      for (const contentPart of splitText(segment.content, TEXT_CHUNK_SIZE)) {
        richText.push({
          type: "text",
          text: {
            content: contentPart,
            link: segment.href ? { url: segment.href } : null
          },
          annotations: segment.annotations
        });
      }
      continue;
    }

    if (segment.kind === "equation") {
      richText.push({
        type: "equation",
        equation: {
          expression: segment.expression
        },
        annotations: segment.annotations
      });
    }
  }

  return richText;
}

function inlineChildrenToPlainText(children) {
  const segments = flattenInline(children || [], DEFAULT_ANNOTATIONS, null);

  return segments
    .map((segment) => {
      if (segment.kind === "text") {
        return segment.content;
      }

      return segment.expression;
    })
    .join("");
}

function flattenInline(children, annotations, href) {
  const segments = [];

  for (const child of children || []) {
    if (!child) {
      continue;
    }

    switch (child.type) {
      case "text":
        if (child.text) {
          segments.push({
            kind: "text",
            content: child.text,
            annotations: { ...annotations },
            href
          });
        }
        break;
      case "lineBreak":
        segments.push({
          kind: "text",
          content: "\n",
          annotations: { ...annotations },
          href
        });
        break;
      case "code":
        segments.push({
          kind: "text",
          content: child.text || "",
          annotations: {
            ...annotations,
            code: true
          },
          href
        });
        break;
      case "math":
        segments.push({
          kind: "equation",
          expression: child.latex || "",
          annotations: { ...annotations }
        });
        break;
      case "bold":
        segments.push(
          ...flattenInline(child.children, { ...annotations, bold: true }, href)
        );
        break;
      case "italic":
        segments.push(
          ...flattenInline(child.children, { ...annotations, italic: true }, href)
        );
        break;
      case "strike":
        segments.push(
          ...flattenInline(child.children, { ...annotations, strikethrough: true }, href)
        );
        break;
      case "link":
        segments.push(...flattenInline(child.children, { ...annotations }, child.href || href));
        break;
      default:
        break;
    }
  }

  return segments.filter((segment) => {
    if (segment.kind === "text") {
      return segment.content.length > 0;
    }

    return Boolean(segment.expression);
  });
}

function mergeSegments(segments) {
  const merged = [];

  for (const segment of segments) {
    const previous = merged[merged.length - 1];

    if (
      previous &&
      previous.kind === "text" &&
      segment.kind === "text" &&
      previous.href === segment.href &&
      sameAnnotations(previous.annotations, segment.annotations)
    ) {
      previous.content += segment.content;
      continue;
    }

    merged.push({
      ...segment,
      annotations: { ...segment.annotations }
    });
  }

  return merged;
}

function chunkTextRichText(text) {
  return splitText(text || "", TEXT_CHUNK_SIZE).map((part) => ({
    type: "text",
    text: {
      content: part,
      link: null
    },
    annotations: { ...DEFAULT_ANNOTATIONS }
  }));
}

function splitText(text, size) {
  if (!text) {
    return [""];
  }

  const chunks = [];

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks.length ? chunks : [text];
}

function normalizeCodeLanguage(language) {
  const lower = (language || "").trim().toLowerCase();

  if (!lower) {
    return "plain text";
  }

  if (SUPPORTED_CODE_LANGUAGES.has(lower)) {
    return lower;
  }

  if (lower === "js") {
    return "javascript";
  }

  if (lower === "ts") {
    return "typescript";
  }

  if (lower === "py") {
    return "python";
  }

  if (lower === "sh") {
    return "shell";
  }

  if (lower === "md") {
    return "markdown";
  }

  return "plain text";
}

function normalizeNotionId(id) {
  const stripped = String(id || "").replace(/-/g, "").trim();

  if (!/^[0-9a-fA-F]{32}$/.test(stripped)) {
    throw new Error("Invalid Notion page id.");
  }

  return [
    stripped.slice(0, 8),
    stripped.slice(8, 12),
    stripped.slice(12, 16),
    stripped.slice(16, 20),
    stripped.slice(20)
  ].join("-");
}

function parentObjectToId(parent) {
  if (!parent || typeof parent !== "object") {
    return "";
  }

  switch (parent.type) {
    case "page_id":
      return normalizeNotionId(parent.page_id);
    case "block_id":
      return normalizeNotionId(parent.block_id);
    case "database_id":
      return normalizeNotionId(parent.database_id);
    case "data_source_id":
      return normalizeNotionId(parent.data_source_id);
    default:
      return "";
  }
}

function maskToken(token) {
  if (!token) {
    return "";
  }

  if (token.length <= 8) {
    return "********";
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function byteLengthUtf8(text) {
  return new TextEncoder().encode(String(text || "")).length;
}

function isRequestBodyTooLargeError(error) {
  return /request body too large/i.test(String(error?.message || error));
}

function sameAnnotations(left, right) {
  return (
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.strikethrough === right.strikethrough &&
    left.underline === right.underline &&
    left.code === right.code &&
    left.color === right.color
  );
}
