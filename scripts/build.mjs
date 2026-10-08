import { build } from "esbuild";
import { copyFile } from "node:fs/promises";

for (const [entry, name, output] of [
  ["src/math-renderer.mjs", "ChatGPTToNotionMathRenderer", "vendor/math-renderer.js"],
  ["src/diagram-capture.mjs", "AIToNotionDiagrams", "vendor/diagram-capture.js"]
]) {
  await build({ entryPoints: [entry], bundle: true, minify: true, format: "iife", globalName: name, outfile: output, legalComments: "linked" });
}
await copyFile("node_modules/katex/LICENSE", "vendor/KATEX-LICENSE.txt");
await copyFile("node_modules/html-to-image/LICENSE", "vendor/HTML-TO-IMAGE-LICENSE.txt");
