const assert = require("node:assert/strict");
const { readFileSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { chromium } = require("playwright");
const { PNG } = require("pngjs");
const vm = require("node:vm");
const root = path.join(__dirname, "../..");
const fixture = readFileSync(path.join(root, "tests/fixtures/diagram.html"), "utf8");
const financialFixture = readFileSync(path.join(root, "tests/fixtures/chatgpt-financial-diagram.html"), "utf8");
const cdsFixture = readFileSync(path.join(root, "tests/fixtures/chatgpt-cds-diagram.html"), "utf8");
const bondRiskFixture = readFileSync(path.join(root, "tests/fixtures/chatgpt-bond-risk.html"), "utf8");
const rCodeFixture = readFileSync(path.join(root, "tests/fixtures/chatgpt-r-code.html"), "utf8");
const artifacts = path.join(root, "tests/artifacts");

async function setup(t, width = 1280, html = fixture) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  await page.route("https://chatgpt.com/**", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("https://chatgpt.com/");
  await page.evaluate(() => {
    window.__writes = [];
    window.__stored = {};
    window.chrome = { storage: {
      local: { get: async () => ({}), set: async value => Object.assign(window.__stored, value) },
      onChanged: { addListener() {} }
    } };
    Object.defineProperty(navigator, "clipboard", { value: {
      write: async items => {
        const item = items[0];
        const data = {};
        for (const type of item.types) data[type] = await (await item.getType(type)).text();
        window.__writes.push(data);
      }
    } });
  });
  for (const script of ["source-providers.js", "vendor/diagram-capture.js", "converter.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(root, script) });
  }
  return page;
}

function payloadFromHtml(html) {
  const marker = html.match(/data-chatgpt-to-notion-payload="([^"]+)"/)?.[1];
  assert.ok(marker);
  return JSON.parse(Buffer.from(marker, "base64").toString("utf8"));
}

for (const width of [1280, 390]) {
  test("the supplied ChatGPT R code surface copies its language at width " + width, async t => {
    const html = `<div data-markdown-text-style="assistant-message"><p>Before</p>${rCodeFixture}<p>After</p></div>`;
    const page = await setup(t, width, html);
    const answer = page.locator("[data-markdown-text-style='assistant-message']");
    const source = await answer.locator("pre code").textContent();
    const before = await answer.innerHTML();
    await page.locator("[data-chatgpt-to-notion-button]").click();
    await page.waitForFunction(() => window.__writes.length === 1);
    const data = await page.evaluate(() => ({ copy: __writes[0], stored: __stored.chatgptToNotionLastCopy }));
    const payload = payloadFromHtml(data.copy["text/html"]);
    assert.deepEqual(payload.blocks.map(block => block.type), ["paragraph", "code", "paragraph"]);
    assert.deepEqual(payload.blocks[1], { type: "code", language: "r", code: source });
    assert.deepEqual(data.stored.blocks, payload.blocks);
    assert.ok(data.copy["text/plain"].includes("```r\n"));
    assert.equal(await answer.innerHTML(), before);
    const requests = [];
    const background = vm.createContext({
      console, AbortController, TextEncoder, setTimeout, clearTimeout,
      chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: {
        get: async () => ({ chatgptToNotionSettings: { notionToken: "test-token", enableFeature: true } }),
        set: async () => {}
      } } },
      fetch: async (url, request) => {
        assert.equal(request.method, "PATCH");
        const children = JSON.parse(request.body).children;
        requests.push(children);
        return new Response(JSON.stringify({ results: children.map((_, index) => ({ id: String(index + 1).padStart(32, "0") })) }));
      }
    });
    vm.runInContext(readFileSync(path.join(root, "background.js"), "utf8"), background);
    await background.appendBlocksToNotionPage({ pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", blocks: payload.blocks, operationId: "r-code-test" });
    const children = requests.flat();
    assert.deepEqual(children.map(block => block.type), ["paragraph", "code", "paragraph"]);
    assert.equal(children[1].code.language, "r");
    assert.equal(children[1].code.rich_text.map(part => part.text.content).join(""), source);
  });
}

test("Copy for Notion keeps toolbar languages in the clipboard and stored blocks", async t => {
  const html = `<div data-message-author-role="assistant"><div class="markdown">
    <p>Before</p><pre><div><span>R</span><button>Copy code</button></div><div><code>n = 0\nrepeat {\n  n = n + 1\n}</code></div></pre>
    <div><div><span>Python</span><button>Copy</button></div><pre><code>print(1)</code></pre></div>
    <pre data-language="cpp"><code>int n = 0;</code></pre><p>After</p>
  </div></div>`;
  const page = await setup(t, 1280, html);
  await page.locator("[data-chatgpt-to-notion-button]").click();
  await page.waitForFunction(() => window.__writes.length === 1);
  const data = await page.evaluate(() => ({ copy: __writes[0], stored: __stored.chatgptToNotionLastCopy }));
  const payload = payloadFromHtml(data.copy["text/html"]);
  assert.deepEqual(payload.blocks.map(block => block.type), ["paragraph", "code", "code", "code", "paragraph"]);
  assert.deepEqual(payload.blocks.filter(block => block.type === "code").map(block => block.language), ["r", "python", "cpp"]);
  assert.equal(payload.blocks[1].code, "n = 0\nrepeat {\n  n = n + 1\n}");
  assert.deepEqual(data.stored.blocks, payload.blocks);
  assert.ok(data.copy["text/plain"].includes("```r\n"));
  assert.ok(data.copy["text/html"].includes('data-language="python"'));
});

function checkImage(block, filename) {
  assert.equal(block.type, "image");
  const bytes = Buffer.from(block.src.split(",")[1], "base64");
  const png = PNG.sync.read(bytes);
  assert.ok(png.width >= 300 && png.height >= 200);
  let light = 0;
  let dark = 0;
  let opaque = 0;
  for (let index = 0; index < png.data.length; index += 4) {
    const sum = png.data[index] + png.data[index + 1] + png.data[index + 2];
    if (png.data[index + 3] > 240) opaque++;
    if (sum > 600) light++;
    if (sum < 120) dark++;
  }
  assert.ok(opaque > png.width * png.height * 0.99, "Dark-mode background must not become transparent");
  assert.ok(light > 500 && dark > 500, "Capture must contain both text and background pixels");
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(path.join(artifacts, filename), bytes);
}

for (const width of [1280, 390]) {
  test("HTML diagrams become images between editable paragraphs and equations at width " + width, async t => {
    const page = await setup(t, width);
    const before = await page.locator(".markdown").innerHTML();
    assert.equal(await page.evaluate(() => AIToNotionDiagrams.find(document.querySelector(".markdown")).length), 1);
    await page.locator("[data-chatgpt-to-notion-button]").click();
    await page.waitForFunction(() => window.__writes.length === 1);
    const data = await page.evaluate(() => ({ copy: __writes[0], stored: __stored.chatgptToNotionLastCopy }));
    const payload = payloadFromHtml(data.copy["text/html"]);
    assert.deepEqual(payload.blocks.map(block => block.type), ["paragraph", "image", "paragraph", "equation"]);
    assert.equal(payload.blocks[3].latex, "x^2");
    assert.equal(payload.blocks[0].children[0].text, "Before the diagram. Price $10 to $20.");
    assert.equal(payload.markdown, "");
    assert.equal(data.copy["text/plain"].startsWith("[[CHATGPT_TO_NOTION]]\n"), true);
    assert.equal(data.copy["text/plain"].includes("\u2063\u2063\u2063"), false);
    assert.equal(data.stored.html, "");
    assert.deepEqual(data.stored.blocks, payload.blocks);
    assert.equal(await page.locator(".markdown").innerHTML(), before);
    checkImage(payload.blocks[1], "diagram-" + width + ".png");
    await page.screenshot({ path: path.join(artifacts, "page-" + width + ".png"), fullPage: true });

    await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(".markdown"));
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      const event = new Event("copy", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { setData() { throw new Error("Diagrams need asynchronous capture"); } } });
      document.dispatchEvent(event);
      if (!event.defaultPrevented) throw new Error("Diagram selection was not captured");
    });
    await page.waitForFunction(() => window.__writes.length === 2);
    const selected = payloadFromHtml(await page.evaluate(() => __writes[1]["text/html"]));
    assert.deepEqual(selected.blocks.map(block => block.type), payload.blocks.map(block => block.type));

    // A selection inside a diagram copies that whole diagram, without surrounding prose.
    const partial = await page.evaluate(async () => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(".box h3"));
      const clone = await AIToNotionDiagrams.prepare(document.querySelector(".markdown"), range);
      return ChatGPTToNotionConverter.convertFragment(clone);
    });
    assert.deepEqual(partial.blocks.map(block => block.type), ["image"]);
  });
}

