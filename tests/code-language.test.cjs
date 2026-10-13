const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const root = path.join(__dirname, "..");
const source = "n = 0\nsum = 0\n\nrepeat {\n  n = n + 1\n  sum = sum + n\n  if (n <= -1) break\n}";
const actualRCode = readFileSync(path.join(root, "tests/fixtures/chatgpt-r-code.html"), "utf8");
const actualRSource = "x = c(100,120,130,124,150,167,\n      170,163,160,155,145,157)\n\nn = 0\nsum1 = 0\nsum2 = 0\n\nrepeat {\n    n = n + 1\n    sum1 = sum1 + x[n]\n    sum2 = sum2 + x[n]^2\n\n    if (n >= length(x)) break\n}";

function convert(t, html, method = "convertMessage") {
  const dom = new JSDOM(`<div id="answer">${html}</div>`, { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(readFileSync(path.join(root, "converter.js"), "utf8"));
  const answer = dom.window.document.querySelector("#answer");
  const before = answer.innerHTML;
  const result = JSON.parse(JSON.stringify(dom.window.ChatGPTToNotionConverter[method](answer)));
  assert.equal(answer.innerHTML, before, "Language extraction must not change the source page");
  return result;
}

const layouts = [
  ["syntax class", `<pre><code class="hljs language-r">${source}</code></pre>`, "r"],
  ["language attribute", `<pre data-language="R"><code>${source}</code></pre>`, "r"],
  ["code attribute", `<pre><code data-lang="Python">${source}</code></pre>`, "python"],
  ["pre class", `<pre class="language-C++"><code>${source}</code></pre>`, "c++"],
  ["lang class", `<pre><code class="lang-csharp">${source}</code></pre>`, "csharp"],
  ["ChatGPT toolbar", `<pre><div><span>R</span><button>Copy code</button><button>Run</button></div><div><code>${source}</code></div></pre>`, "r"],
  ["Gemini outer toolbar", `<code-block><div class="code-block-decoration"><span>Python</span><button>Copy</button></div><pre><code>${source}</code></pre></code-block>`, "python"],
  ["Claude outer toolbar", `<div><div><span>TypeScript</span><button>Copy</button></div><div><pre><code>${source}</code></pre></div></div>`, "typescript"],
  ["toolbar without code tag", `<pre><div>R<button>Copy</button></div>${source}</pre>`, "r"],
  ["explicit metadata beats toolbar", `<div><div>Python<button>Copy</button></div><pre><code class="language-r">${source}</code></pre></div>`, "r"]
];

test("the supplied deeply nested ChatGPT code surface retains R without a stray toolbar paragraph", t => {
  for (const method of ["convertMessage", "convertFragment"]) {
    const result = convert(t, `<p>Before</p>${actualRCode}<p>After</p>`, method);
    assert.deepEqual(result.blocks.map(block => block.type), ["paragraph", "code", "paragraph"]);
    assert.deepEqual(result.blocks[1], { type: "code", language: "r", code: actualRSource });
    assert.ok(result.html.includes('<pre data-language="r">'));
  }
});

test("deep code surfaces keep their own languages and do not leak a neighbor's label", t => {
  const dom = new JSDOM(actualRCode + actualRCode + actualRCode);
  t.after(() => dom.window.close());
  const surfaces = dom.window.document.querySelectorAll("[data-markdown-copy='code-block']");
  surfaces[1].querySelector("[data-markdown-copy='exclude'] > div").textContent = "Python";
  surfaces[2].querySelector("[data-markdown-copy='exclude']").remove();
  for (const method of ["convertMessage", "convertFragment"]) {
    const result = convert(t, dom.window.document.body.innerHTML, method);
    assert.deepEqual(result.blocks.map(block => block.type), ["code", "code", "code"]);
    assert.deepEqual(result.blocks.map(block => block.language), ["r", "python", ""]);
    assert.ok(result.blocks.every(block => block.code === actualRSource));
  }
});

for (const [name, html, language] of layouts) {
  test(`code language survives ${name} in message and fragment conversion`, t => {
    for (const method of ["convertMessage", "convertFragment"]) {
      const result = convert(t, html, method);
      assert.deepEqual(result.blocks, [{ type: "code", language, code: source }]);
      assert.equal(result.markdown, "```" + language + "\n" + source + "\n```");
      assert.ok(result.html.startsWith(`<pre data-language="${language}">`));
    }
  });
}

test("unlabeled snippets, inline code and nearby prose are not assigned a guessed language", t => {
  const result = convert(t, `<p>R</p><pre><code>2+3\n2*3</code></pre><p>Use <code>python</code> here.</p>`);
  assert.deepEqual(result.blocks.map(block => block.type), ["paragraph", "code", "paragraph"]);
  assert.equal(result.blocks[0].children[0].text, "R");
  assert.equal(result.blocks[1].language, "");
  assert.equal(result.blocks[2].children[1].type, "code");
});

test("adjacent code blocks keep their own language", t => {
  const result = convert(t, '<div><div>R</div><pre><code>print(1)</code></pre></div><div><div>Python</div><pre><code>print(2)</code></pre></div>');
  assert.deepEqual(result.blocks.map(block => block.language), ["r", "python"]);
});

test("a prose language name is not consumed as a code toolbar", t => {
  const result = convert(t, '<div><p>R</p><pre><code>2+3</code></pre></div>');
  assert.deepEqual(result.blocks.map(block => block.type), ["paragraph", "code"]);
  assert.equal(result.blocks[1].language, "");
});

test("language survives HTML and text-only clipboard fallback in Notion", async t => {
  const result = convert(t, layouts[5][1]);
  for (const format of ["text/html", "text/plain"]) {
    const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "https://www.notion.so/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    t.after(() => dom.window.close());
    const { window } = dom;
    const messages = [];
    window.requestAnimationFrame = () => {};
    window.chrome = {
      runtime: { sendMessage: async message => { messages.push(message); return { ok: true, appendedBlocks: 1 }; } },
      storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
    };
    window.eval(readFileSync(path.join(root, "notion-content.js"), "utf8"));
    await new Promise(setImmediate);
    const event = new window.Event("paste", { bubbles: true, cancelable: true });
    const text = "[[CHATGPT_TO_NOTION]]\n" + result.markdown;
    Object.defineProperty(event, "clipboardData", { value: {
      getData: type => type === "text/plain" ? text : type === "text/html" && format === "text/html" ? result.html : ""
    } });
    window.document.dispatchEvent(event);
    await new Promise(setImmediate);
    assert.equal(event.defaultPrevented, true);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].blocks[0].language, "r");
    assert.equal(messages[0].blocks[0].code, source);
  }
});

