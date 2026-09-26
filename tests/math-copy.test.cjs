const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const katex = require("katex");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { flushSync } = require("react-dom");

const bridgeSource = readFileSync(path.join(__dirname, "../chatgpt-math-source.js"), "utf8");
const converterSource = readFileSync(path.join(__dirname, "../converter.js"), "utf8");
const rendererSource = readFileSync(path.join(__dirname, "../vendor/math-renderer.js"), "utf8");
const citation = ":contentReference[oaicite:16]{index=16}";
const formulas = [
  String.raw`dS = \mu S\,dt`,
  String.raw`\frac{dS}{S} = \mu\,dt.`,
  String.raw`\boxed{S_T = S_0 e^{\mu T}}`,
  String.raw`S_0 \to S_0 e^\mu \to S_0 e^{2\mu} \to \cdots`
];

function setup(t, sources = formulas, options = {}) {
  const dom = new JSDOM('<!doctype html><article data-message-author-role="assistant" data-testid="conversation-turn-1"><div class="markdown"></div></article>', {
    runScripts: "outside-only",
    url: "https://chatgpt.com/"
  });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.requestAnimationFrame = () => 0;
  const root = window.document.querySelector(".markdown");
  sources.forEach((source) => {
    const paragraph = window.document.createElement("p");
    paragraph.innerHTML = katex.renderToString(source, {
      displayMode: options.displayMode !== false,
      output: options.output || "html"
    });
    root.appendChild(paragraph);
  });
  window.eval(converterSource);
  window.eval(rendererSource);
  window.eval(bridgeSource);
  return {
    window,
    root,
    maths: [...root.querySelectorAll(".katex")],
    hydrate() {
      window.document.dispatchEvent(new window.CustomEvent("chatgpt-to-notion:hydrate-math"));
    },
    convert() {
      return JSON.parse(JSON.stringify(window.ChatGPTToNotionConverter.convertMessage(root)));
    }
  };
}

function attachFiber(element, props, parent = null, pendingProps = null) {
  const fiber = { stateNode: element, memoizedProps: props, pendingProps, return: parent };
  element.__reactFiber$test = fiber;
  return fiber;
}

async function bootCopyUi(fixture) {
  const { window } = fixture;
  const writes = [];
  const stored = {};
  window.chrome = { storage: {
    local: { get: async () => ({}), set: async value => Object.assign(stored, value) },
    onChanged: { addListener() {} }
  } };
  window.TextEncoder = TextEncoder;
  window.Blob = Blob;
  window.ClipboardItem = class { constructor(data) { this.data = data; } };
  Object.defineProperty(window.navigator, "clipboard", {
    value: { write: async items => writes.push(items[0].data) }
  });
  window.eval(readFileSync(path.join(__dirname, "../source-providers.js"), "utf8"));
  window.eval(readFileSync(path.join(__dirname, "../content.js"), "utf8"));
  await new Promise(setImmediate);
  return { writes, stored };
}

function decodeHtmlPayload(window, html) {
  const container = window.document.createElement("div");
  container.innerHTML = html;
  const marker = container.firstElementChild.getAttribute("data-chatgpt-to-notion-payload");
  return JSON.parse(Buffer.from(marker, "base64").toString("utf8"));
}

function expressions(result) {
  const found = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.type === "math" || value.type === "equation") found.push(value.latex);
    Object.values(value).forEach((child) => {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    });
  }
  visit(result.blocks ? { children: result.blocks } : result);
  return found;
}

function assertFormulas(result, expected = formulas) {
  assert.deepEqual(expressions(result), expected);
  assert.doesNotMatch(result.markdown, /contentReference|oaicite/);
  assert.doesNotMatch(result.html, /contentReference|oaicite/);
  expected.forEach((latex) => assert.doesNotThrow(() => katex.renderToString(latex)));
}

test("citation tokens cannot replace the fraction; message order recovers its original source", (t) => {
  const fixture = setup(t);
  const message = formulas.map((latex) => "\\[\n" + latex + "\n\\]").join("\n" + citation + "\n");
  const messageFiber = attachFiber(fixture.root, { children: message });
  fixture.maths.forEach((element, index) => {
    attachFiber(element, {
      children: index === 1 ? "\\frac" + citation : formulas[index] + (index === 2 ? citation : "")
    }, messageFiber);
  });
  fixture.hydrate();
  assertFormulas(fixture.convert());
});