for (const width of [1280, 390]) {
  test("the user's ChatGPT data-d-component diagram is a single image at width " + width, async t => {
    const page = await setup(t, width, financialFixture);
    const before = await page.locator(".markdown").innerHTML();
    const selected = await page.evaluate(() => {
      const root = document.querySelector(".markdown");
      const diagrams = AIToNotionDiagrams.find(root);
      return diagrams.length === 1 && diagrams[0] === root.querySelector(":scope > [data-d-has-border]");
    });
    assert.equal(selected, true, "Capture the outer frame, including the title and arrow");
    await page.locator("[data-chatgpt-to-notion-button]").click();
    await page.waitForFunction(() => window.__writes.length === 1);
    const copied = await page.evaluate(() => __writes[0]);
    const payload = payloadFromHtml(copied["text/html"]);
    assert.deepEqual(payload.blocks.map(block => block.type), ["heading", "paragraph", "image", "paragraph", "list", "paragraph", "equation"]);
    assert.equal(payload.blocks.at(-1).latex, "x^2");
    assert.doesNotMatch(JSON.stringify(payload), /Lecture Slides|Products_PDF/);
    assert.doesNotMatch(copied["text/plain"], /Lecture Slides|Products_PDF/);
    assert.equal(await page.locator(".markdown").innerHTML(), before);
    checkImage(payload.blocks[2], "chatgpt-financial-" + width + ".png");
    await page.screenshot({ path: path.join(artifacts, "chatgpt-financial-page-" + width + ".png"), fullPage: true });
    const arrow = await page.evaluate(() => {
      const diagram = document.querySelector(".markdown > [data-d-has-border]").getBoundingClientRect();
      const icon = document.querySelector("[data-d-component='icon']").getBoundingClientRect();
      return { x: (icon.x - diagram.x) / diagram.width, y: (icon.y - diagram.y) / diagram.height,
        width: icon.width / diagram.width, height: icon.height / diagram.height };
    });
    const png = PNG.sync.read(Buffer.from(payload.blocks[2].src.split(",")[1], "base64"));
    let arrowPixels = 0;
    for (let y = Math.floor(arrow.y * png.height); y < (arrow.y + arrow.height) * png.height; y++) {
      for (let x = Math.floor(arrow.x * png.width); x < (arrow.x + arrow.width) * png.width; x++) {
        if (png.data[(y * png.width + x) * 4] > 150) arrowPixels++;
      }
    }
    assert.ok(arrowPixels > 20, "The connector SVG must remain visible in the PNG");
  });
}

