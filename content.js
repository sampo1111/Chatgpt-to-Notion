(function () {
  const SETTINGS_KEY = "chatgptToNotionSettings";
  const TEXT_PAYLOAD_HEADER = "[[CHATGPT_TO_NOTION]]";
  const HIDDEN_PAYLOAD_START = "\u2063\u2063\u2063";
  const HIDDEN_PAYLOAD_END = "\u2064\u2064\u2064";
  const HIDDEN_ZERO = "\u200b";
  const HIDDEN_ONE = "\u200c";
  const MESSAGE_SELECTOR = [
    "[data-message-author-role='assistant']",
    "article[data-testid^='conversation-turn-']"
  ].join(", ");
  const CONTENT_SELECTOR = [".markdown", "[class*='markdown']", "[data-testid='conversation-turn-content']"].join(", ");
  const MATH_SELECTOR = [
    ".katex",
    ".katex-display",
    "[data-testid='inline-math']",
    "[data-testid='display-math']",
    "[data-display='true']"
  ].join(", ");
  const SELECTION_BUTTON_ID = "chatgpt-to-notion-selection-button";
  const PROCESSED_ATTRIBUTE = "data-chatgpt-to-notion-processed";
  let uiState = {
    enableCopyButton: true
  };
  let selectionCopyContext = null;
  let selectionSyncScheduled = false;

  async function boot() {
    await loadUiState();
    injectButtons();
    observeConversation();
    observeSettings();
    observeNativeCopy();
    observeSelectionCopyButton();
  }

  function observeConversation() {
    const observer = new MutationObserver(() => {
      injectButtons();
      syncSelectionCopyButton();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function injectButtons() {
    if (!uiState.enableCopyButton) {
      removeCopyButtons();
      return;
    }

    const messages = document.querySelectorAll(MESSAGE_SELECTOR);

    for (const message of messages) {
      if (isWrapperForAssistant(message)) {
        continue;
      }

      if (!isAssistantMessage(message)) {
        continue;
      }

      if (message.hasAttribute(PROCESSED_ATTRIBUTE)) {
        continue;
      }

      const contentRoot = getContentRoot(message);
      if (!contentRoot) {
        continue;
      }

      const anchor = findButtonAnchor(message, contentRoot);
      if (!anchor) {
        continue;
      }

      ensureAnchorPosition(anchor);
      anchor.appendChild(createCopyButton(contentRoot));
      message.setAttribute(PROCESSED_ATTRIBUTE, "true");
    }
  }

  function observeSettings() {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !changes[SETTINGS_KEY]) {
        return;
      }

      const nextSettings = changes[SETTINGS_KEY].newValue || {};
      uiState.enableCopyButton = nextSettings.enableCopyButton !== false;
      injectButtons();
      syncSelectionCopyButton();
    });
  }

  function observeNativeCopy() {
    document.addEventListener("copy", handleSelectionCopy, true);
  }

  function observeSelectionCopyButton() {
    const sync = () => {
      scheduleSelectionCopyButtonSync();
    };

    document.addEventListener("selectionchange", sync, true);
    document.addEventListener("mouseup", sync, true);
    document.addEventListener("keyup", sync, true);
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync, true);
    window.addEventListener("blur", sync, true);
    scheduleSelectionCopyButtonSync();
  }

  async function loadUiState() {
    const stored = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = stored[SETTINGS_KEY] || {};
    uiState.enableCopyButton = settings.enableCopyButton !== false;
  }

  function removeCopyButtons() {
    document.querySelectorAll("[data-chatgpt-to-notion-button]").forEach((button) => button.remove());
    document.querySelectorAll(`[${PROCESSED_ATTRIBUTE}]`).forEach((message) => {
      message.removeAttribute(PROCESSED_ATTRIBUTE);
    });
    removeSelectionCopyButton();
  }

  function isAssistantMessage(message) {
    const role = message.getAttribute("data-message-author-role");
    if (role === "assistant") {
      return true;
    }

    return message.querySelector("[data-message-author-role='assistant']") !== null;
  }

  function isWrapperForAssistant(message) {
    return (
      message.getAttribute("data-message-author-role") !== "assistant" &&
      message.querySelector("[data-message-author-role='assistant']") !== null
    );
  }

  function getContentRoot(message) {
    if (message.matches(CONTENT_SELECTOR)) {
      return message;
    }

    return message.querySelector(CONTENT_SELECTOR);
  }

  function findButtonAnchor(message, contentRoot) {
    const actionBar =
      message.querySelector("[data-testid='conversation-turn-actions']") ||
      message.querySelector("[data-testid='turn-actions']") ||
      message.querySelector("footer");

    if (actionBar) {
      return actionBar;
    }

    return contentRoot.parentElement || message;
  }

  function ensureAnchorPosition(anchor) {
    const currentPosition = window.getComputedStyle(anchor).position;
    if (currentPosition === "static") {
      anchor.style.position = "relative";
    }
  }

  function createCopyButton(contentRoot) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Copy for Notion";
    button.className = "chatgpt-to-notion-button";
    button.setAttribute("data-chatgpt-to-notion-button", "true");

    button.addEventListener("click", async () => {
      if (!window.ChatGPTToNotionConverter?.convertMessage) {
        showToast("Converter not found.");
        return;
      }

      button.disabled = true;
      const previousText = button.textContent;
      button.textContent = "Copying...";

      try {
        const result = window.ChatGPTToNotionConverter.convertMessage(contentRoot);

        if (!result.markdown || !result.blocks?.length) {
          throw new Error("Empty message");
        }

        const payload = {
          copiedAt: new Date().toISOString(),
          blocks: result.blocks,
          markdown: result.markdown
        };

        await writeClipboard(result, payload);
        await persistLastCopy(result, payload);

        button.textContent = "Copied";
        showToast("Copied. Paste in Notion to create native equations.");
      } catch (error) {
        console.error("ChatGPT to Notion copy failed", error);
        button.textContent = "Retry";
        showToast("Copy failed. Check the browser console.");
      } finally {
        window.setTimeout(() => {
          button.disabled = false;
          button.textContent = previousText;
        }, 1400);
      }
    });

    return button;
  }

  function scheduleSelectionCopyButtonSync() {
    if (selectionSyncScheduled) {
      return;
    }

    selectionSyncScheduled = true;
    window.requestAnimationFrame(() => {
      selectionSyncScheduled = false;
      syncSelectionCopyButton();
    });
  }

  function syncSelectionCopyButton() {
    if (!uiState.enableCopyButton || document.hidden || !document.hasFocus()) {
      selectionCopyContext = null;
      removeSelectionCopyButton();
      return;
    }

    const selectionContext = resolveAssistantSelection(window.getSelection());
    if (!selectionContext) {
      selectionCopyContext = null;
      removeSelectionCopyButton();
      return;
    }

    selectionCopyContext = {
      range: selectionContext.range.cloneRange(),
      contentRoot: selectionContext.contentRoot
    };

    const button = ensureSelectionCopyButton();
    positionSelectionCopyButton(button, selectionCopyContext.range);
  }

  function ensureSelectionCopyButton() {
    const existing = document.getElementById(SELECTION_BUTTON_ID);
    if (existing) {
      return existing;
    }

    const button = document.createElement("button");
    button.id = SELECTION_BUTTON_ID;
    button.type = "button";
    button.className = "chatgpt-to-notion-selection-button";
    button.textContent = "Copy selection";

    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });

    button.addEventListener("click", async () => {
      if (!selectionCopyContext) {
        return;
      }

      await copySelectionContext(selectionCopyContext, button);
    });

    document.body.appendChild(button);
    return button;
  }

  function removeSelectionCopyButton() {
    document.getElementById(SELECTION_BUTTON_ID)?.remove();
  }

  function positionSelectionCopyButton(button, range) {
    const rect = getSelectionAnchorRect(range);
    if (!rect) {
      selectionCopyContext = null;
      removeSelectionCopyButton();
      return;
    }

    button.style.visibility = "hidden";
    button.style.left = "0px";
    button.style.top = "0px";

    const buttonWidth = button.offsetWidth || 120;
    const buttonHeight = button.offsetHeight || 34;
    const left = Math.max(12, Math.min(rect.right + 10, window.innerWidth - buttonWidth - 12));
    const top = Math.max(12, rect.top - buttonHeight - 10);

    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.style.visibility = "visible";
  }

  function getSelectionAnchorRect(range) {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width || rect.height);
    if (rects.length) {
      return rects[rects.length - 1];
    }

    const boundingRect = range.getBoundingClientRect();
    if (boundingRect.width || boundingRect.height) {
      return boundingRect;
    }

    return null;
  }

  function handleSelectionCopy(event) {
    if (!event.clipboardData || !window.ChatGPTToNotionConverter?.convertFragment) {
      return;
    }

    const selectionContext = resolveAssistantSelection(window.getSelection());
    if (!selectionContext) {
      return;
    }

    if (!selectionTouchesMath(selectionContext.range, selectionContext.contentRoot)) {
      return;
    }

    const prepared = prepareSelectionCopy(selectionContext);
    if (!prepared) {
      return;
    }

    event.preventDefault();
    event.clipboardData.setData("text/plain", prepared.text);
    event.clipboardData.setData("text/html", prepared.html);

    void persistLastCopy(prepared.result, prepared.payload).catch((error) => {
      console.error("ChatGPT to Notion selection copy persist failed", error);
    });
  }

  async function copySelectionContext(selectionContext, button) {
    const prepared = prepareSelectionCopy(selectionContext);
    if (!prepared) {
      showToast("Nothing to copy from this selection.");
      return;
    }

    const previousText = button?.textContent || "Copy selection";

    if (button) {
      button.disabled = true;
      button.textContent = "Copying...";
    }

    try {
      await writeClipboard(prepared.result, prepared.payload);
      await persistLastCopy(prepared.result, prepared.payload);
      showToast("Selected content copied for Notion.");
      selectionCopyContext = null;
      removeSelectionCopyButton();
    } catch (error) {
      console.error("ChatGPT to Notion selection copy failed", error);
      showToast("Selection copy failed. Check the browser console.");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = previousText;
      }
    }
  }

  function prepareSelectionCopy(selectionContext) {
    if (!selectionContext || !window.ChatGPTToNotionConverter?.convertFragment) {
      return null;
    }

    const expandedRange = expandRangeAroundMath(selectionContext.range);
    const fragment = expandedRange.cloneContents();
    const container = document.createElement("div");
    container.appendChild(fragment);

    const result = window.ChatGPTToNotionConverter.convertFragment(container);
    if (!result?.markdown || !result.blocks?.length) {
      return null;
    }

    const payload = {
      copiedAt: new Date().toISOString(),
      blocks: result.blocks,
      markdown: result.markdown
    };
    const marker = encodePayload(payload);

    return {
      result,
      payload,
      text: wrapClipboardText(result.markdown, marker),
      html: wrapClipboardHtml(result.html, marker)
    };
  }

  function resolveAssistantSelection(selection) {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const contentRoot = closestContentRoot(range.startContainer);
    const endContentRoot = closestContentRoot(range.endContainer);

    if (!contentRoot || contentRoot !== endContentRoot) {
      return null;
    }

    if (!contentRoot.closest(MESSAGE_SELECTOR) || !isAssistantMessage(contentRoot.closest(MESSAGE_SELECTOR))) {
      return null;
    }

    if (isEditableNode(selection.anchorNode) || isEditableNode(selection.focusNode)) {
      return null;
    }

    return {
      range,
      contentRoot
    };
  }

  function closestContentRoot(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.(CONTENT_SELECTOR) || null;
  }

  function selectionTouchesMath(range, contentRoot) {
    if (!range || !contentRoot) {
      return false;
    }

    if (closestMathElement(range.startContainer) || closestMathElement(range.endContainer)) {
      return true;
    }

    const mathElements = contentRoot.querySelectorAll(MATH_SELECTOR);

    for (const element of mathElements) {
      try {
        if (range.intersectsNode(element)) {
          return true;
        }
      } catch (error) {
        console.warn("Failed to inspect selection math intersection", error);
      }
    }

    return false;
  }

  function expandRangeAroundMath(range) {
    const expandedRange = range.cloneRange();
    const startMath = closestMathElement(expandedRange.startContainer);
    const endMath = closestMathElement(expandedRange.endContainer);

    if (startMath) {
      expandedRange.setStartBefore(startMath);
    }

    if (endMath) {
      expandedRange.setEndAfter(endMath);
    }

    return expandedRange;
  }

  function closestMathElement(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.(MATH_SELECTOR) || null;
  }

  function isEditableNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!element) {
      return false;
    }

    if (element.isContentEditable) {
      return true;
    }

    return Boolean(element.closest("input, textarea, [contenteditable='true'], [role='textbox']"));
  }

  async function writeClipboard(result, payload) {
    const marker = encodePayload(payload);
    const htmlWithMarker = wrapClipboardHtml(result.html, marker);
    const textWithMarker = wrapClipboardText(result.markdown, marker);
    const textBlob = new Blob([textWithMarker], { type: "text/plain" });
    const htmlBlob = new Blob([htmlWithMarker], { type: "text/html" });

    if (navigator.clipboard?.write && window.ClipboardItem) {
      const item = new ClipboardItem({
        "text/plain": textBlob,
        "text/html": htmlBlob
      });
      await navigator.clipboard.write([item]);
      return;
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(result.markdown);
      return;
    }

    throw new Error("Clipboard API unavailable");
  }

  async function persistLastCopy(result, payload) {
    if (!chrome?.storage?.local) {
      return;
    }

    try {
      await chrome.storage.local.set({
        chatgptToNotionLastCopy: {
          copiedAt: payload.copiedAt,
          markdown: result.markdown,
          html: result.html,
          blocks: result.blocks
        }
      });
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        showToast("Extension updated. Reloading this ChatGPT tab...");
        window.setTimeout(() => {
          window.location.reload();
        }, 600);
      }

      throw error;
    }
  }

  function wrapClipboardHtml(html, marker) {
    const escapedMarker = escapeAttribute(marker);
    return `<div data-chatgpt-to-notion-payload="${escapedMarker}">${html}</div>`;
  }

  function wrapClipboardText(markdown, marker) {
    return `${TEXT_PAYLOAD_HEADER}\n${encodeHiddenMarker(marker)}\n${markdown}`;
  }

  function encodePayload(payload) {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  }

  function encodeHiddenMarker(base64Payload) {
    const bits = Array.from(base64Payload)
      .map((char) => char.charCodeAt(0).toString(2).padStart(8, "0"))
      .join("")
      .replace(/0/g, HIDDEN_ZERO)
      .replace(/1/g, HIDDEN_ONE);

    return `${HIDDEN_PAYLOAD_START}${bits}${HIDDEN_PAYLOAD_END}`;
  }

  function escapeAttribute(text) {
    return (text || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function showToast(message) {
    const existing = document.querySelector("[data-chatgpt-to-notion-toast]");
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement("div");
    toast.className = "chatgpt-to-notion-toast";
    toast.setAttribute("data-chatgpt-to-notion-toast", "true");
    toast.textContent = message;

    document.body.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add("is-visible");
    }, 10);

    window.setTimeout(() => {
      toast.classList.remove("is-visible");
      window.setTimeout(() => toast.remove(), 180);
    }, 2200);
  }

  function isExtensionContextInvalidated(error) {
    return /Extension context invalidated/i.test(String(error?.message || error));
  }

  void boot();
})();
