const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const source = readFileSync(path.join(__dirname, "../converter.js"), "utf8");

test("PDF citation chips and source footers are omitted without deleting their paragraphs", t => {
  const dom = new JSDOM('<div id="answer">' +
    '<p>Keep this sentence. <span data-testid="file-citation"><span>Lecture Slides.pdf</span></span></p>' +
    '<p>Keep this too. <span role="button" tabindex="0"><svg></svg><span>Financial Investment Products_PDF.pdf</span></span></p>' +
    '<p>With a source <span class="group/citation"><a href="https://example.org">Source title</a></span> and math <span class="katex" data-latex="x^2">x2</span>.</p>' +
    '<div data-testid="sources-footer"><span>Sources</span><a href="https://example.org">Footer reference</a></div>' +
    '</div>', { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(source);
  const root = dom.window.document.querySelector("#answer");
  const before = root.innerHTML;
  for (const method of ["convertMessage", "convertFragment"]) {
    const result = dom.window.ChatGPTToNotionConverter[method](root);
    assert.doesNotMatch(JSON.stringify(result), /Lecture Slides|Financial Investment|Source title|Footer reference|Sources/);
    assert.match(result.markdown, /Keep this sentence/);
    assert.match(result.markdown, /Keep this too/);
    assert.match(result.markdown, /x\^2/);
  }
  assert.equal(root.innerHTML, before);
});

test("ordinary PDF links, filenames, code and bibliography prose remain editable content", t => {
  const dom = new JSDOM('<div id="answer"><p>Open report.pdf later. <a href="https://example.org/report.pdf">Read report.pdf</a></p>' +
    '<p>Source: Example textbook.</p><h2>References</h2><p>Author, 2026.</p>' +
    '<pre><code>data-testid="file-citation"</code></pre></div>', { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(source);
  const result = dom.window.ChatGPTToNotionConverter.convertMessage(dom.window.document.querySelector("#answer"));
  assert.match(result.markdown, /Open report.pdf later/);
  assert.match(result.markdown, /https:\/\/example.org\/report.pdf/);
  assert.match(result.markdown, /Source: Example textbook/);
  assert.match(result.markdown, /Author, 2026/);
  assert.match(result.markdown, /data-testid="file-citation"/);
});

test("a focusable message ending in a PDF link is not mistaken for a source chip", t => {
  const dom = new JSDOM('<div id="answer" tabindex="0"><p>Keep the answer.</p><p><svg></svg><a href="https://example.org/report.pdf">report.pdf</a></p></div>', { runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(source);
  const result = dom.window.ChatGPTToNotionConverter.convertMessage(dom.window.document.querySelector("#answer"));
  assert.match(result.markdown, /Keep the answer/);
  assert.match(result.markdown, /https:\/\/example.org\/report.pdf/);
});
