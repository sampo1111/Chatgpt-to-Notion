const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { JSDOM } = require("jsdom");
const source = readFileSync(path.join(__dirname, "../background.js"), "utf8");
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const uploadId = "11111111-2222-4333-8444-555555555555";
const pageId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const paragraph = { type: "paragraph", children: [{ type: "text", text: "Editable text" }] };

function background(options = {}) {
  const requests = [];
  const stored = { chatgptToNotionSettings: { notionToken: "test-token", enableFeature: true } };
  const context = vm.createContext({
    console, Blob, FormData, AbortController, Uint8Array, TextEncoder, atob, setTimeout, clearTimeout,
    chrome: {
      runtime: { onMessage: { addListener() {} } },
      storage: { local: { get: async () => stored, set: async value => Object.assign(stored, value) } }
    },
    fetch: async (url, request) => {
      requests.push({ url, ...request });
      const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
      if (url.endsWith("/file_uploads")) return json({ id: uploadId });
      if (url.endsWith("/send")) {
        if (options.onSend) options.onSend(context);
        if (options.failUpload) return json({ message: "Upload refused" }, 403);
        return json({ id: uploadId, status: "uploaded" });
      }
      if (request.method === "PATCH") {
        return json({ results: JSON.parse(request.body).children.map((_, i) => ({ id: String(i + 1).padStart(32, "0") })) });
      }
      throw new Error("Unexpected request: " + url);
    }
  });
  vm.runInContext(source, context);
  return { context, requests, stored };
}

test("paste uploads PNG bytes and inserts real image blocks in text/equation order", async () => {
  const { context, requests, stored } = background();
  const blocks = [paragraph, { type: "image", src: PNG, alt: "Diagram" }, { type: "equation", latex: "x^2" }];
  await context.appendBlocksToNotionPage({ pageId, blocks, operationId: "image-test" });
  assert.equal(requests.length, 3);
  assert.equal(JSON.parse(requests[0].body).content_type, "image/png");
  assert.ok(requests[1].body instanceof FormData);
  assert.equal(requests[1].headers["Content-Type"], undefined);
  const file = requests[1].body.get("file");
  assert.equal(file.type, "image/png");
  assert.equal(file.name, "diagram-1.png");
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer()).slice(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const children = JSON.parse(requests[2].body).children;
  assert.deepEqual(children.map(block => block.type), ["paragraph", "image", "equation"]);
  assert.equal(children[1].image.file_upload.id, uploadId);
  assert.equal(children[2].equation.expression, "x^2");
  assert.equal(requests[2].body.includes("data:image"), false);
  assert.equal(stored.chatgptToNotionLastUndo.blockIds.length, 3);
  assert.equal(blocks[1].src, PNG, "Original stored image remains available for a later paste");
});

test("duplicate and nested image blocks reuse an upload within the paste", async () => {
  const { context, requests } = background();
  const image = { type: "image", src: PNG, alt: "" };
  const result = await context.prepareImageBlocks([
    image, { type: "list", ordered: false, items: [{ children: [], blocks: [image] }] }
  ], "test-token", new AbortController().signal);
  assert.equal(requests.length, 2);
  assert.equal(result[0].fileUploadId, result[1].items[0].blocks[0].fileUploadId);
  assert.deepEqual(JSON.parse(JSON.stringify(context.createImageBlock(result[0]))).image.caption, []);
});

test("invalid images, failed uploads and canceled uploads do not append partial page content", async () => {
  for (const options of [
    { badImage: true }, { failUpload: true },
    { onSend: context => context.cancelAppendOperation("cancel-test") }
  ]) {
    const { context, requests } = background(options);
    await assert.rejects(context.appendBlocksToNotionPage({
      pageId, operationId: "cancel-test",
      blocks: [paragraph, { type: "image", src: options.badImage ? "data:image/png;base64,bm90LXB uZw==" : PNG }]
    }));
    assert.equal(requests.filter(request => request.method === "PATCH").length, 0);
  }
});

test("ordinary public image URLs use image blocks without file upload", async () => {
  const { context, requests } = background();
  await context.appendBlocksToNotionPage({
    pageId, operationId: "external-test", blocks: [{ type: "image", src: "https://example.com/diagram.png" }]
  });
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].body).children[0].image.external.url, "https://example.com/diagram.png");
});

test("Notion accepts text-only clipboard fallback containing PNG Markdown and native equations", async t => {
  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only", url: "https://www.notion.so/" + pageId });
  t.after(() => dom.window.close());
  const { window } = dom;
  const messages = [];
  window.requestAnimationFrame = () => {};
  window.chrome = {
    runtime: { sendMessage: async message => { messages.push(message); return { ok: true, appendedBlocks: 3 }; } },
    storage: { local: { get: async () => ({}) }, onChanged: { addListener() {} } }
  };
  window.eval(readFileSync(path.join(__dirname, "../notion-content.js"), "utf8"));
  await new Promise(setImmediate);
  const event = new window.Event("paste", { bubbles: true, cancelable: true });
  const markdown = "[[CHATGPT_TO_NOTION]]\nBefore\n\n![Diagram \\[A\\]](" + PNG + ")\n\n$$\nx^2\n$$";
  Object.defineProperty(event, "clipboardData", { value: { getData: type => type === "text/plain" ? markdown : "" } });
  window.document.dispatchEvent(event);
  await new Promise(setImmediate);
  assert.equal(event.defaultPrevented, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(Array.from(messages[0].blocks, block => block.type), ["paragraph", "image", "equation"]);
  assert.equal(messages[0].blocks[1].src, PNG);
  assert.equal(messages[0].blocks[1].alt, "Diagram [A]");
  assert.equal(messages[0].blocks[2].latex, "x^2");
});