for (const width of [1280, 390]) {
  test("CDS flow diagrams without inner borders retain the whole frame at width " + width, async t => {
    const page = await setup(t, width, cdsFixture);
    const before = await page.locator(".markdown").innerHTML();
    assert.equal(await page.evaluate(() => {
      const diagrams = AIToNotionDiagrams.find(document.querySelector(".markdown"));
      return diagrams.length === 1 && diagrams[0].id === "cds-panel";
    }), true);
    await page.locator("[data-chatgpt-to-notion-button]").click();
    await page.waitForFunction(() => __writes.length === 1);
    const copied = await page.evaluate(() => __writes[0]);
    const payload = payloadFromHtml(copied["text/html"]);
    assert.deepEqual(payload.blocks.map(block => block.type), ["heading", "paragraph", "paragraph", "heading", "image", "heading", "list", "paragraph", "equation"]);
    assert.equal(payload.blocks.at(-1).latex, "x^2");
    assert.doesNotMatch(JSON.stringify(payload), /Lecture Slides/);
    assert.equal(await page.locator(".markdown").innerHTML(), before);
    checkImage(payload.blocks[4], "chatgpt-cds-" + width + ".png");
    await page.screenshot({ path: path.join(artifacts, "chatgpt-cds-page-" + width + ".png"), fullPage: true });

    const partial = await page.evaluate(async () => {
      const root = document.querySelector(".markdown");
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("#cds-panel strong"));
      return ChatGPTToNotionConverter.convertFragment(await AIToNotionDiagrams.prepare(root, range));
    });
    assert.deepEqual(partial.blocks.map(block => block.type), ["image"]);
  });
}

