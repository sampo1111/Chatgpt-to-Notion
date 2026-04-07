(function () {
  function uniqueElements(elements) {
    const seen = new Set();
    const output = [];

    for (const element of elements || []) {
      if (!(element instanceof Element) || seen.has(element)) {
        continue;
      }

      seen.add(element);
      output.push(element);
    }

    return output;
  }

  function topLevelElements(elements) {
    return uniqueElements(elements).filter(
      (element, _, all) => !all.some((other) => other !== element && other.contains(element))
    );
  }

  function collectMatches(root, selector) {
    if (!root || !selector) {
      return [];
    }

    const elements = [];
    const canQuery =
      root instanceof Document || root instanceof DocumentFragment || root instanceof Element;

    if (root instanceof Element && root.matches(selector)) {
      elements.push(root);
    }

    if (!canQuery || typeof root.querySelectorAll !== "function") {
      return elements;
    }

    elements.push(...Array.from(root.querySelectorAll(selector)));
    return elements;
  }

  function buildProvider(definition) {
    return {
      ...definition,
      getMessageRoots() {
        return this.getMessageRootsInSubtree(document);
      },
      getMessageRootsInSubtree(root) {
        const selected = topLevelElements(collectMatches(root, definition.messageSelector));
        if (selected.length) {
          return selected;
        }

        if (!definition.contentSelector) {
          return selected;
        }

        const fallbackRoots = collectMatches(root, definition.contentSelector)
          .map((element) => element.closest(definition.messageRootSelector || definition.messageSelector) || element);

        return topLevelElements(fallbackRoots);
      },
      getContentRoot(message) {
        if (!message) {
          return null;
        }

        if (definition.contentSelector && message.matches(definition.contentSelector)) {
          return message;
        }

        if (!definition.contentSelector) {
          return message;
        }

        return message.querySelector(definition.contentSelector) || null;
      },
      getButtonOwner(message, contentRoot) {
        if (typeof definition.getButtonOwner === "function") {
          return definition.getButtonOwner(message, contentRoot) || message || contentRoot || null;
        }

        return message || contentRoot || null;
      },
      mountButton(context) {
        if (typeof definition.mountButton === "function") {
          return definition.mountButton(context);
        }

        context.anchor?.appendChild?.(context.button);
        return context.button;
      },
      getMessageRootForNode(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (!element) {
          return null;
        }

        return (
          element.closest(definition.messageRootSelector || definition.messageSelector) ||
          (definition.contentSelector && element.closest(definition.contentSelector)) ||
          null
        );
      },
      closestContentRoot(node) {
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        if (!element || !definition.contentSelector) {
          return null;
        }

        return element.closest(definition.contentSelector) || null;
      }
    };
  }

  const chatgptProvider = buildProvider({
    id: "chatgpt",
    label: "ChatGPT",
    hostnames: ["chatgpt.com", "chat.openai.com"],
    messageSelector: "[data-message-author-role='assistant'], article[data-testid^='conversation-turn-']",
    messageRootSelector: "[data-message-author-role='assistant'], article[data-testid^='conversation-turn-']",
    contentSelector: ".markdown, [class*='markdown'], [data-testid='conversation-turn-content']",
    isAssistantMessage(message) {
      const role = message?.getAttribute?.("data-message-author-role");
      if (role === "assistant") {
        return true;
      }

      return message?.querySelector?.("[data-message-author-role='assistant']") !== null;
    },
    isWrapperForAssistant(message) {
      return (
        message?.getAttribute?.("data-message-author-role") !== "assistant" &&
        message?.querySelector?.("[data-message-author-role='assistant']") !== null
      );
    },
    findButtonAnchor(message, contentRoot) {
      return (
        message?.querySelector?.("[data-testid='conversation-turn-actions']") ||
        message?.querySelector?.("[data-testid='turn-actions']") ||
        message?.querySelector?.("footer") ||
        contentRoot?.parentElement ||
        message
      );
    }
  });

  const geminiProvider = buildProvider({
    id: "gemini",
    label: "Gemini",
    hostnames: ["gemini.google.com"],
    messageSelector: [
      "model-response",
      "response-container",
      "[data-test-id='model-response']",
      "[data-response-id]",
      "[class*='model-response']",
      "[class*='response-container']"
    ].join(", "),
    messageRootSelector: [
      "model-response",
      "response-container",
      "[data-test-id='model-response']",
      "[data-response-id]",
      "[class*='model-response']",
      "[class*='response-container']"
    ].join(", "),
    contentSelector: [
      "message-content",
      ".markdown",
      "[class*='markdown']",
      "[class*='response-content']",
      ".response-content",
      ".model-response-text",
      "[data-message-content]"
    ].join(", "),
    isAssistantMessage(message) {
      if (!message) {
        return false;
      }

      if (
        message.matches?.("user-query, [data-test-id='user-query'], [class*='user-query']") ||
        message.closest?.("user-query, [data-test-id='user-query'], [class*='user-query']")
      ) {
        return false;
      }

      const contentRoot = this.getContentRoot(message);
      return Boolean(contentRoot);
    },
    isWrapperForAssistant() {
      return false;
    },
    getButtonOwner(message, contentRoot) {
      return (
        contentRoot?.closest?.("response-container, model-response, [data-response-id]") ||
        message?.closest?.("response-container, model-response, [data-response-id]") ||
        message ||
        contentRoot ||
        null
      );
    },
    findButtonAnchor(message, contentRoot, owner) {
      return (
        owner?.querySelector?.("message-actions") ||
        message?.querySelector?.("message-actions") ||
        owner?.querySelector?.("footer") ||
        message?.querySelector?.("footer") ||
        contentRoot?.parentElement ||
        owner ||
        message
      );
    },
    mountButton({ owner, anchor, button, contentRoot }) {
      const slotOwner = owner || anchor;
      if (!slotOwner) {
        anchor?.appendChild?.(button);
        return button;
      }

      const referenceNode = anchor instanceof Element ? anchor : null;
      const insertionParent = referenceNode?.parentElement || slotOwner;
      let slot = slotOwner.querySelector("[data-ai-to-notion-action-slot='gemini']");
      if (!slot) {
        slot = document.createElement("div");
        slot.className = "chatgpt-to-notion-action-slot";
        slot.setAttribute("data-ai-to-notion-action-slot", "gemini");
      }

      if (referenceNode && insertionParent) {
        if (slot.parentElement !== insertionParent || slot.nextSibling !== referenceNode) {
          insertionParent.insertBefore(slot, referenceNode);
        }
      } else if (slot.parentElement !== slotOwner) {
        slotOwner.appendChild(slot);
      }

      if (referenceNode && insertionParent) {
        const parentRect = insertionParent.getBoundingClientRect();
        const contentRect = contentRoot instanceof Element ? contentRoot.getBoundingClientRect() : null;
        const referenceRect = contentRect || referenceNode.getBoundingClientRect();
        const offsetLeft = Math.max(0, Math.round(referenceRect.left - parentRect.left));
        const contentWidth = Math.max(0, Math.round(referenceRect.width));

        slot.style.marginLeft = offsetLeft > 0 ? `${offsetLeft}px` : "";
        slot.style.width = contentWidth > 0 ? `${contentWidth}px` : "";
        slot.style.maxWidth = offsetLeft > 0 ? `calc(100% - ${offsetLeft}px)` : "100%";
      } else {
        slot.style.marginLeft = "";
        slot.style.width = "";
        slot.style.maxWidth = "";
      }

      button.classList.add("chatgpt-to-notion-button--wide");
      slot.appendChild(button);
      return button;
    }
  });

  const providers = [chatgptProvider, geminiProvider];

  function resolveCurrentProvider() {
    const hostname = window.location.hostname;
    return (
      providers.find((provider) =>
        provider.hostnames.some((host) => hostname === host || hostname.endsWith(`.${host}`))
      ) || null
    );
  }

  window.AIToNotionSourceProviders = {
    providers,
    resolveCurrentProvider
  };
})();
