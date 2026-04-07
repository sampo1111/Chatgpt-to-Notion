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
const DEFAULT_SETTINGS = {
  notionToken: "",
  enableCopyButton: true,
  enableNotionPaste: true
};
const ACTIVE_APPEND_OPERATIONS = new Map();
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
      if (!isAppendCanceledError(error)) {
        console.error("ChatGPT to Notion background error", error);
      }
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
    case "saveUiSettings":
      return saveUiSettings(message.settings || {});
    case "testNotionConnection":
      return testNotionConnection(message.token);
    case "appendBlocksToNotionPage":
      return appendBlocksToNotionPage({
        pageId: message.pageId,
        blocks: message.blocks,
        anchorBlockId: message.anchorBlockId,
        operationId: message.operationId
      });
    case "appendStoredBlocksToNotionPage":
      return appendStoredBlocksToNotionPage(message.pageId, message.anchorBlockId, message.operationId);
    case "cancelAppendOperation":
      return cancelAppendOperation(message.operationId);
    case "getLastCopySummary":
      return getLastCopySummary();
    default:
      throw new Error("Unsupported message type");
  }
}

async function saveNotionSettings(token) {
  const trimmedToken = token.trim();
  const currentSettings = await readSettings();

  await chrome.storage.local.set({
    [SETTINGS_KEY]: {
      ...currentSettings,
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
    maskedToken: maskToken(settings.notionToken),
    enableCopyButton: settings.enableCopyButton,
    enableNotionPaste: settings.enableNotionPaste
  };
}

async function saveUiSettings(nextSettings) {
  const currentSettings = await readSettings();
  const mergedSettings = {
    ...currentSettings,
    ...sanitizeUiSettings(nextSettings)
  };

  await chrome.storage.local.set({
    [SETTINGS_KEY]: mergedSettings
  });

  return {
    saved: true,
    enableCopyButton: mergedSettings.enableCopyButton,
    enableNotionPaste: mergedSettings.enableNotionPaste
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

async function appendStoredBlocksToNotionPage(pageId, anchorBlockId, operationId) {
  const stored = await chrome.storage.local.get([LAST_COPY_KEY]);
  const lastCopy = stored[LAST_COPY_KEY];

  if (!lastCopy?.blocks?.length) {
    throw new Error("No captured AI reply found. Copy from ChatGPT or Gemini first.");
  }

  return appendBlocksToNotionPage({
    pageId,
    blocks: lastCopy.blocks,
    anchorBlockId,
    operationId
  });
}

async function appendBlocksToNotionPage({ pageId, blocks, anchorBlockId, operationId }) {
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

  const operation = beginAppendOperation(operationId);

  try {
    const normalizedPageId = normalizeNotionId(pageId);
    const nodes = blocksToAppendNodes(blocks);
    const appendTarget = await resolveAppendTarget({
      pageId: normalizedPageId,
      anchorBlockId,
      token,
      signal: operation.signal
    });

    if (!nodes.length) {
      throw new Error("There was nothing to send to Notion.");
    }

    const parentId = appendTarget.parentId;
    const appendResult = await appendNodesToParent({
      parentId,
      afterBlockId: appendTarget.afterBlockId,
      nodes,
      token,
      signal: operation.signal
    });

    return {
      appendedBlocks: appendResult.appendedCount,
      pageId: normalizedPageId,
      parentId,
      anchorBlockId: appendTarget.anchorBlockId || null,
      operationId: operation.id
    };
  } finally {
    finishAppendOperation(operation.id);
  }
}

async function getLastCopySummary() {
  const stored = await chrome.storage.local.get([LAST_COPY_KEY]);
  const lastCopy = stored[LAST_COPY_KEY];

  return {
    hasLastCopy: Boolean(lastCopy?.blocks?.length),
    copiedAt: lastCopy?.copiedAt || null,
    blockCount: lastCopy?.blocks?.length || 0,
    source: lastCopy?.source || null,
    sourceLabel: lastCopy?.sourceLabel || null
  };
}

async function notionFetch(path, options) {
  let response;

  try {
    response = await fetch(`https://api.notion.com/v1${path}`, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${options.token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
  } catch (error) {
    if (isAbortLikeError(error) || options.signal?.aborted) {
      throw new Error("Paste canceled.");
    }

    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data?.message || data?.code || response.statusText;
    throw new Error(`Notion API error: ${detail}`);
  }

  return data;
}

async function readSettings() {
  const stored = await chrome.storage.local.get([SETTINGS_KEY]);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[SETTINGS_KEY] || {})
  };
}

function sanitizeUiSettings(settings) {
  return {
    enableCopyButton:
      settings.enableCopyButton === undefined
        ? DEFAULT_SETTINGS.enableCopyButton
        : Boolean(settings.enableCopyButton),
    enableNotionPaste:
      settings.enableNotionPaste === undefined
        ? DEFAULT_SETTINGS.enableNotionPaste
        : Boolean(settings.enableNotionPaste)
  };
}

async function resolveAppendTarget({ pageId, anchorBlockId, token, signal }) {
  throwIfCanceled(signal);

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
      token,
      signal
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

async function appendNodesToParent({ parentId, afterBlockId, nodes, token, signal }) {
  throwIfCanceled(signal);
  let nextAfterBlockId = afterBlockId;
  let appendedCount = 0;

  for (const nodeChunk of buildAppendChunks(nodes, parentId, nextAfterBlockId)) {
    throwIfCanceled(signal);
    const appendResult = await appendChunkWithRetry({
      parentId,
      afterBlockId: nextAfterBlockId,
      nodeChunk,
      token,
      signal
    });
    nextAfterBlockId = appendResult.lastInsertedId || null;
    appendedCount += appendResult.appendedCount;
  }

  return {
    lastInsertedId: nextAfterBlockId,
    appendedCount
  };
}

function blocksToAppendNodes(blocks) {
  const output = [];

  for (const block of blocks) {
    output.push(...blockToAppendNodes(block));
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

async function appendChunkWithRetry({ parentId, afterBlockId, nodeChunk, token, signal }) {
  throwIfCanceled(signal);
  const payloadChunk = nodeChunk.map((node) => node.payload);

  try {
    const response = await notionFetch(`/blocks/${parentId}/children`, {
      method: "PATCH",
      token,
      body: createAppendBody(payloadChunk, afterBlockId),
      signal
    });

    const results = Array.isArray(response?.results) ? response.results : [];

    await appendNestedChildrenForChunk({
      nodeChunk,
      results,
      token,
      signal
    });

    return {
      response,
      lastInsertedId: results[results.length - 1]?.id || afterBlockId || null,
      appendedCount: countAppendNodes(nodeChunk)
    };
  } catch (error) {
    if (!isRequestBodyTooLargeError(error) || nodeChunk.length <= 1) {
      throw error;
    }

    const midpoint = Math.ceil(nodeChunk.length / 2);
    const firstHalf = nodeChunk.slice(0, midpoint);
    const secondHalf = nodeChunk.slice(midpoint);

    const firstResult = await appendChunkWithRetry({
      parentId,
      afterBlockId,
      nodeChunk: firstHalf,
      token
    });

    if (!secondHalf.length) {
      return firstResult;
    }

    return appendChunkWithRetry({
      parentId,
      afterBlockId: firstResult.lastInsertedId,
      nodeChunk: secondHalf,
      token
    });
  }
}

async function appendNestedChildrenForChunk({ nodeChunk, results, token, signal }) {
  for (let index = 0; index < nodeChunk.length; index += 1) {
    throwIfCanceled(signal);
    const node = nodeChunk[index];
    const childNodes = node.children || [];

    if (!childNodes.length) {
      continue;
    }

    const createdBlockIdRaw = results[index]?.id;

    if (!createdBlockIdRaw) {
      throw new Error("Notion did not return the created block ID for nested content.");
    }

    const createdBlockId = normalizeNotionId(createdBlockIdRaw);

    await appendNodesToParent({
      parentId: createdBlockId,
      afterBlockId: null,
      nodes: childNodes,
      token,
      signal
    });
  }
}

function beginAppendOperation(operationId) {
  const id = operationId || `append-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const controller = new AbortController();
  ACTIVE_APPEND_OPERATIONS.set(id, controller);

  return {
    id,
    signal: controller.signal
  };
}

function finishAppendOperation(operationId) {
  ACTIVE_APPEND_OPERATIONS.delete(operationId);
}

function cancelAppendOperation(operationId) {
  if (!operationId) {
    return {
      canceled: false
    };
  }

  const controller = ACTIVE_APPEND_OPERATIONS.get(operationId);
  if (!controller) {
    return {
      canceled: false
    };
  }

  controller.abort();
  ACTIVE_APPEND_OPERATIONS.delete(operationId);

  return {
    canceled: true
  };
}

function throwIfCanceled(signal) {
  if (signal?.aborted) {
    throw new Error("Paste canceled.");
  }
}

function isAbortLikeError(error) {
  const text = String(error?.name || error?.message || error);
  return /AbortError|aborted|canceled/i.test(text);
}

function isAppendCanceledError(error) {
  return /Paste canceled/i.test(String(error?.message || error));
}

function buildAppendChunks(nodes, parentId, initialAfterBlockId) {
  const chunks = [];
  let currentChunk = [];
  let currentAfterBlockId = initialAfterBlockId;

  for (const node of nodes) {
    if (!currentChunk.length) {
      currentChunk.push(node);
      continue;
    }

    const candidateChunk = [...currentChunk, node];
    const body = createAppendBody(
      candidateChunk.map((entry) => entry.payload),
      currentAfterBlockId
    );
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
      currentChunk = [node];
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

function blockToAppendNodes(block) {
  if (!block) {
    return [];
  }

  switch (block.type) {
    case "paragraph":
      return [createAppendNode(createRichTextBlock("paragraph", block.children))];
    case "heading":
      return [createAppendNode(createHeadingBlock(block.level, block.children))];
    case "quote":
      return [createAppendNode(createRichTextBlock("quote", block.children))];
    case "code":
      return [createAppendNode(createCodeBlock(block))];
    case "equation":
      return [
        createAppendNode({
          object: "block",
          type: "equation",
          equation: {
            expression: block.latex || ""
          }
        })
      ];
    case "divider":
      return [
        createAppendNode({
          object: "block",
          type: "divider",
          divider: {}
        })
      ];
    case "image":
      return [createAppendNode(createImageFallbackBlock(block))];
    case "list":
      return block.items.map((item) => createListItemNode(block.ordered, item));
    case "table":
      return [createAppendNode(createTableFallbackBlock(block))];
    default:
      return [];
  }
}

function createAppendNode(payload, children = []) {
  return {
    payload,
    children
  };
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

function createListItemNode(ordered, item) {
  const type = ordered ? "numbered_list_item" : "bulleted_list_item";
  const children = blocksToAppendNodes(item.blocks || []);

  return createAppendNode(
    {
      object: "block",
      type,
      [type]: {
        rich_text: inlineChildrenToRichText(item.children || []),
        color: "default"
      }
    },
    children
  );
}

function countAppendNodes(nodes) {
  let total = 0;

  for (const node of nodes || []) {
    total += 1;
    total += countAppendNodes(node.children || []);
  }

  return total;
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