test("unbordered flow endpoints are recognized without ChatGPT-specific attributes", async t => {
  const page = await setup(t, 1280, cdsFixture);
  await page.evaluate(() => {
    document.querySelector("#cds-panel").querySelectorAll("[data-d-component='grid'], [data-d-component='grid-item']").forEach(element => {
      element.style.display = getComputedStyle(element).display;
      element.style.gridTemplateColumns = getComputedStyle(element).gridTemplateColumns;
      element.removeAttribute("data-d-component");
    });
    document.querySelector("#cds-panel").removeAttribute("data-d-component");
  });
  const ids = await page.evaluate(() => AIToNotionDiagrams.find(document.querySelector(".markdown")).map(element => element.id));
  assert.deepEqual(ids, ["cds-panel"]);
});

test("bordered prose, single-item grids and ordinary tables remain editable", async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    document.querySelector(".markdown").innerHTML =
      '<div style="border:1px solid white;padding:20px"><p>A statement with an arrow: A &#8594; B.</p><p>Another ordinary paragraph.</p></div>' +
      '<div data-d-component="box" data-d-has-border style="border:1px solid white;padding:20px"><div data-d-component="grid" style="display:grid"><div data-d-component="grid-item"><p>Single item.</p></div></div></div>' +
      '<div style="border:1px solid white;padding:20px"><div style="display:grid;grid-template-columns:1fr 1fr"><p>Left note</p><p>Right note</p></div></div>' +
      '<table><tr><td>Left</td><td>Right &#8594;</td></tr></table>';
  });
  assert.equal(await page.evaluate(() => AIToNotionDiagrams.find(document.querySelector(".markdown")).length), 0);
  await page.locator("[data-chatgpt-to-notion-button]").click();
  await page.waitForFunction(() => __writes.length === 1);
  const result = payloadFromHtml(await page.evaluate(() => __writes[0]["text/html"]));
  assert.equal(result.blocks.some(block => block.type === "image"), false);
  assert.equal(result.blocks.at(-1).type, "table");
});

for (const layout of ["span-grid", "wrapped-columns", "stacked-boxes"]) {
  test("Copy for Notion captures " + layout + " and excludes the PDF source chip", async t => {
    const page = await setup(t);
    await page.evaluate(layout => {
      const diagram = document.querySelector(".diagram");
      if (layout === "span-grid") {
        const wrapper = document.createElement("span");
        wrapper.className = "diagram";
        wrapper.style.display = "block";
        wrapper.innerHTML = diagram.innerHTML.replaceAll("<div", '<span style="display:block"').replaceAll("</div>", "</span>");
        wrapper.querySelectorAll(".row").forEach(row => { row.style.display = "grid"; });
        diagram.replaceWith(wrapper);
      } else if (layout === "wrapped-columns") {
        diagram.querySelectorAll(".row").forEach(row => {
          row.style.display = "block";
          [...row.children].forEach(child => {
            const wrapper = document.createElement("span");
            wrapper.style.cssText = "display:inline-block;width:48%;vertical-align:top;margin-right:1%";
            child.replaceWith(wrapper);
            wrapper.appendChild(child);
          });
        });
      } else {
        diagram.querySelectorAll(".row").forEach(row => { row.style.gridTemplateColumns = "1fr"; });
      }
      const paragraph = document.querySelector(".markdown > p:last-of-type");
      paragraph.insertAdjacentHTML("beforeend", '<span role="button" tabindex="0"><svg width="14" height="14"></svg><span>Lecture Slides_Financial Investment Products_PDF.pdf</span></span>');
    }, layout);
    assert.equal(await page.evaluate(() => AIToNotionDiagrams.find(document.querySelector(".markdown")).length), 1);
    await page.locator("[data-chatgpt-to-notion-button]").click();
    await page.waitForFunction(() => window.__writes.length === 1);
    const copied = await page.evaluate(() => __writes[0]);
    const payload = payloadFromHtml(copied["text/html"]);
    assert.deepEqual(payload.blocks.map(block => block.type), ["paragraph", "image", "paragraph", "equation"]);
    assert.doesNotMatch(JSON.stringify(payload), /Lecture Slides|Products_PDF/);
    assert.doesNotMatch(copied["text/plain"], /Lecture Slides|Products_PDF/);
    checkImage(payload.blocks[1], "diagram-" + layout + ".png");
  });
}

