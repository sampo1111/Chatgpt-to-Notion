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

  function buildProvider(definition) {
    return {
      ...definition,
      getMessageRoots() {
        const selected = topLevelElements(Array.from(document.querySelectorAll(definition.messageSelector)));
        if (selected.length) {
          return selected;
        }

        if (!definition.contentSelector) {
          return selected;
        }

        const fallbackRoots = Array.from(document.querySelectorAll(definition.contentSelector))
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
    findButtonAnchor(message, contentRoot) {
      return (
        message?.querySelector?.("message-actions") ||
        message?.querySelector?.("[class*='action']") ||
        message?.querySelector?.("footer") ||
        contentRoot?.parentElement ||
        message
      );
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