test("Notion API receives the source language and supported aliases", async t => {
  const requests = [];
  const context = vm.createContext({
    console, AbortController, TextEncoder, setTimeout, clearTimeout,
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: { local: {
        get: async () => ({ chatgptToNotionSettings: { notionToken: "test-token", enableFeature: true } }),
        set: async () => {}
      } }
    },
    fetch: async (url, options) => {
      assert.equal(options.method, "PATCH");
      const children = JSON.parse(options.body).children;
      requests.push(children);
      return new Response(JSON.stringify({ results: children.map((_, index) => ({ id: String(index + 1).padStart(32, "0") })) }));
    }
  });
  vm.runInContext(readFileSync(path.join(root, "background.js"), "utf8"), context);
  const fromPage = convert(t, layouts[5][1]).blocks;
  const aliases = { R: "r", py: "python", jsx: "javascript", tsx: "typescript", cpp: "c++", csharp: "c#", yml: "yaml", dockerfile: "docker", ps1: "powershell", unknown: "plain text" };
  await context.appendBlocksToNotionPage({
    pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", operationId: "language-test",
    blocks: [...fromPage, ...Object.keys(aliases).map(language => ({ type: "code", language, code: "sample\n  indented" }))]
  });
  assert.equal(requests[0][0].code.language, "r");
  assert.equal(requests[0][0].code.rich_text.map(part => part.text.content).join(""), source);
  assert.deepEqual(requests[0].slice(1).map(block => block.code.language), Object.values(aliases));
  assert.equal(context.normalizeCodeLanguage("__proto__"), "plain text");
});