for (const width of [1280, 390]) {
test("the supplied bond-risk answer pastes SVG charts, formulas and tables at width " + width, async t => {
  const page = await setup(t, width, bondRiskFixture);
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every(image => image.complete && image.naturalWidth > 0));
  const expectedMath = await page.evaluate(() => [...document.querySelectorAll("annotation[encoding='application/x-tex']")].map(node => node.textContent.trim()));
  const expectedCaptions = await page.evaluate(() => [...document.querySelectorAll("img[data-d-component='svg']")].map(image => image.nextElementSibling.textContent.trim().replace(/\s+/g, " ")));
  const before = await page.locator("[data-markdown-text-style]").innerHTML();
  await page.locator("[data-chatgpt-to-notion-button]").click();
  await page.waitForFunction(() => __writes.length === 1);
  const payload = payloadFromHtml(await page.evaluate(() => __writes[0]["text/html"]));

  const requests = [];
  const stored = { chatgptToNotionSettings: { notionToken: "test-token", enableFeature: true } };
  let nextId = 1;
  const id = () => "11111111-2222-4333-8444-" + String(nextId++).padStart(12, "0");
  const background = vm.createContext({
    console, Blob, FormData, AbortController, Uint8Array, TextEncoder, atob, setTimeout, clearTimeout,
    chrome: { runtime: { onMessage: { addListener() {} } }, storage: { local: {
      get: async () => stored, set: async value => Object.assign(stored, value)
    } } },
    fetch: async (url, request) => {
      requests.push({ url, ...request });
      let result;
      if (url.endsWith("/file_uploads")) result = { id: id() };
      else if (url.endsWith("/send")) result = { status: "uploaded" };
      else if (request.method === "PATCH") result = { results: JSON.parse(request.body).children.map(() => ({ id: id() })) };
      else throw new Error("Unexpected Notion request: " + url);
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json" } });
    }
  });
  vm.runInContext(readFileSync(path.join(root, "background.js"), "utf8"), background);
  await background.appendBlocksToNotionPage({ pageId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", blocks: payload.blocks, operationId: "bond-risk" });

  const images = payload.blocks.filter(block => block.type === "image");
  assert.equal(images.length, 3, "Two SVG image charts and the vertical credit-rating flow are captured");
  images.forEach((block, index) => checkImage(block, "bond-risk-" + width + "-" + index + ".png"));
  assert.ok(images.every(block => block.src.startsWith("data:image/png;base64,")));
  assert.deepEqual(images.slice(0, 2).map(block => block.alt), expectedCaptions);
  assert.equal(images[2].alt, "", "A diagram without a caption must not add a Diagram placeholder");
  for (const chart of images.slice(0, 2)) {
    const png = PNG.sync.read(Buffer.from(chart.src.split(",")[1], "base64"));
    let curvePixels = 0;
    for (let index = 0; index < png.data.length; index += 4) {
      if (png.data[index] < 100 && png.data[index + 1] < 160 && png.data[index + 2] > 160) curvePixels++;
    }
    assert.ok(curvePixels > 100, "The blue curve in the original SVG must render in the PNG");
  }
  const expressions = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.type === "math" || value.type === "equation") expressions.push(value.latex);
    Object.values(value).forEach(visit);
  }
  visit(payload.blocks);
  assert.deepEqual(expressions, expectedMath);
  assert.equal(payload.blocks.filter(block => block.type === "table").length, 9);
  assert.equal(await page.locator("[data-markdown-text-style]").innerHTML(), before);
  assert.equal(requests.filter(request => request.url.endsWith("/send")).length, 3);
  const appended = requests.filter(request => request.method === "PATCH");
  assert.ok(appended.length > 1, "The long answer must be split into Notion API batches");
  assert.ok(appended.every(request => !request.body.includes("data:image")));
  const imageBlocks = appended.flatMap(request => JSON.parse(request.body).children).filter(block => block.type === "image");
  assert.deepEqual(imageBlocks.slice(0, 2).map(block => block.image.caption.map(part => part.text.content).join("")), expectedCaptions);
});
}