test("citations embedded in fraction arguments and after boxed formulas are removed", (t) => {
  const fixture = setup(t);
  const contaminated = [
    formulas[0],
    formulas[1].replace("\\frac", "\\frac" + citation),
    formulas[2] + " " + citation,
    formulas[3]
  ];
  fixture.maths.forEach((element, index) => attachFiber(element, { latex: contaminated[index] }));
  fixture.hydrate();
  const result = fixture.convert();
  assertFormulas(result);
  const selection = fixture.window.document.createElement("div");
  selection.append(...[...fixture.root.childNodes].map((node) => node.cloneNode(true)));
  const fragment = fixture.window.ChatGPTToNotionConverter.convertFragment(selection);
  assertFormulas(JSON.parse(JSON.stringify(fragment)));
  const single = fixture.window.ChatGPTToNotionConverter.convertMathElement(fixture.maths[1].closest(".katex-display"));
  assert.deepEqual(expressions(JSON.parse(JSON.stringify(single))), [formulas[1]]);
});

test("TeX annotations, source attributes and raw delimiters are sanitized at conversion", (t) => {
  for (const kind of ["annotation", "data-latex", "data-chatgpt-to-notion-latex", "text"]) {
    const fixture = setup(t, [formulas[2]], { output: "htmlAndMathml" });
    const contaminated = formulas[2] + citation;
    const annotation = fixture.root.querySelector("annotation");
    if (kind === "annotation") annotation.textContent = contaminated;
    else {
      fixture.maths[0].querySelector(".katex-mathml").remove();
      if (kind === "text") fixture.root.textContent = "\\[" + contaminated + "\\]";
      else fixture.maths[0].setAttribute(kind, contaminated);
    }
    assertFormulas(fixture.convert(), [formulas[2]]);
  }
});

test("source lookup ignores metadata, incidental prose and sibling formulas", (t) => {
  const fixture = setup(t, [formulas[1]]);
  const unrelated = attachFiber(fixture.root.parentElement.parentElement, { children: "Unrelated \\[x=y\\]" });
  const paragraph = fixture.maths[0].closest("p");
  const parent = attachFiber(paragraph, { children: "See \\[a=b\\] elsewhere." }, unrelated);
  attachFiber(fixture.maths[0], {
    className: "math-inline",
    context: "not-a-formula",
    node: { type: "math" },
    children: citation
  }, parent);
  fixture.hydrate();
  assert.equal(fixture.maths[0].getAttribute("data-chatgpt-to-notion-latex"), null);
});

test("ordered fallback checks known equations and ignores code examples", (t) => {
  const fixture = setup(t);
  const message = formulas.map((latex) => "\\[" + latex + "\\]").join("\n");
  const messageFiber = attachFiber(fixture.root, {
    source: "\\[a=b\\]\n\\[c=d\\]\n\\[e=f\\]\n\\[g=h\\]",
    content: "\x60\x60\x60latex\n\\[example=0\\]\n\x60\x60\x60\n\x60\\[inline=0\\]\x60\n" + message
  });
  fixture.maths.forEach((element, index) => attachFiber(element, index === 1 ? {} : { latex: formulas[index] }, messageFiber));
  fixture.hydrate();
  assertFormulas(fixture.convert());
});

test("streaming updates replace cached sources and prefer rendered over pending props", (t) => {
  const fixture = setup(t, [formulas[1]]);
  fixture.maths[0].setAttribute("data-chatgpt-to-notion-latex", citation);
  const fiber = attachFiber(fixture.maths[0], { children: formulas[1] }, null, { latex: "x=y" });
  fixture.hydrate();
  assertFormulas(fixture.convert(), [formulas[1]]);
  fiber.memoizedProps = { children: "a=b" };
  fixture.maths[0].innerHTML = katex.renderToString("a=b", { output: "html", displayMode: true });
  fixture.hydrate();
  assertFormulas(fixture.convert(), ["a=b"]);
});

