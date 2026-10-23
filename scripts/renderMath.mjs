// Renders the math of the Model Details overlay (src/ui/modelDetails.ts) to SVG with MathJax, in
// its TeX (Computer Modern) font, so the page loads no math library or font. Every tex`…` and
// display`…` template in that file is rendered once; the glyphs go into one shared <defs> block
// that the formulas reference. Run `npm run math` after editing the formulas; `--check` only
// verifies that src/assets/math.json is up to date (Vitest runs it).

import { readFileSync, writeFileSync } from "node:fs";
import { AssistiveMmlHandler } from "mathjax-full/js/a11y/assistive-mml.js";
import { liteAdaptor } from "mathjax-full/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "mathjax-full/js/handlers/html.js";
import { TeX } from "mathjax-full/js/input/tex.js";
// Registers the "ams" package (aligned, \frac, …) that the TeX input below asks for.
import "mathjax-full/js/input/tex/ams/AmsConfiguration.js";
import { mathjax } from "mathjax-full/js/mathjax.js";
import { SVG } from "mathjax-full/js/output/svg.js";

const SOURCE = new URL("../src/ui/modelDetails.ts", import.meta.url);
const OUTPUT = new URL("../src/assets/math.json", import.meta.url);

/** The formulas in the source, keyed as modelDetails.ts looks them up: "tex:…" or "display:…". */
function formulas(source) {
  const keys = [...source.matchAll(/\b(tex|display)`([^`]*)`/g)].map(([, mode, tex]) => {
    if (tex.includes("${")) throw new Error(`renderMath: interpolation in ${mode}\`${tex}\``);
    return `${mode}:${tex}`;
  });
  return [...new Set(keys)].sort();
}

function render(keys) {
  const adaptor = liteAdaptor();
  AssistiveMmlHandler(RegisterHTMLHandler(adaptor));
  // The SVG's own screen reader text is replaced by the hidden MathML beside it.
  const svg = new SVG({ fontCache: "global" });
  const doc = mathjax.document("", {
    InputJax: new TeX({ packages: ["base", "ams"] }),
    OutputJax: svg,
  });
  const math = {};
  for (const key of keys) {
    const [mode, ...rest] = key.split(":");
    const html = adaptor.outerHTML(doc.convert(rest.join(":"), { display: mode === "display" }));
    const error = html.match(/data-mjx-error="([^"]*)"/);
    if (error) throw new Error(`renderMath: ${error[1]} in ${key}`);
    math[key] = html;
  }
  return { defs: adaptor.outerHTML(svg.fontCache.getCache()), math };
}

const text = `${JSON.stringify(render(formulas(readFileSync(SOURCE, "utf8"))), null, 2)}\n`;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUTPUT, "utf8");
  } catch {
    // Missing: out of date.
  }
  if (current !== text) {
    console.error("src/assets/math.json is out of date: run `npm run math`.");
    process.exit(1);
  }
} else {
  writeFileSync(OUTPUT, text);
}
