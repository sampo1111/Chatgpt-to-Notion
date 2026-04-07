(function () {
  const SETTINGS_KEY = "chatgptToNotionSettings";
  const BUTTON_ID = "chatgpt-to-notion-paste-button";
  const TOAST_ID = "chatgpt-to-notion-toast";
  const DEFAULT_PASTE_BUTTON_TEXT = "Paste to Notion";
  const TEXT_PAYLOAD_HEADER = "[[CHATGPT_TO_NOTION]]";
  const HIDDEN_PAYLOAD_START = "\u2063\u2063\u2063";
  const HIDDEN_PAYLOAD_END = "\u2064\u2064\u2064";
  const HIDDEN_ZERO = "\u200b";
  const HIDDEN_ONE = "\u200c";
  const PASTE_SUPPRESSION_MS = 1500;
  let cursorContext = {
    blockId: null
  };
  let suppressNativePasteUntil = 0;
  let activePasteOperation = null;
  let uiState = {
    enableNotionPaste: true
  };

  async function boot() {
    await loadUiState();
    injectPasteButton();
    observePage();
    registerCursorTracking();
    registerWindowActivityTracking();
    registerBeforeInputSuppression();
    registerPasteHandler();
    observeSettings();
  }

  function observePage() {
    const observer = new MutationObserver(() => {
      injectPasteButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function injectPasteButton() {
    if (!shouldShowPasteButton()) {
      removePasteButton();
      return;
    }

    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.className = "chatgpt-to-notion-floating-button";
    button.textContent = DEFAULT_PASTE_BUTTON_TEXT;

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    button.addEventListener("click", async () => {
      if (activePasteOperation) {
        await cancelActivePaste();
        return;
      }

      await appendStoredReply(button);
    });

    document.body.appendChild(button);
  }

  function registerPasteHandler() {
    document.addEventListener(
      "paste",
      async (event) => {
        if (!uiState.enableNotionPaste) {
          return;
        }

        updateCursorContext();
        const payload = extractPayloadFromClipboard(event);

        if (!payload?.blocks?.length) {
          return;
        }

        suppressNativePasteUntil = Date.now() + PASTE_SUPPRESSION_MS;
        blockNativeEvent(event);
        const button = document.getElementById(BUTTON_ID);
        await appendPayloadToCurrentPage(payload, button);
      },
      true
    );
  }

  function registerBeforeInputSuppression() {
    document.addEventListener(
      "beforeinput",
      (event) => {
        if (!uiState.enableNotionPaste) {
          return;
        }

        if (!isPasteLikeInput(event)) {
          return;
        }

        if (Date.now() > suppressNativePasteUntil) {
          return;
        }

        blockNativeEvent(event);
      },
      true
    );
  }

  function registerCursorTracking() {
    const update = () => {
      updateCursorContext();
    };

    document.addEventListener("selectionchange", update, true);
    document.addEventListener("focusin", update, true);
    document.addEventListener("click", update, true);
    document.addEventListener("keyup", update, true);
    updateCursorContext();
  }

  function observeSettings() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[SETTINGS_KEY]) {
        return;
      }

      const nextSettings = changes[SETTINGS_KEY].newValue || {};
      uiState.enableNotionPaste = nextSettings.enableNotionPaste !== false;
      injectPasteButton();
    });
  }

  function registerWindowActivityTracking() {
    const sync = () => {
      injectPasteButton();
    };

    window.addEventListener("focus", sync, true);
    window.addEventListener("blur", sync, true);
    document.addEventListener("visibilitychange", sync, true);
    window.addEventListener("pageshow", sync, true);
  }

  async function loadUiState() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = stored[SETTINGS_KEY] || {};
    uiState.enableNotionPaste = settings.enableNotionPaste !== false;
  }

  function removePasteButton() {
    document.getElementById(BUTTON_ID)?.remove();
  }

  function shouldShowPasteButton() {
    return uiState.enableNotionPaste && isNotionWindowActive();
  }

  function isNotionWindowActive() {
    const isNotionDomain =
      window.location.hostname === "www.notion.so" || window.location.hostname === "notion.so";

    return isNotionDomain && !document.hidden && document.hasFocus();
  }

  function updateCursorContext() {
    const selection = document.getSelection();
    const anchorNode = selection?.anchorNode || null;
    const activeElement = document.activeElement || null;

    const blockElement =
      nodeToBlockElement(anchorNode) ||
      nodeToBlockElement(activeElement) ||
      (activeElement?.closest ? activeElement.closest("[data-block-id]") : null);

    cursorContext = {
      blockId: blockElement?.getAttribute("data-block-id") || null
    };
  }

  async function appendStoredReply(button) {
    const pageId = extractCurrentPageId();

    if (!pageId) {
      showToast("Could not find the current Notion page id.");
      return;
    }

    try {
      const clipboardPayload = await readPayloadFromClipboard();
      if (clipboardPayload?.blocks?.length) {
        await appendPayloadToCurrentPage(clipboardPayload, button);
        return;
      }

      await runPasteOperation(button, async (operationId) => {
        const response = await sendRuntimeMessage({
          type: "appendStoredBlocksToNotionPage",
          pageId,
          anchorBlockId: cursorContext.blockId,
          operationId
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Append failed.");
        }

        showToast(`Added ${response.appendedBlocks} block(s) to this Notion page.`);
      });
    } catch (error) {
      if (isPasteCanceledError(error)) {
        showToast("Paste canceled.");
        return;
      }

      console.error("ChatGPT to Notion append failed", error);
      showToast(error instanceof Error ? error.message : String(error));
    }
  }

  async function appendPayloadToCurrentPage(payload, button) {
    const pageId = extractCurrentPageId();

    if (!pageId) {
      showToast("Could not find the current Notion page id.");
      return;
    }

    try {
      await runPasteOperation(button, async (operationId) => {
        const response = await sendRuntimeMessage({
          type: "appendBlocksToNotionPage",
          pageId,
          anchorBlockId: cursorContext.blockId,
          blocks: payload.blocks,
          operationId
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Append failed.");
        }

        showToast(`Pasted ${response.appendedBlocks} block(s) into Notion.`);
      });
    } catch (error) {
      if (isPasteCanceledError(error)) {
        showToast("Paste canceled.");
        return;
      }

      console.error("ChatGPT to Notion paste failed", error);
      showToast(error instanceof Error ? error.message : String(error));
    }
  }

  function extractPayloadFromClipboard(event) {
    const html = event.clipboardData?.getData("text/html") || "";
    const text = event.clipboardData?.getData("text/plain") || "";

    const htmlPayload = decodeHtmlPayload(html);
    if (htmlPayload) {
      return htmlPayload;
    }

    const textPayload = decodeTextPayload(text);
    if (textPayload) {
      return textPayload;
    }

    return parseGeneratedHtmlPayload(html, text);
  }

  function decodeHtmlPayload(html) {
    if (!html) {
      return null;
    }

    const documentFragment = new DOMParser().parseFromString(html, "text/html");
    const wrapper = documentFragment.querySelector("[data-chatgpt-to-notion-payload]");

    if (!wrapper) {
      return null;
    }

    const encoded = wrapper.getAttribute("data-chatgpt-to-notion-payload");
    if (!encoded) {
      return null;
    }

    try {
      const binary = atob(encoded);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const json = new TextDecoder().decode(bytes);
      return JSON.parse(json);
    } catch (error) {
      console.error("Failed to decode ChatGPT to Notion payload", error);
      return null;
    }
  }

  function parseGeneratedHtmlPayload(html, textFallback) {
    if (!html) {
      return null;
    }

    try {
      const documentFragment = new DOMParser().parseFromString(html, "text/html");
      const blocks = parseHtmlBlocks(Array.from(documentFragment.body.childNodes));

      if (!blocks.length) {
        return null;
      }

      return {
        copiedAt: null,
        markdown: textFallback || "",
        blocks
      };
    } catch (error) {
      console.error("Failed to parse generated clipboard HTML", error);
      return null;
    }
  }

  function decodeTextPayload(text) {
    if (!text) {
      return null;
    }

    let workingText = text;

    if (workingText.startsWith(TEXT_PAYLOAD_HEADER)) {
      workingText = workingText.slice(TEXT_PAYLOAD_HEADER.length);
      workingText = workingText.replace(/^\n+/, "");
    }

    if (!workingText.startsWith(HIDDEN_PAYLOAD_START)) {
      if (text.startsWith(TEXT_PAYLOAD_HEADER)) {
        const markdownOnly = workingText.replace(/^\n+/, "");
        return {
          copiedAt: null,
          markdown: markdownOnly,
          blocks: parseMarkdownBlocks(markdownOnly)
        };
      }

      return null;
    }

    const endIndex = workingText.indexOf(HIDDEN_PAYLOAD_END, HIDDEN_PAYLOAD_START.length);
    if (endIndex === -1) {
      return null;
    }

    const hiddenBits = workingText.slice(HIDDEN_PAYLOAD_START.length, endIndex);
    const markdownText = workingText.slice(endIndex + HIDDEN_PAYLOAD_END.length).replace(/^\n+/, "");
    const binary = hiddenBits
      .replace(new RegExp(HIDDEN_ZERO, "g"), "0")
      .replace(new RegExp(HIDDEN_ONE, "g"), "1");

    if (!binary || binary.length % 8 !== 0) {
      return null;
    }

    let base64 = "";
    for (let index = 0; index < binary.length; index += 8) {
      const byte = binary.slice(index, index + 8);
      base64 += String.fromCharCode(Number.parseInt(byte, 2));
    }

    try {
      const decodedBinary = atob(base64);
      const bytes = Uint8Array.from(decodedBinary, (char) => char.charCodeAt(0));
      const json = new TextDecoder().decode(bytes);
      const parsedPayload = JSON.parse(json);

      if (!parsedPayload?.blocks?.length && markdownText) {
        parsedPayload.blocks = parseMarkdownBlocks(markdownText);
      }

      parsedPayload.markdown ||= markdownText;
      return parsedPayload;
    } catch (error) {
      console.error("Failed to decode hidden clipboard payload", error);
      if (!markdownText) {
        return null;
      }

      return {
        copiedAt: null,
        markdown: markdownText,
        blocks: parseMarkdownBlocks(markdownText)
      };
    }
  }

  async function readPayloadFromClipboard() {
    if (!navigator.clipboard?.readText) {
      return null;
    }

    try {
      const text = await navigator.clipboard.readText();
      return decodeTextPayload(text);
    } catch (error) {
      console.warn("Clipboard read failed", error);
      return null;
    }
  }

  function extractCurrentPageId() {
    const url = new URL(window.location.href);
    const path = url.pathname;

    const uuidMatch = path.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
    if (uuidMatch) {
      return uuidMatch[1];
    }

    const compactMatch = path.match(/([0-9a-fA-F]{32})/);
    if (compactMatch) {
      return compactMatch[1];
    }

    return null;
  }

  function nodeToBlockElement(node) {
    if (!node) {
      return null;
    }

    if (node instanceof Element) {
      return node.closest("[data-block-id]");
    }

    return node.parentElement?.closest("[data-block-id]") || null;
  }

  function setButtonBusy(button, busy) {
    if (!button) {
      return;
    }

    button.disabled = false;
    button.dataset.busy = busy ? "true" : "false";
    button.setAttribute("aria-busy", busy ? "true" : "false");
    button.textContent = busy ? "Pasting... Click to cancel" : DEFAULT_PASTE_BUTTON_TEXT;
  }

  async function runPasteOperation(button, operation) {
    const currentButton = button || document.getElementById(BUTTON_ID) || null;
    const operationState = {
      id: createOperationId(),
      button: currentButton,
      canceled: false
    };

    activePasteOperation = operationState;
    setButtonBusy(currentButton, true);

    try {
      await operation(operationState.id);
    } catch (error) {
      if (operationState.canceled || isPasteCanceledError(error)) {
        return;
      }

      throw error;
    } finally {
      if (activePasteOperation === operationState) {
        activePasteOperation = null;
      }

      setButtonBusy(currentButton, false);
    }
  }

  async function cancelActivePaste() {
    if (!activePasteOperation || activePasteOperation.canceled) {
      return;
    }

    activePasteOperation.canceled = true;
    showToast("Canceling paste...");

    const response = await sendRuntimeMessage({
      type: "cancelAppendOperation",
      operationId: activePasteOperation.id
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not cancel the current paste.");
    }
  }

  function createOperationId() {
    return `paste-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function isPasteCanceledError(error) {
    return /Paste canceled/i.test(String(error?.message || error));
  }

  function showToast(message) {
    const existing = document.getElementById(TOAST_ID);
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.id = TOAST_ID;
    toast.className = "chatgpt-to-notion-toast";
    toast.textContent = message;

    document.body.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-visible");
    }, 10);

    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    }, 2600);
  }

  function isPasteLikeInput(event) {
    const inputType = String(event?.inputType || "");
    return inputType === "insertFromPaste" || inputType === "insertFromPasteAsQuotation";
  }

  function blockNativeEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  async function sendRuntimeMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        showToast("Extension updated. Reloading this Notion tab...");
        window.setTimeout(() => {
          window.location.reload();
        }, 600);
      }

      throw error;
    }
  }

  function isExtensionContextInvalidated(error) {
    return /Extension context invalidated/i.test(String(error?.message || error));
  }

  function parseMarkdownBlocks(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const { blocks } = parseBlockLines(lines, 0, 0);
    return blocks;
  }

  function parseHtmlBlocks(nodes) {
    const blocks = [];

    for (const node of nodes) {
      blocks.push(...parseHtmlNodeToBlocks(node));
    }

    return compactBlocks(blocks);
  }

  function parseHtmlNodeToBlocks(node) {
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
    const tagName = element.tagName;

    if (tagName === "P") {
      return [
        {
          type: "paragraph",
          children: parseHtmlInlineChildren(Array.from(element.childNodes))
        }
      ];
    }

    if (/^H[1-4]$/.test(tagName)) {
      return [
        {
          type: "heading",
          level: Number(tagName.slice(1)),
          children: parseHtmlInlineChildren(Array.from(element.childNodes))
        }
      ];
    }

    if (tagName === "BLOCKQUOTE") {
      return [
        {
          type: "quote",
          children: parseHtmlInlineChildren(Array.from(element.childNodes))
        }
      ];
    }

    if (tagName === "HR") {
      return [{ type: "divider" }];
    }

    if (tagName === "PRE") {
      return [
        {
          type: "code",
          language: element.getAttribute("data-language") || "",
          code: element.textContent || ""
        }
      ];
    }

    if (tagName === "DIV" && element.getAttribute("data-chatgpt-to-notion-math") === "block") {
      const raw = element.textContent || "";
      return [
        {
          type: "equation",
          latex: stripMathDelimiters(raw)
        }
      ];
    }

    if (tagName === "UL" || tagName === "OL") {
      return [parseHtmlList(element)];
    }

    if (tagName === "TABLE") {
      return [
        {
          type: "table",
          rows: Array.from(element.querySelectorAll("tr")).map((row) =>
            Array.from(row.children).map((cell) => ({
              children: parseHtmlInlineChildren(Array.from(cell.childNodes))
            }))
          ),
          hasHeader: Boolean(element.querySelector("th"))
        }
      ];
    }

    if (tagName === "IMG") {
      return [
        {
          type: "image",
          src: element.getAttribute("src") || "",
          alt: element.getAttribute("alt") || ""
        }
      ];
    }

    return parseHtmlBlocks(Array.from(element.childNodes));
  }

  function parseHtmlList(element) {
    return {
      type: "list",
      ordered: element.tagName === "OL",
      items: Array.from(element.children)
        .filter((child) => child.tagName === "LI")
        .map((li) => parseHtmlListItem(li))
    };
  }

  function parseHtmlListItem(li) {
    const children = [];
    const blocks = [];

    for (const childNode of Array.from(li.childNodes)) {
      if (childNode.nodeType === Node.ELEMENT_NODE && isHtmlBlockElement(childNode)) {
        blocks.push(...parseHtmlNodeToBlocks(childNode));
        continue;
      }

      children.push(...parseHtmlInlineChildren([childNode]));
    }

    return {
      children: mergeAdjacentTextParts(children),
      blocks: compactBlocks(blocks)
    };
  }

  function parseHtmlInlineChildren(nodes) {
    const children = [];

    for (const node of nodes) {
      children.push(...parseHtmlInlineNode(node));
    }

    return mergeAdjacentTextParts(children);
  }

  function parseHtmlInlineNode(node) {
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
    const tagName = element.tagName;

    if (tagName === "BR") {
      return [{ type: "lineBreak" }];
    }

    if (tagName === "SPAN" && element.getAttribute("data-chatgpt-to-notion-math") === "inline") {
      return [
        {
          type: "math",
          latex: stripMathDelimiters(element.textContent || "")
        }
      ];
    }

    if (tagName === "STRONG" || tagName === "B") {
      return [
        {
          type: "bold",
          children: parseHtmlInlineChildren(Array.from(element.childNodes))
        }
      ];
    }

    if (tagName === "EM" || tagName === "I") {
      return [
        {
          type: "italic",
          children: parseHtmlInlineChildren(Array.from(element.childNodes))
        }
      ];
    }

    if (tagName === "S" || tagName === "DEL") {
      return [
        {
          type: "strike",
          children: parseHtmlInlineChildren(Array.from(element.childNodes))
        }
      ];
    }

    if (tagName === "CODE") {
      return [
        {
          type: "code",
          text: element.textContent || ""
        }
      ];
    }

    if (tagName === "A") {
      return [
        {
          type: "link",
          href: element.getAttribute("href") || "",
          children: parseHtmlInlineChildren(Array.from(element.childNodes))
        }
      ];
    }

    if (isHtmlBlockElement(element)) {
      return [];
    }

    return parseHtmlInlineChildren(Array.from(element.childNodes));
  }

  function isHtmlBlockElement(element) {
    return ["P", "PRE", "UL", "OL", "TABLE", "BLOCKQUOTE", "HR", "H1", "H2", "H3", "H4", "DIV"].includes(
      element.tagName
    );
  }

  function stripMathDelimiters(text) {
    return String(text || "")
      .replace(/^\s*\$\$\s*/, "")
      .replace(/\s*\$\$\s*$/, "")
      .trim();
  }

  function collapseWhitespace(text) {
    return String(text || "").replace(/\s+/g, " ");
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
      const normalizedChildren = mergeAdjacentTextParts(item.children || []);
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

  function parseBlockLines(lines, startIndex, indentLevel) {
    const blocks = [];
    let index = startIndex;

    while (index < lines.length) {
      const rawLine = lines[index];
      const currentIndent = countLeadingTabs(rawLine);
      const trimmed = rawLine.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      if (currentIndent < indentLevel) {
        break;
      }

      if (currentIndent > indentLevel) {
        break;
      }

      const line = rawLine.slice(indentLevel);

      if (line.startsWith("```")) {
        const language = line.slice(3).trim();
        index += 1;
        const codeLines = [];

        while (index < lines.length) {
          const codeRawLine = lines[index];
          const codeLine = codeRawLine.slice(Math.min(countLeadingTabs(codeRawLine), indentLevel));
          if (codeLine.startsWith("```")) {
            index += 1;
            break;
          }
          codeLines.push(codeRawLine.slice(indentLevel));
          index += 1;
        }

        blocks.push({
          type: "code",
          language,
          code: codeLines.join("\n")
        });
        continue;
      }

      if (line.trim() === "$$") {
        index += 1;
        const mathLines = [];

        while (index < lines.length) {
          const mathRawLine = lines[index];
          const mathLine = mathRawLine.slice(Math.min(countLeadingTabs(mathRawLine), indentLevel));
          if (mathLine.trim() === "$$") {
            index += 1;
            break;
          }
          mathLines.push(mathRawLine.slice(indentLevel));
          index += 1;
        }

        blocks.push({
          type: "equation",
          latex: mathLines.join("\n").trim()
        });
        continue;
      }

      const headingMatch = line.match(/^(#{1,4})\s+(.*)$/);
      if (headingMatch) {
        blocks.push({
          type: "heading",
          level: headingMatch[1].length,
          children: parseInlineMarkdown(headingMatch[2])
        });
        index += 1;
        continue;
      }

      if (line.trim() === "---") {
        blocks.push({ type: "divider" });
        index += 1;
        continue;
      }

      if (isListLine(line)) {
        const parsedList = parseListBlock(lines, index, indentLevel);
        blocks.push(parsedList.block);
        index = parsedList.nextIndex;
        continue;
      }

      const paragraphLines = [line];
      index += 1;

      while (index < lines.length) {
        const nextRawLine = lines[index];
        const nextIndent = countLeadingTabs(nextRawLine);
        const nextLine = nextRawLine.slice(Math.min(nextIndent, indentLevel));
        const nextTrimmed = nextRawLine.trim();

        if (!nextTrimmed) {
          break;
        }

        if (nextIndent < indentLevel || nextIndent > indentLevel) {
          break;
        }

        if (
          nextLine.startsWith("```") ||
          nextLine.trim() === "$$" ||
          nextLine.trim() === "---" ||
          nextLine.match(/^(#{1,4})\s+/) ||
          isListLine(nextLine)
        ) {
          break;
        }

        paragraphLines.push(nextLine);
        index += 1;
      }

      blocks.push({
        type: "paragraph",
        children: parseInlineMarkdown(paragraphLines.join(" "))
      });
    }

    return {
      blocks,
      nextIndex: index
    };
  }

  function parseListBlock(lines, startIndex, indentLevel) {
    const firstLine = lines[startIndex].slice(indentLevel);
    const ordered = /^\d+\.\s+/.test(firstLine);
    const items = [];
    let index = startIndex;

    while (index < lines.length) {
      const rawLine = lines[index];
      const currentIndent = countLeadingTabs(rawLine);

      if (currentIndent !== indentLevel) {
        break;
      }

      const line = rawLine.slice(indentLevel);
      if (!isListLine(line)) {
        break;
      }

      const itemMatch = line.match(/^(-|\d+\.)\s+(.*)$/);
      if (!itemMatch) {
        break;
      }

      const item = {
        children: parseInlineMarkdown(itemMatch[2]),
        blocks: []
      };

      index += 1;

      if (index < lines.length) {
        const nested = parseBlockLines(lines, index, indentLevel + 1);
        item.blocks = nested.blocks;
        index = nested.nextIndex;
      }

      items.push(item);
    }

    return {
      block: {
        type: "list",
        ordered,
        items
      },
      nextIndex: index
    };
  }

  function parseInlineMarkdown(text) {
    const parts = [];
    let index = 0;

    while (index < text.length) {
      if (text.startsWith("\\", index) && index + 1 < text.length) {
        parts.push({ type: "text", text: text[index + 1] });
        index += 2;
        continue;
      }

      if (text.startsWith("<br>", index)) {
        parts.push({ type: "lineBreak" });
        index += 4;
        continue;
      }

      if (text.startsWith("$$", index)) {
        const endIndex = text.indexOf("$$", index + 2);
        if (endIndex !== -1) {
          parts.push({
            type: "math",
            latex: text.slice(index + 2, endIndex)
          });
          index = endIndex + 2;
          continue;
        }
      }

      if (text.startsWith("**", index)) {
        const endIndex = text.indexOf("**", index + 2);
        if (endIndex !== -1) {
          parts.push({
            type: "bold",
            children: parseInlineMarkdown(text.slice(index + 2, endIndex))
          });
          index = endIndex + 2;
          continue;
        }
      }

      if (text.startsWith("~~", index)) {
        const endIndex = text.indexOf("~~", index + 2);
        if (endIndex !== -1) {
          parts.push({
            type: "strike",
            children: parseInlineMarkdown(text.slice(index + 2, endIndex))
          });
          index = endIndex + 2;
          continue;
        }
      }

      if (text.startsWith("`", index)) {
        const endIndex = text.indexOf("`", index + 1);
        if (endIndex !== -1) {
          parts.push({
            type: "code",
            text: text.slice(index + 1, endIndex)
          });
          index = endIndex + 1;
          continue;
        }
      }

      if (text.startsWith("[", index)) {
        const closeBracket = text.indexOf("]", index + 1);
        const openParen = closeBracket === -1 ? -1 : text.indexOf("(", closeBracket + 1);
        const closeParen = openParen === -1 ? -1 : text.indexOf(")", openParen + 1);

        if (closeBracket !== -1 && openParen === closeBracket + 1 && closeParen !== -1) {
          parts.push({
            type: "link",
            href: text.slice(openParen + 1, closeParen),
            children: parseInlineMarkdown(text.slice(index + 1, closeBracket))
          });
          index = closeParen + 1;
          continue;
        }
      }

      if (text.startsWith("*", index)) {
        const endIndex = text.indexOf("*", index + 1);
        if (endIndex !== -1) {
          parts.push({
            type: "italic",
            children: parseInlineMarkdown(text.slice(index + 1, endIndex))
          });
          index = endIndex + 1;
          continue;
        }
      }

      let nextIndex = index + 1;
      while (nextIndex < text.length && !isInlineSpecialStart(text, nextIndex)) {
        nextIndex += 1;
      }

      parts.push({
        type: "text",
        text: text.slice(index, nextIndex)
      });
      index = nextIndex;
    }

    return mergeAdjacentTextParts(parts);
  }

  function isInlineSpecialStart(text, index) {
    return (
      text.startsWith("\\", index) ||
      text.startsWith("<br>", index) ||
      text.startsWith("$$", index) ||
      text.startsWith("**", index) ||
      text.startsWith("~~", index) ||
      text.startsWith("`", index) ||
      text.startsWith("[", index) ||
      text.startsWith("*", index)
    );
  }

  function mergeAdjacentTextParts(parts) {
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

  function isListLine(line) {
    return /^(-|\d+\.)\s+/.test(line.trimStart());
  }

  function countLeadingTabs(line) {
    const match = String(line || "").match(/^\t*/);
    return match ? match[0].length : 0;
  }

  void boot();
})();