test("ambiguous message sources do not fill an equation by count alone", (t) => {
  const fixture = setup(t, [formulas[1]]);
  attachFiber(fixture.root, { source: "\\[a=b\\]", content: "\\[x=y\\]" });
  fixture.hydrate();
  assert.equal(fixture.maths[0].getAttribute("data-chatgpt-to-notion-latex"), null);
});

test("math component props remain accessible through a render-only host fiber", (t) => {
  const fixture = setup(t, [formulas[1]]);
  const component = { stateNode: null, memoizedProps: { children: formulas[1] }, return: null };
  attachFiber(fixture.maths[0], { dangerouslySetInnerHTML: { __html: fixture.maths[0].innerHTML } }, component);
  fixture.hydrate();
  assertFormulas(fixture.convert(), [formulas[1]]);
});

test("ordinary annotations and inline math still copy without duplication", (t) => {
  const fixture = setup(t, [formulas[0]], { output: "htmlAndMathml", displayMode: false });
  const paragraph = fixture.root.firstElementChild;
  paragraph.prepend(fixture.window.document.createTextNode("Before "));
  paragraph.append(fixture.window.document.createTextNode(" after."));
  fixture.hydrate();
  const result = fixture.convert();
  assertFormulas(result, [formulas[0]]);
  assert.equal(result.blocks.length, 1);
  assert.match(result.markdown, /^Before /);
  assert.match(result.markdown, / after\.$/);
});

test("code samples retain literal citation syntax", (t) => {
  const fixture = setup(t, []);
  const pre = fixture.window.document.createElement("pre");
  const code = fixture.window.document.createElement("code");
  code.textContent = citation + " " + formulas[1];
  pre.appendChild(code);
  fixture.root.appendChild(pre);
  assert.equal(fixture.convert().blocks[0].code, code.textContent);
});

test("real React HTML-only math keeps formulas when the source is on an outer wrapper", async (t) => {
  const fixture = setup(t, []);
  const previousWindow = global.window;
  global.window = fixture.window;
  const reactRoot = createRoot(fixture.root);
  function Formula({ source }) {
    return React.createElement("span", {
      className: "formula-wrapper",
      dangerouslySetInnerHTML: { __html: katex.renderToString(source, { output: "html", displayMode: true }) }
    });
  }
  try {
    flushSync(() => reactRoot.render(React.createElement("div", null,
      React.createElement("p", null, "Before"),
      ...formulas.map((source, index) => React.createElement(Formula, { key: index, source })),
      React.createElement("p", null, "After")
    )));
    assert.equal(fixture.root.querySelector("annotation"), null);
    assert.equal(Object.keys(fixture.root.querySelector(".katex")).some(key => key.startsWith("__react")), false);
    fixture.hydrate();
    assertFormulas(fixture.convert());
    assert.match(fixture.convert().markdown, /Before/);
    assert.match(fixture.convert().markdown, /After/);
    const clipboard = await bootCopyUi(fixture);
    fixture.window.document.querySelector("[data-chatgpt-to-notion-button]").click();
    await new Promise(setImmediate);
    assert.equal(clipboard.writes.length, 1);
    assert.deepEqual(expressions(decodeHtmlPayload(fixture.window, await clipboard.writes[0]["text/html"].text())), formulas);
    assert.deepEqual(expressions(JSON.parse(JSON.stringify(clipboard.stored.chatgptToNotionLastCopy))), formulas);

    const range = fixture.window.document.createRange();
    range.selectNodeContents(fixture.root);
    fixture.window.getSelection().addRange(range);
    const event = new fixture.window.Event("copy", { bubbles: true, cancelable: true });
    const selectionData = {};
    Object.defineProperty(event, "clipboardData", { value: { setData: (type, value) => { selectionData[type] = value; } } });
    fixture.window.document.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.deepEqual(expressions(decodeHtmlPayload(fixture.window, selectionData["text/html"])), formulas);
  } finally {
    flushSync(() => reactRoot.unmount());
    await new Promise(setImmediate);
    global.window = previousWindow;
  }
});

