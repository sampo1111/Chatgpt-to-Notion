(function () {
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
  const PROCESSED_ATTRIBUTE = "data-chatgpt-to-notion-processed";

  function boot() {
    injectButtons();
    observeConversation();
  }

  function observeConversation() {
    const observer = new MutationObserver(() => {
      injectButtons();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function injectButtons() {
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

  boot();
})();
