const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");

const buttonSelector = "[data-chatgpt-to-notion-button]";
const answer = (text) => `<div data-message-author-role="assistant"><div class="markdown"><p>${text}</p></div></div>`;
// The saved September 2026 page loads a client-rendered transcript. Its
// ChatGptMarkdown component emits these attributes (761910.1787dc6a1b.js).
const modernAnswer = (text) => `<div class="MarkdownRoot-fixture" data-markdown-text-style="assistant-message" data-markdown-text-tone="primary"><p>${text}</p></div>`;

async function setup(t, html) {
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://chatgpt.com/" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const frames = [];
  window.requestAnimationFrame = (callback) => frames.push(callback);
  window.chrome = { storage: {
    local: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener() {} }
  } };
  const copied = [];
  window.ChatGPTToNotionConverter = { convertMessage(root) {
    copied.push(root.textContent);
    return { markdown: root.textContent, blocks: [{ type: "paragraph" }], html: "<p>Answer</p>" };
  } };
  window.TextEncoder = TextEncoder;
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => {} } });
  for (const file of ["source-providers.js", "content.js"]) {
    window.eval(readFileSync(path.join(__dirname, "..", file), "utf8"));
  }
  async function flush() {
    // Drain both observer callbacks and animation frames; fail on injection loops.
    for (let i = 0; i < 20; i++) {
      await new Promise(setImmediate);
      if (!frames.length) return;
      frames.splice(0).forEach((callback) => callback());
    }
    assert.fail("Button injection did not settle");
  }
  await flush();
  return { document: window.document, flush, copied };
}

test("nested ChatGPT turns get one button per answer, excluding user messages", async (t) => {
  const { document, flush, copied } = await setup(t, `
    <article data-testid="conversation-turn-0"><div data-message-author-role="user"><div class="markdown">Question</div></div></article>
    <article data-testid="conversation-turn-1">${answer("First")}</article>
    <article data-testid="conversation-turn-2">${answer("Second")}</article>`);
  const buttons = document.querySelectorAll(buttonSelector);
  assert.equal(buttons.length, 2);
  assert.equal(document.querySelector("[data-message-author-role='user']").querySelector(buttonSelector), null);
  buttons[0].click();
  buttons[1].click();
  await flush();
  assert.deepEqual(copied, ["First", "Second"]);
});

test("removed buttons recover and replaced answer content is copied", async (t) => {
  const { document, flush, copied } = await setup(t, `<article data-testid="conversation-turn-1">${answer("Old")}</article>`);
  document.querySelector(buttonSelector).remove();
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);

  document.querySelector(".markdown").outerHTML = '<div class="markdown"><p>Updated answer</p></div>';
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);
  document.querySelector(buttonSelector).click();
  await flush();
  assert.deepEqual(copied, ["Updated answer"]);

  document.querySelector("[data-ai-to-notion-action-slot]").remove();
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);
});

test("streamed answers and newly inserted turns acquire buttons", async (t) => {
  const { document, flush } = await setup(t, '<article data-testid="conversation-turn-1"><div data-message-author-role="assistant"></div></article>');
  assert.equal(document.querySelectorAll(buttonSelector).length, 0);
  document.querySelector("[data-message-author-role]").innerHTML = '<div class="markdown">Streamed answer</div>';
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);
  document.body.insertAdjacentHTML("beforeend", `<article data-testid="conversation-turn-2">${answer("Next answer")}</article>`);
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 2);
});

test("new ChatGPT markdown roots get separate sibling buttons without injection loops", async (t) => {
  const { document, flush, copied } = await setup(t, `
    <div data-thread-user-message-navigation-content="true">
      <div data-user-message-bubble="true"><div data-markdown-text-style="user-message">Question</div></div>
      <div data-chatgpt-selection-message-id="fixture-answer">${modernAnswer("First")}${modernAnswer("Second")}</div>
      <div data-markdown-text-style="tool-output">Tool output</div>
    </div>`);
  assert.equal(document.querySelectorAll(buttonSelector).length, 2);
  const roots = [...document.querySelectorAll("[data-markdown-text-style='assistant-message']")];
  for (const root of roots) {
    assert.equal(root.querySelector(buttonSelector), null, "Button must stay outside copied content");
    assert.equal(root.nextElementSibling.getAttribute("data-ai-to-notion-action-slot"), "chatgpt");
    root.nextElementSibling.querySelector(buttonSelector).click();
  }
  await flush();
  assert.deepEqual(copied, ["First", "Second"]);
  roots[0].nextElementSibling.remove();
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 2);
  roots[0].outerHTML = modernAnswer("Replacement");
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 2);
  document.querySelector(buttonSelector).click();
  await flush();
  assert.deepEqual(copied, ["First", "Second", "Replacement"]);
});

test("new ChatGPT answers are detected after hydration and turn virtualization", async (t) => {
  const { document, flush, copied } = await setup(t, '<div data-thread-user-message-navigation-content="true"></div>');
  const transcript = document.querySelector("[data-thread-user-message-navigation-content]");
  transcript.innerHTML = '<div data-turn-key="first"><div class="MarkdownRoot-fixture"><p>Hydrated answer</p></div></div>';
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 0);
  transcript.querySelector(".MarkdownRoot-fixture").setAttribute("data-markdown-text-style", "assistant-message");
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);
  transcript.innerHTML = `<div data-turn-key="second">${modernAnswer("Next turn")}</div>`;
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);
  document.querySelector(buttonSelector).click();
  await flush();
  assert.deepEqual(copied, ["Next turn"]);
});

test("legacy and new ChatGPT selectors on the same answer do not duplicate buttons", async (t) => {
  const { document, flush } = await setup(t, `<article><div data-message-author-role="assistant">${modernAnswer("Answer")}</div></article>`);
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);
  document.querySelector("p").append(" More text");
  await flush();
  assert.equal(document.querySelectorAll(buttonSelector).length, 1);
});