test("long message sources on the owning component remain available", (t) => {
  const fixture = setup(t);
  const message = "Long explanation. ".repeat(2000) + formulas.map(source => "\\[" + source + "\\]").join("\n");
  const owner = { stateNode: null, memoizedProps: { content: message }, return: null };
  attachFiber(fixture.root.parentElement, {}, owner);
  fixture.hydrate();
  assertFormulas(fixture.convert());
});

test("missing formula sources cannot produce a successful text-only copy", async (t) => {
  const fixture = setup(t);
  fixture.root.prepend(fixture.window.document.createTextNode("Before"));
  fixture.maths.slice(1).forEach((element, index) => attachFiber(element, { latex: formulas[index + 1] }));
  fixture.window.console.error = () => {};
  fixture.window.console.warn = () => {};
  const clipboard = await bootCopyUi(fixture);
  fixture.window.document.querySelector("[data-chatgpt-to-notion-button]").click();
  await new Promise(setImmediate);
  assert.equal(clipboard.writes.length, 0);
  assert.equal(clipboard.stored.chatgptToNotionLastCopy, undefined);
  assert.match(fixture.window.document.querySelector("[data-chatgpt-to-notion-toast]").textContent, /Couldn't copy every formula/);

  const range = fixture.window.document.createRange();
  range.selectNodeContents(fixture.root);
  fixture.window.getSelection().addRange(range);
  const event = new fixture.window.Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { setData: () => assert.fail("Must not write partial content") } });
  fixture.window.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
});

test("alternate React props, single symbols and inequality formulas can be recovered", (t) => {
  for (const source of ["x", "x < y", "x_2", "x^2"]) {
    const fixture = setup(t, [source], { displayMode: false });
    const fiber = attachFiber(fixture.maths[0].parentElement, { latex: "wrong" });
    fiber.alternate = { memoizedProps: { children: source } };
    fixture.hydrate();
    assertFormulas(fixture.convert(), [source]);
  }
});

test("valid cached sources survive absent React props and mismatched sources are rejected", (t) => {
  const fixture = setup(t, ["x^2"]);
  fixture.maths[0].setAttribute("data-chatgpt-to-notion-latex", "x^2");
  fixture.hydrate();
  assertFormulas(fixture.convert(), ["x^2"]);
  fixture.maths[0].setAttribute("data-chatgpt-to-notion-latex", "x_2");
  attachFiber(fixture.root, { source: "\\[x_2\\]" });
  fixture.hydrate();
  assert.equal(fixture.maths[0].getAttribute("data-chatgpt-to-notion-latex"), null);
});

test("new ChatGPT markdown roots hydrate formulas and support full and selected copies", async (t) => {
  const fixture = setup(t);
  const { window, root } = fixture;
  const wrapper = root.parentElement;
  wrapper.removeAttribute("data-message-author-role");
  wrapper.removeAttribute("data-testid");
  wrapper.setAttribute("data-chatgpt-selection-message-id", "fixture-answer");
  root.className = "MarkdownRoot-fixture";
  root.setAttribute("data-markdown-text-style", "assistant-message");
  root.setAttribute("data-markdown-text-tone", "primary");
  attachFiber(root, { children: formulas.map(source => `\\[${source}\\]`).join("\n\n") });
  fixture.hydrate();
  assertFormulas(fixture.convert());
  const clipboard = await bootCopyUi(fixture);
  window.document.querySelector("[data-chatgpt-to-notion-button]").click();
  await new Promise(setImmediate);
  assert.equal(clipboard.writes.length, 1);
  assert.deepEqual(expressions(decodeHtmlPayload(window, await clipboard.writes[0]["text/html"].text())), formulas);

  const range = window.document.createRange();
  range.selectNodeContents(root);
  window.getSelection().addRange(range);
  const event = new window.Event("copy", { bubbles: true, cancelable: true });
  const data = {};
  Object.defineProperty(event, "clipboardData", { value: { setData: (type, value) => { data[type] = value; } } });
  window.document.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.deepEqual(expressions(decodeHtmlPayload(window, data["text/html"])), formulas);
});