for (const [width, captionTag] of [[1280, "span"], [390, "figcaption"]]) {
  test("diagram footer text becomes the editable image caption at width " + width, async t => {
    const page = await setup(t, width);
    const caption = "2기간 이항 주가나무. 가운데 40은 상승 후 하락하거나 하락 후 상승해도 도달하는 동일한 주가이다. " + "추가 설명도 잘리지 않고 캡션으로 옮겨진다. ".repeat(5);
    await page.evaluate(({ caption, captionTag }) => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="260" viewBox="0 0 460 260"><path d="M70 130L230 60L390 25M230 60L390 130M70 130L230 200L390 130M230 200L390 235" stroke="gray" fill="none" stroke-width="3"/>' +
        [[70, 130, "40"], [230, 60, "80"], [230, 200, "20"], [390, 25, "160"], [390, 130, "40"], [390, 235, "10"]].map(([x, y, label]) =>
          '<circle cx="' + x + '" cy="' + y + '" r="25" fill="#687f99"/><text x="' + x + '" y="' + (y + 8) + '" text-anchor="middle" font-size="24" fill="white">' + label + '</text>'
        ).join("") + '</svg>';
      const diagram = document.querySelector(".diagram");
      if (captionTag === "figcaption") {
        const figure = document.createElement("figure");
        figure.className = "diagram";
        diagram.replaceWith(figure);
      }
      const target = document.querySelector(".diagram");
      target.style.cssText = "display:flex;flex-direction:column;gap:12px;box-sizing:border-box";
      const image = document.createElement("img");
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
      image.style.cssText = "display:block;width:100%;aspect-ratio:460 / 260";
      target.replaceChildren(image);
      const footer = document.createElement(captionTag);
      footer.setAttribute("data-d-component", "caption");
      footer.textContent = caption;
      target.appendChild(footer);
    }, { caption, captionTag });
    await page.waitForFunction(() => document.querySelector(".diagram img").naturalWidth > 0);
    const before = await page.locator(".markdown").innerHTML();
    const expectedHeight = await page.evaluate(() => {
      const diagram = document.querySelector(".diagram");
      const style = getComputedStyle(diagram);
      return Math.ceil(diagram.querySelector("img").getBoundingClientRect().height +
        parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth));
    });
    await page.locator("[data-chatgpt-to-notion-button]").click();
    await page.waitForFunction(() => __writes.length === 1);
    const payload = payloadFromHtml(await page.evaluate(() => __writes[0]["text/html"]));
    assert.deepEqual(payload.blocks.map(block => block.type), ["paragraph", "image", "paragraph", "equation"]);
    assert.equal(payload.blocks[1].alt, caption.trim());
    const png = PNG.sync.read(Buffer.from(payload.blocks[1].src.split(",")[1], "base64"));
    assert.equal(png.height, expectedHeight * 2, "The PNG must end before the footer text and its gap");
    checkImage(payload.blocks[1], "captionless-tree-" + width + ".png");
    assert.equal(await page.locator(".markdown").innerHTML(), before);
    const partial = await page.evaluate(async () => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(".diagram img"));
      return ChatGPTToNotionConverter.convertFragment(await AIToNotionDiagrams.prepare(document.querySelector(".markdown"), range));
    });
    assert.deepEqual(partial.blocks.map(block => block.type), ["image"]);
    assert.equal(partial.blocks[0].alt, caption.trim());
  });
}

