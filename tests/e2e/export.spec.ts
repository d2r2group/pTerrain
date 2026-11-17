import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { unzip, type ZipRead } from "../zipReader";
import { plotsDrawn } from "./plots";

// The figure export (plan §8 phase 16 (c)): the Export figure(s) row above the Parameters panel,
// the ZIP it downloads, the images' contents and sizes, the light theme, the vector regions, the
// fixed plot sizes, the PNG's DPI and the series of 3 unique cuts.

const figureButton = (page: Page) => page.getByRole("button", { name: "Export figure(s)…" });
const handle = (page: Page) => page.locator(".cut-handle");

const errors = new WeakMap<Page, string[]>();

test.beforeEach(({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

async function open(page: Page, hash = "#co2") {
  await page.goto(`./${hash}`);
  await plotsDrawn(page);
}

/** Switches to a mode and waits for the swap; the toggle is named after the mode it switches to. */
async function setMode(page: Page, mode: "isobar" | "isotherm") {
  const label = mode === "isobar" ? "constant p" : "constant T";
  const toggle = page.locator(".mode-toggle");
  if ((await toggle.getAttribute("aria-label")) === label) await toggle.click();
  await expect(toggle).not.toHaveAccessibleName(label);
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
}

/** The download that `act` starts: its name and bytes. */
async function downloaded(page: Page, act: () => Promise<void>) {
  const [download] = await Promise.all([page.waitForEvent("download"), act()]);
  return {
    name: download.suggestedFilename(),
    bytes: new Uint8Array(await readFile((await download.path())!)),
  };
}

type SizeText = "360 × 180" | "540 × 270" | "720 × 360";
type DpiText = "150 DPI" | "300 DPI" | "600 DPI";

/** Exports the figure: 3 unique cuts for `series`, else the current cut, at `size` and `dpi`. */
async function exportFigure(
  page: Page,
  format: "SVG" | "PNG",
  series = false,
  { size, dpi }: { size?: SizeText; dpi?: DpiText } = {},
) {
  await figureButton(page).click();
  await page.getByRole("menuitemradio", { name: series ? "3 unique cuts" : "Current cut" }).click();
  if (size) await page.getByRole("menuitemradio", { name: size }).click();
  if (dpi) await page.getByRole("menuitemradio", { name: dpi }).click();
  const { name, bytes } = await downloaded(page, () =>
    page.getByRole("menuitem", { name: format }).click(),
  );
  return { name, entries: unzip(bytes) };
}

const text = (entry: ZipRead | undefined) => new TextDecoder().decode(entry!.data);
const entry = (entries: ZipRead[], name: string) => entries.find((e) => e.name === name);

/** What Export in the Parameters panel writes. */
async function exportJson(page: Page) {
  await page.locator(".parameters summary").click();
  const { bytes } = await downloaded(page, () =>
    page.getByRole("button", { name: "Export", exact: true }).click(),
  );
  await page.locator(".parameters summary").click();
  return new TextDecoder().decode(bytes);
}

/**
 * Facts about an SVG file, measured in the page: the texts outside its box, the plot frame's
 * bottom, the numeric texts below it, the band's bottom and the letters over it, and the count of
 * dotted guide lines.
 */
async function measure(page: Page, svgText: string) {
  return page.evaluate((source) => {
    const doc = new DOMParser().parseFromString(source, "image/svg+xml");
    const svg = document.importNode(doc.documentElement, true) as unknown as SVGSVGElement;
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0";
    host.append(svg);
    document.body.append(host);
    const box = svg.getBoundingClientRect();
    const texts = [...svg.querySelectorAll("text")].filter((t) => t.textContent);
    const rect = (el: Element) => el.getBoundingClientRect();
    const outside = texts
      .filter((t) => {
        const r = rect(t);
        return (
          r.left < box.left - 0.5 ||
          r.right > box.right + 0.5 ||
          r.top < box.top - 0.5 ||
          r.bottom > box.bottom + 0.5
        );
      })
      .map((t) => t.textContent);
    const band = [...svg.querySelectorAll("rect")].filter((r) => r.getAttribute("height") === "4");
    const bandBottom = band.length ? Math.max(...band.map((r) => rect(r).bottom)) : null;
    const letters = texts
      .filter((t) => ["s", "l", "v"].includes(t.textContent!))
      .map((t) => rect(t).bottom);
    const numbers = texts.filter((t) => /^−?[\d.]+$/.test(t.textContent!.trim()));
    const guides = [...svg.querySelectorAll("line")].filter((l) =>
      /stroke-dasharray:\s*0(px)?,?\s+4(px)?/.test(l.getAttribute("style") ?? ""),
    ).length;
    const result = {
      outside,
      bandBottom,
      letters,
      numberTops: numbers.map((t) => rect(t).top),
      guides,
      title: svg.querySelector(":scope > title")?.textContent ?? null,
      boldValues: texts.filter((t) => / K$| kPa$/.test(t.textContent!)).map((t) => rect(t).top),
      plotBottom: Math.max(
        ...[...svg.querySelectorAll("path")]
          .filter((p) =>
            /^M0,[\d.]+H[\d.]+V0$|^M0,0H[\d.]+V[\d.]+$/.test(p.getAttribute("d") ?? ""),
          )
          .map((p) => rect(p).bottom),
      ),
    };
    host.remove();
    return result;
  }, svgText);
}

/** Checks that `svg` stands alone: no CSS variables, classes, ARIA or images, and every `url(#…)` resolves. */
function expectSelfContained(svg: string) {
  for (const bad of ["var(--", "class=", "aria-", "<image", "data:image"]) {
    expect(svg).not.toContain(bad);
  }
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of svg.matchAll(/url\(#([^)]+)\)/g)) expect(ids.has(id)).toBe(true);
}

for (const preset of ["co2", "h2o"] as const) {
  for (const mode of ["isobar", "isotherm"] as const) {
    test(`${preset}, ${mode}: the ZIP holds the three images and Export's JSON, which Import reopens`, async ({
      page,
    }) => {
      await open(page, `#${preset}`);
      await setMode(page, mode);
      const base = preset === "co2" ? "CO2" : "H2O";
      const { name, entries } = await exportFigure(page, "SVG");
      expect(name).toBe(`${base}.zip`);
      expect(entries.map((e) => e.name)).toEqual([
        `${base}.svg`,
        `${base}-diagram.svg`,
        `${base}-slice.svg`,
        `${base}.json`,
      ]);
      const json = text(entry(entries, `${base}.json`));
      expect(json).toBe(await exportJson(page));

      // Reopened by Import on another substance.
      await page
        .getByRole("combobox", { name: "Substance" })
        .selectOption(preset === "co2" ? "h2o" : "co2");
      await page.locator(".parameters summary").click();
      await page.locator('.parameters input[type="file"]').setInputFiles({
        name: `${base}.json`,
        mimeType: "application/json",
        buffer: Buffer.from(json),
      });
      await expect(page.getByRole("combobox", { name: "Substance" })).toHaveValue(preset);
    });

    test(`${preset}, ${mode}: each SVG stands alone, with its axes and labels in view`, async ({
      page,
    }) => {
      await open(page, `#${preset}`);
      await setMode(page, mode);
      const base = preset === "co2" ? "CO2" : "H2O";
      const { entries } = await exportFigure(page, "SVG");
      const [both, diagram, slice] = ["", "-diagram", "-slice"].map((s) =>
        text(entry(entries, `${base}${s}.svg`)),
      ) as [string, string, string];
      for (const svg of [both, diagram, slice]) {
        expectSelfContained(svg);
        expect(svg).toContain("<title>");
        expect(svg).toMatch(/<!-- pTerrain figure of .*Link: .*#.*Exported \d{4}-\d\d-\d\d\. -->/);
        expect(svg).toContain("font-family:Lato, sans-serif");
      }
      const b = await measure(page, both);
      const d = await measure(page, diagram);
      const s = await measure(page, slice);
      for (const m of [b, d, s]) {
        // The viewBox holds every text, the y-axis labels included.
        expect(m.outside).toEqual([]);
        expect(m.title).toBe(preset === "co2" ? "CO₂" : "H₂O");
      }
      // Guide lines on the whole figure only.
      expect(b.guides).toBeGreaterThan(0);
      expect(d.guides).toBe(0);
      expect(s.guides).toBe(0);
      // The diagram alone has tick numbers under its plot area and no bold values.
      expect(d.numberTops.filter((y) => y > d.plotBottom).length).toBeGreaterThanOrEqual(3);
      expect(d.boldValues).toEqual([]);
      // The slice alone: its axis at the bottom, with the band and its letters just above it, and
      // the bold values under the numbers.
      expect(s.bandBottom).not.toBeNull();
      const under = s.numberTops.filter((y) => y > s.bandBottom!);
      expect(under.length).toBeGreaterThanOrEqual(3);
      expect(s.letters.length).toBeGreaterThan(0);
      for (const y of s.letters) expect(y).toBeLessThanOrEqual(s.bandBottom! + 0.5);
      for (const y of s.boldValues) expect(y).toBeGreaterThan(Math.min(...under));
    });
  }
}

test("a dark page exports light images, and keeps its theme", async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  const { entries } = await exportFigure(page, "SVG");
  for (const e of entries.filter((x) => x.name.endsWith(".svg"))) {
    const svg = text(e);
    // The dark tokens' background, text and region opacity.
    expect(svg).not.toContain("rgb(17, 17, 17)");
    expect(svg).not.toContain("rgb(242, 242, 242)");
    expect(svg).not.toContain("opacity:0.4");
  }
  const both = text(entry(entries, "CO2.svg"));
  expect(both).toContain("opacity:0.3");
  expect(both).toContain("rgb(95, 196, 184)");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(
    "dark",
  );
});

test("the page after an export: the same SVG and canvas sizes and the same cut", async ({
  page,
}) => {
  await open(page);
  const read = () =>
    page.evaluate(() => ({
      svgs: [...document.querySelectorAll(".plots svg")].map((s) => [
        s.getAttribute("width"),
        s.getAttribute("height"),
      ]),
      canvas: (() => {
        const c = document.querySelector<HTMLCanvasElement>("canvas.regions")!;
        return [c.width, c.height, c.style.width, c.style.height];
      })(),
      cut: document.querySelector(".cut-handle")!.getAttribute("aria-valuenow"),
      line: document.querySelector(".cut-line")!.getAttribute("y1"),
      clones: document.querySelectorAll(".plots svg").length,
    }));
  const before = await read();
  await exportFigure(page, "SVG", false, { size: "360 × 180" });
  await exportFigure(page, "SVG", true);
  expect(await read()).toEqual(before);
});

/** The SVG text of the current cut's export at `size`, from a page `width` × `height` at `scale`. */
async function svgFrom(
  browser: Browser,
  width: number,
  height: number,
  scale: number,
  size: SizeText,
) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    baseURL: test.info().project.use.baseURL,
  });
  const page = await context.newPage();
  await open(page);
  const { entries } = await exportFigure(page, "SVG", false, { size });
  await context.close();
  return entries.filter((e) => e.name.endsWith(".svg")).map(text);
}

for (const size of ["360 × 180", "540 × 270", "720 × 360"] as const) {
  test(`at ${size}, a phone at 3× and a desktop at 1× export the same SVG text`, async ({
    browser,
  }) => {
    const phone = await svgFrom(browser, 390, 844, 3, size);
    const desktop = await svgFrom(browser, 1280, 960, 1, size);
    expect(phone).toEqual(desktop);
    // The plot area is the chosen size.
    const [w, h] = size.split(" × ").map(Number);
    expect(phone[1]).toContain(`M0,0H${w}V${h}`);
  });
}

/** A PNG's IHDR size and its pHYs pixels per metre. */
function pngInfo(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const info = { width: view.getUint32(16), height: view.getUint32(20), ppm: [] as number[] };
  for (let at = 8; at < bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (type === "pHYs") info.ppm.push(view.getUint32(at + 8), view.getUint32(at + 12));
    at += 12 + length;
  }
  return info;
}

test("a PNG at each DPI is the SVG's size × DPI / 96, with a matching pHYs", async ({ page }) => {
  await open(page);
  const svgs = (await exportFigure(page, "SVG", false, { size: "360 × 180" })).entries;
  for (const dpi of [150, 300, 600] as const) {
    const { entries } = await exportFigure(page, "PNG", false, {
      size: "360 × 180",
      dpi: `${dpi} DPI`,
    });
    for (const suffix of ["", "-diagram", "-slice"]) {
      const svg = text(entry(svgs, `CO2${suffix}.svg`));
      const w = Number(/<svg[^>]* width="(\d+)"/.exec(svg)![1]);
      const h = Number(/<svg[^>]* height="(\d+)"/.exec(svg)![1]);
      const png = pngInfo(entry(entries, `CO2${suffix}.png`)!.data);
      expect(png.width).toBe(Math.round((w * dpi) / 96));
      expect(png.height).toBe(Math.round((h * dpi) / 96));
      expect(png.ppm).toEqual([Math.round(dpi / 0.0254), Math.round(dpi / 0.0254)]);
    }
  }
  await expect(page.locator(".figure-note")).toBeEmpty();
});

test("720 × 360 at 600 DPI is lowered, with a note that Escape closes", async ({ page }) => {
  await open(page);
  const { entries } = await exportFigure(page, "PNG", false, { size: "720 × 360", dpi: "600 DPI" });
  const png = pngInfo(entry(entries, "CO2.png")!.data);
  expect(png.width * png.height).toBeLessThanOrEqual(16_777_216);
  const used = Math.round(png.ppm[0]! * 0.0254);
  expect(used).toBeLessThan(600);
  const note = page.locator(".figure-note");
  await expect(note).toHaveRole("status");
  await expect(note).toHaveText(
    `Saved at ${used} DPI: 600 DPI is more than this browser can draw for a figure this size.`,
  );
  await figureButton(page).focus();
  await page.keyboard.press("Escape");
  await expect(note).toBeEmpty();
});

test("3 unique cuts saves the CO₂ isobars, each image with its own cut's link", async ({
  page,
}) => {
  await open(page);
  const { name, entries } = await exportFigure(page, "SVG", true);
  expect(name).toBe("CO2-series.zip");
  const cuts = ["01-1000kPa", "02-518kPa", "03-200kPa"];
  expect(entries.map((e) => e.name)).toEqual([
    ...["both", "diagram", "slice"].flatMap((kind) => cuts.map((c) => `CO2-${kind}-${c}.svg`)),
    "CO2.json",
  ]);
  for (const [k, link] of [";p,1000", ";p,518", ";p,200"].entries()) {
    const svg = text(entries[k]);
    expect(svg).toContain(link);
    expectSelfContained(svg);
  }
  // The page is back on its own cut.
  await expect(handle(page)).toHaveAttribute("aria-valuenow", /^\d/);
});

test("the menu works by keyboard, and is clean under axe", async ({ page }) => {
  await open(page);
  await figureButton(page).focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Figure format" });
  await expect(menu).toBeVisible();
  await expect(figureButton(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitemradio", { name: "Current cut" })).toBeFocused();
  await expect(page.getByRole("menuitemradio", { name: "Current cut" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("menuitemradio", { name: "720 × 360" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByRole("menuitemradio", { name: "300 DPI" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const results = await new AxeBuilder({ page }).include(".figure-row").analyze();
  expect(results.violations).toEqual([]);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "3 unique cuts" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitem", { name: "PNG" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { name: "Current cut" })).toBeFocused();
  // A choice keeps the menu open, and is kept after it closes.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(figureButton(page)).toBeFocused();
  await figureButton(page).click();
  await expect(page.getByRole("menuitemradio", { name: "3 unique cuts" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
});

test("Export figure(s) is disabled while the axes swap", async ({ page }) => {
  await open(page);
  await page.locator(".mode-toggle").click();
  await expect(figureButton(page)).toBeDisabled();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(figureButton(page)).toBeEnabled();
});

test("the row sits above the Parameters panel and works with the panel closed", async ({
  page,
}) => {
  await open(page);
  const row = (await page.locator(".figure-row").boundingBox())!;
  const panel = (await page.locator(".parameters summary").boundingBox())!;
  const exaggerate = (await page.locator(".exaggerate").boundingBox())!;
  expect(row.y).toBeGreaterThan(exaggerate.y + exaggerate.height - 1);
  expect(row.y + row.height).toBeLessThanOrEqual(panel.y);
  const button = (await figureButton(page).boundingBox())!;
  expect(button.height).toBeCloseTo(44, 0);
  expect(button.width).toBeCloseTo(row.width, 0);
  await expect(page.locator(".parameters")).not.toHaveAttribute("open");
  const { entries } = await exportFigure(page, "SVG");
  expect(entries).toHaveLength(4);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Export figure(s) and its menu stay usable at 390 × 844", async ({ page }) => {
    await open(page);
    const button = (await figureButton(page).boundingBox())!;
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(390);
    await figureButton(page).click();
    const menu = (await page.getByRole("menu").boundingBox())!;
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(390);
    for (const item of await page.getByRole("menu").locator("button").all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    const { entries } = await downloaded(page, () =>
      page.getByRole("menuitem", { name: "SVG" }).click(),
    ).then(({ bytes }) => ({ entries: unzip(bytes) }));
    expect(entries).toHaveLength(4);
  });
});