test("small SVG image data URLs are rasterized in both URI and base64 form", async t => {
  const page = await setup(t);
  await page.evaluate(() => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"><rect width="32" height="24" fill="red"/></svg>';
    const root = document.querySelector(".markdown");
    root.innerHTML = "";
    for (const src of ["data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg), "data:image/svg+xml;base64," + btoa(svg)]) {
      const image = document.createElement("img");
      image.src = src;
      root.appendChild(image);
    }
  });
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every(image => image.complete && image.naturalWidth));
  await page.locator("[data-chatgpt-to-notion-button]").click();
  await page.waitForFunction(() => __writes.length === 1);
  const payload = payloadFromHtml(await page.evaluate(() => __writes[0]["text/html"]));
  assert.deepEqual(payload.blocks.map(block => block.type), ["image", "image"]);
  for (const block of payload.blocks) {
    assert.match(block.src, /^data:image\/png;base64,/);
    const png = PNG.sync.read(Buffer.from(block.src.split(",")[1], "base64"));
    assert.equal(png.width, 64);
    assert.equal(png.height, 48);
    assert.equal(png.data[0], 255);
  }
});

test("a missing capture bundle cannot silently flatten diagrams to text", async t => {
  const page = await setup(t);
  await page.evaluate(() => { window.AIToNotionDiagrams = undefined; });
  await page.locator("[data-chatgpt-to-notion-button]").click();
  await page.waitForFunction(() => document.querySelector("[data-chatgpt-to-notion-toast]")?.textContent.includes("Reload the extension"));
  assert.equal(await page.evaluate(() => __writes.length), 0);
});

test("large SVG/canvas charts are detected but math, icons, code and tables are not", async t => {
  const page = await setup(t);
  const result = await page.evaluate(async () => {
    const root = document.querySelector(".markdown");
    root.innerHTML = '<svg width="360" height="180"><rect width="360" height="180" fill="white"/><text x="20" y="70" fill="black">SVG diagram</text></svg>' +
      '<canvas width="360" height="180"></canvas><svg width="24" height="24"></svg>' +
      '<div class="katex"><svg width="400" height="150"></svg></div>' +
      '<pre><svg width="400" height="150"></svg></pre>' +
      '<table><tr><td><svg width="400" height="150"></svg></td></tr></table>';
    const canvas = root.querySelector("canvas");
    const context = canvas.getContext("2d");
    context.fillStyle = "white"; context.fillRect(0, 0, 360, 180);
    context.fillStyle = "black"; context.font = "32px sans-serif"; context.fillText("Canvas chart", 20, 70);
    const found = AIToNotionDiagrams.find(root).map(element => element.localName);
    const captured = await AIToNotionDiagrams.prepare(root);
    return { found, images: [...captured.querySelectorAll("img")].map(image => image.src) };
  });
  assert.deepEqual(result.found, ["svg", "canvas"]);
  assert.equal(result.images.length, 2);
  result.images.forEach(src => assert.ok(PNG.sync.read(Buffer.from(src.split(",")[1], "base64")).width >= 360));
});

for (const wrapped of [false, true]) {
test("a cross-origin embedded diagram fails visibly, with wrapper " + wrapped, async t => {
  const page = await setup(t);
  await page.evaluate(wrapped => {
    const frame = '<iframe sandbox srcdoc="<p>Private diagram</p>" width="600" height="300"></iframe>';
    document.querySelector(".diagram").outerHTML = wrapped ? '<figure style="border:1px solid white">' + frame + '</figure>' : frame;
  }, wrapped);
  await page.locator("[data-chatgpt-to-notion-button]").click();
  await page.waitForFunction(() => document.querySelector("[data-chatgpt-to-notion-toast]")?.textContent.includes("cannot be captured"));
  assert.equal(await page.evaluate(() => __writes.length), 0);
});
}
