import { expect, test, type Page } from "@playwright/test";

// The draggable handle on the cut line; the controls have a range slider of their own.
const handle = (page: Page) => page.locator(".cut-handle");
const value = async (page: Page) => Number(await handle(page).getAttribute("aria-valuenow"));

// Page errors raised at any point in a test, including during the swap animation.
const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
  // The tests are written for H₂O; a first visit opens on CO₂ (tested in controls.spec.ts).
  await page.goto("./#h2o");
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

/**
 * Switches to a mode, unless it is shown already, and waits for the swap. The toggle is named after
 * the mode it switches to.
 */
async function setMode(page: Page, label: "constant p" | "constant T") {
  const toggle = page.locator(".mode-toggle");
  if ((await toggle.getAttribute("aria-label")) === label) await toggle.click();
  await expect(toggle).not.toHaveAccessibleName(label);
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
}

test("draws the regions, the three boundaries and the triple point", async ({ page }) => {
  const diagram = page.locator(".phase-diagram");
  for (const pair of ["s-l", "s-v", "l-v"]) {
    await expect(diagram.locator(`path.boundary.stable[data-pair="${pair}"]`)).toHaveCount(1);
    await expect(diagram.locator(`path.boundary.metastable[data-pair="${pair}"]`)).toHaveCount(1);
  }
  await expect(diagram.locator(".triple-point")).toHaveCount(1);

  // The bitmap holds the three phase colors (at the region opacity).
  const colors = await page.locator("canvas.regions").evaluate((el: HTMLCanvasElement) => {
    const { data } = el.getContext("2d")!.getImageData(0, 0, el.width, el.height);
    const seen = new Set<string>();
    for (let k = 0; k < data.length; k += 4) seen.add(`${data[k]},${data[k + 1]},${data[k + 2]}`);
    return seen.size;
  });
  expect(colors).toBe(3);
});

test("the toggle swaps the axes, and each mode keeps its own cut", async ({ page }) => {
  await expect(page.locator(".phase-diagram .x-label")).toHaveText("T (K)");
  await expect(handle(page)).toHaveAccessibleName("Isobar line, p* (kPa)");
  const isobar = await value(page);

  await page.getByRole("button", { name: "constant T" }).click();
  await expect(page.locator(".mode-toggle")).toHaveAccessibleName("constant p");
  // The swap animates, then the axes and the cut come back in the new mode.
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(page.locator(".phase-diagram .x-label")).toHaveText("p (kPa)");
  await expect(handle(page)).toHaveAccessibleName("Isotherm line, T* (K)");

  await handle(page).focus();
  await page.keyboard.press("ArrowUp");
  const isotherm = await value(page);

  await page.getByRole("button", { name: "constant p" }).click();
  await expect(handle(page)).toHaveAccessibleName("Isobar line, p* (kPa)");
  expect(await value(page)).toBe(isobar);
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(handle(page)).toHaveAccessibleName("Isotherm line, T* (K)");
  expect(await value(page)).toBe(isotherm);
});

test("each mode's regions are shown again unchanged after a round trip", async ({ page }) => {
  const canvas = page.locator("canvas.regions");
  const bitmap = () => canvas.evaluate((el: HTMLCanvasElement) => el.toDataURL());
  const isobar = await bitmap();
  await setMode(page, "constant T");
  const isotherm = await bitmap();
  expect(isotherm).not.toBe(isobar);
  await setMode(page, "constant p");
  expect(await bitmap()).toBe(isobar);
  await setMode(page, "constant T");
  expect(await bitmap()).toBe(isotherm);
  // A new substance is painted afresh.
  await page.getByRole("combobox", { name: "Substance" }).selectOption("co2");
  expect(await bitmap()).not.toBe(isotherm);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the swap is immediate", async ({ page }) => {
    await page.getByRole("button", { name: "constant T" }).click();
    await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/, { timeout: 50 });
    await expect(page.locator(".phase-diagram .x-label")).toHaveText("p (kPa)", { timeout: 50 });
  });
});

test("dragging the cut line moves the cut with the pointer", async ({ page }) => {
  const line = page.locator(".cut-line");
  const before = await value(page);
  const box = (await line.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // Grab the line away from the handle, inside the 44 px hit band but off the drawn line.
  await page.mouse.move(x, y + 15);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 5 });
  await page.mouse.up();
  const after = await value(page);
  expect(after).toBeGreaterThan(before);
  const moved = (await line.boundingBox())!;
  expect(moved.y + moved.height / 2).toBeCloseTo(y - 75, 0);

  // Dragging far past the top clamps to the window.
  await page.mouse.move(x, y - 75);
  await page.mouse.down();
  await page.mouse.move(x, 0, { steps: 3 });
  await page.mouse.up();
  expect(await value(page)).toBe(Number(await handle(page).getAttribute("aria-valuemax")));
});

test("the handle pings until first used, marks a drag and rings while focused", async ({
  page,
}) => {
  const svg = page.locator(".phase-diagram svg");
  const knob = page.locator(".cut-handle-knob");
  await expect(page.locator(".cut-handle-ping")).toHaveCount(1);
  await expect(knob).toHaveCSS("stroke", "none");

  const box = (await page.locator(".cut-line").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 15);
  await page.mouse.down();
  await expect(svg).toHaveClass(/cut-dragging/);
  await expect(page.locator(".cut-handle-ping")).toHaveCount(0);
  await page.mouse.up();
  await expect(svg).not.toHaveClass(/cut-dragging/);

  // The ring shows while the handle has focus, and again after a mouse click on the theme button
  // took the focus away.
  await expect(knob).not.toHaveCSS("stroke", "none");
  await page.getByRole("button", { name: /^Switch to/ }).click();
  await expect(knob).toHaveCSS("stroke", "none");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 15);
  await page.mouse.down();
  await page.mouse.up();
  await expect(knob).not.toHaveCSS("stroke", "none");

  await page.reload();
  await expect(page.locator(".cut-handle-ping")).toHaveCount(1);
});

test("the keyboard steps the cut", async ({ page }) => {
  await handle(page).focus();
  await page.keyboard.press("Home");
  const min = await value(page);
  expect(min).toBe(Number(await handle(page).getAttribute("aria-valuemin")));
  // The isobar steps evenly in log p: each step multiplies p* by the same factor.
  await page.keyboard.press("ArrowUp");
  const step = (await value(page)) / min;
  expect(step).toBeGreaterThan(1);
  await page.keyboard.press("PageUp");
  expect((await value(page)) / (min * step ** 11)).toBeCloseTo(1, 9);
  await page.keyboard.press("End");
  expect(await value(page)).toBe(Number(await handle(page).getAttribute("aria-valuemax")));
});

test("the isotherm stops where it leaves the boundaries, and the strips beyond are hatched", async ({
  page,
}) => {
  const diagram = page.locator(".phase-diagram");
  const strips = diagram.locator(".reach rect.out-of-reach");
  const slider = page.locator(".cut-input input[type=range]");
  const lineY = async () => {
    const box = (await page.locator(".cut-line").boundingBox())!;
    return box.y + box.height / 2;
  };
  // Every isobar of the window meets a boundary, so nothing is hatched in constant p mode.
  await expect(strips).toHaveCount(0);

  await page.getByRole("button", { name: "constant T" }).click();
  await expect(diagram).not.toHaveClass(/swapping/);
  await expect(strips).toHaveCount(2);
  const low = (await diagram.locator('rect.out-of-reach[data-side="low"]').boundingBox())!;
  const high = (await diagram.locator('rect.out-of-reach[data-side="high"]').boundingBox())!;

  // Home and End go to where the s-v line meets p_min and the l-v line meets p_max, at the
  // strips' edges, and the slider spans the same range. The cut there still meets its line, so
  // the slice keeps a stable crossing at both ends.
  const stableMarkers = page.locator(".slice-panel .crossing-marker.stable");
  await handle(page).focus();
  await page.keyboard.press("Home");
  expect(await value(page)).toBeCloseTo(234.5, 0);
  await expect(stableMarkers).toHaveCount(1);
  expect(Number(await slider.getAttribute("min"))).toBe(await value(page));
  expect(Math.abs((await lineY()) - low.y)).toBeLessThan(0.5);
  await page.keyboard.press("End");
  expect(await value(page)).toBeCloseTo(338.3, 0);
  await expect(stableMarkers).toHaveCount(1);
  expect(Number(await slider.getAttribute("max"))).toBe(await value(page));
  expect(Math.abs((await lineY()) - (high.y + high.height))).toBeLessThan(0.5);

  // A drag far into the low strip stops at its edge.
  const box = (await page.locator(".cut-line").boundingBox())!;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, (await lineY()) + 10);
  await page.mouse.down();
  await page.mouse.move(x, low.y + low.height + 100, { steps: 4 });
  await page.mouse.up();
  expect(await value(page)).toBeCloseTo(234.5, 0);

  await page.getByRole("button", { name: "constant p" }).click();
  await expect(diagram).not.toHaveClass(/swapping/);
  await expect(strips).toHaveCount(0);
});

test("either half of the toggle switches to the other mode, and its name follows", async ({
  page,
}) => {
  const toggle = page.locator(".mode-toggle");
  const half = (symbol: string) => toggle.locator("span", { hasText: symbol });
  // Each half in each mode: the filled half switches too.
  for (const [symbol, name, x] of [
    ["p", "constant p", "p (kPa)"],
    ["p", "constant T", "T (K)"],
    ["T", "constant p", "p (kPa)"],
    ["T", "constant T", "T (K)"],
  ] as const) {
    await half(symbol).click();
    await expect(toggle).toHaveAccessibleName(name);
    await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
    await expect(page.locator(".phase-diagram .x-label")).toHaveText(x);
  }
});

test("toggling back during the swap ends in the mode chosen last", async ({ page }) => {
  await page.getByRole("button", { name: "constant T" }).click();
  await page.getByRole("button", { name: "constant p" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(page.locator(".phase-diagram .x-label")).toHaveText("T (K)");
  await expect(handle(page)).toHaveAccessibleName("Isobar line, p* (kPa)");
});

test("a mode change during a drag ends it, and leaves the other mode's cut alone", async ({
  page,
}) => {
  const toggle = page.locator(".mode-toggle");
  const diagram = page.locator(".phase-diagram");
  await toggle.click();
  await expect(diagram).not.toHaveClass(/swapping/);
  const isotherm = await value(page);
  await toggle.click();
  await expect(diagram).not.toHaveClass(/swapping/);

  const box = (await page.locator(".cut-line").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y + 15);
  await page.mouse.down();
  await page.mouse.move(x, y - 40, { steps: 3 });
  const isobar = await value(page);
  // Another pointer (a second finger) switches the mode while the first still holds the line,
  // which then keeps moving, during the swap and after it.
  await toggle.evaluate((el: HTMLElement) => el.click());
  await page.mouse.move(x, y - 80, { steps: 3 });
  await expect(diagram).not.toHaveClass(/swapping/);
  await page.mouse.move(x, y + 60, { steps: 3 });
  await page.mouse.up();
  expect(await value(page)).toBe(isotherm);
  await toggle.click();
  await expect(diagram).not.toHaveClass(/swapping/);
  expect(await value(page)).toBe(isobar);
});

test("a cut and a unit change during the swap show once it ends", async ({ page }) => {
  const diagram = page.locator(".phase-diagram");
  await page.locator(".mode-toggle").click();
  await expect(diagram).toHaveClass(/swapping/);
  const number = page.getByRole("spinbutton", { name: /Isotherm temperature/ });
  await number.fill("250");
  await number.press("Enter");
  await page.getByRole("button", { name: "bar", exact: true }).click();
  await expect(diagram).not.toHaveClass(/swapping/);

  expect(await value(page)).toBe(250);
  await expect(diagram.locator(".x-label")).toHaveText("p (bar)");
  // The line sits at 250 K on the T axis, interpolated between its ticks.
  const ticks = await diagram.locator(".y-axis .tick").evaluateAll((els) =>
    els.map((el) => ({
      T: Number(el.textContent),
      y: el.querySelector("line")!.getBoundingClientRect().y,
    })),
  );
  const [a, b] = [ticks[0]!, ticks.at(-1)!];
  const line = (await page.locator(".cut-line").boundingBox())!;
  const at = a.y + ((250 - a.T) / (b.T - a.T)) * (b.y - a.y);
  expect(Math.abs(line.y + line.height / 2 - at)).toBeLessThan(1);
});

/**
 * Client-space boxes of the phase names and the bold values, where each value is anchored (the
 * screen x of its text-anchor point, which no font metric moves), and the x axis's tick texts.
 */
function readText(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".phase-diagram")!;
    const box = (el: Element) => el.getBoundingClientRect().toJSON() as DOMRect;
    return {
      labels: [...root.querySelectorAll(".phase-label")]
        .filter((el) => el.getAttribute("visibility") !== "hidden")
        .map((el) => ({ text: el.textContent, ...box(el) })),
      values: [...root.querySelectorAll<SVGTextElement>(".transition-value text")].map((el) => ({
        text: el.textContent!,
        anchor: el.getScreenCTM()!.e,
        ...box(el),
      })),
      ticks: [...root.querySelectorAll(".transition-tick")].map((el) => box(el).x),
      guides: [...root.querySelectorAll("line.guide.stable")].map((el) => box(el).x),
      tickTexts: [...root.querySelectorAll(".x-axis .tick text")].map((el) => el.textContent),
    };
  });
}

/** The values of the readout's stable rows, as "291.0 K". */
const stableRows = async (page: Page) =>
  (await page.locator(".readout .transitions li.stable").allInnerTexts()).map(
    (t) => /(\S+ (K|kPa|bar|atm))$/.exec(t.trim())![1]!,
  );

test("the regions carry their names, and there is no legend", async ({ page }) => {
  for (const mode of ["constant p", "constant T"] as const) {
    await setMode(page, mode);
    const { labels } = await readText(page);
    expect(labels.map((l) => l.text)).toEqual(["solid", "liquid", "vapor"]);
    await expect(page.locator(".phase-diagram .phase-labels")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  }
  await expect(page.locator(".legend")).toHaveCount(0);
  await expect(page.locator(".cut-value")).toHaveCount(0);
});

test("the names stay put while the cut is dragged", async ({ page }) => {
  const before = (await readText(page)).labels;
  await handle(page).focus();
  await page.keyboard.press("PageDown");
  await page.keyboard.press("PageDown");
  expect((await readText(page)).labels).toEqual(before);
});

test("the bold values match the readout's stable rows and sit on their guide lines", async ({
  page,
}) => {
  const { values, ticks, guides, tickTexts } = await readText(page);
  expect(values.map((v) => v.text)).toEqual(await stableRows(page));
  expect(values.length).toBe(2);
  for (const [k, v] of values.entries()) {
    // Each value is anchored on its guide; its rendered box is centered there up to the font's
    // hinting, which differs by platform (half a px on Linux).
    expect(Math.abs(v.anchor - guides[k]!)).toBeLessThan(0.01);
    expect(Math.abs(v.x + v.width / 2 - guides[k]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(ticks[k]! - guides[k]!)).toBeLessThan(0.5);
  }
  // The axis keeps its tick marks but has no numbers: the slice's top axis carries them.
  expect(tickTexts.length).toBeGreaterThan(2);
  expect(tickTexts.every((t) => t === "")).toBe(true);
  await expect(page.locator(".phase-diagram .transition-values")).toHaveAttribute(
    "aria-hidden",
    "true",
  );
});

test("dragging the cut moves the values, and toggling the axes relabels them", async ({ page }) => {
  const before = (await readText(page)).values;
  await handle(page).focus();
  await page.keyboard.press("PageUp");
  const after = await readText(page);
  expect(after.values.map((v) => v.text)).toEqual(await stableRows(page));
  // H₂O's s-l line is almost vertical, so the l-v value is the one that moves.
  expect(after.values.at(-1)!.text).not.toBe(before.at(-1)!.text);
  expect(after.values.at(-1)!.x).not.toBeCloseTo(before.at(-1)!.x, 0);

  await page.getByRole("button", { name: "constant T" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  const isotherm = await readText(page);
  expect(isotherm.values.length).toBeGreaterThan(0);
  expect(isotherm.values.map((v) => v.text)).toEqual(await stableRows(page));
  for (const v of isotherm.values) expect(v.text).toMatch(/ kPa$/);
});

test("values that would overlap are pushed apart, and their ticks stay at the true x", async ({
  page,
}) => {
  // Just above p_tp the s-l and l-v crossings are about a kelvin apart.
  const number = page.getByRole("spinbutton", { name: /Isobar pressure/ });
  await number.fill("0.65");
  await number.press("Enter");
  const { values, ticks, guides } = await readText(page);
  expect(values).toHaveLength(2);
  const a = values[0]!;
  const b = values[1]!;
  expect(a.x + a.width).toBeLessThan(b.x);
  for (const [k, t] of ticks.entries()) expect(Math.abs(t - guides[k]!)).toBeLessThan(0.5);
  // Each value is moved away from its guide by the same amount.
  const shiftA = guides[0]! - a.anchor;
  const shiftB = b.anchor - guides[1]!;
  expect(shiftA).toBeGreaterThan(0.5);
  expect(Math.abs(shiftA - shiftB)).toBeLessThan(1);
});

test("the metastable branches add no value, and the triple point gets one", async ({ page }) => {
  const count = async () => (await readText(page)).values.length;
  const shown = await count();
  await page.getByRole("button", { name: "Metastable" }).click();
  expect(await count()).toBe(shown);
  await page.getByRole("button", { name: "Metastable" }).click();
  expect(await count()).toBe(shown);
  await page.getByRole("button", { name: "pTerrain" }).click();
  expect((await readText(page)).values.map((v) => v.text)).toEqual(["273.2 K"]);
});

/** The d of each boundary path by pair and kind, and the s-l stable line's top end. */
function readBoundaries(page: Page) {
  return page.evaluate(() => {
    const d = (sel: string) =>
      document.querySelector(`.phase-diagram path.boundary${sel}`)!.getAttribute("d")!;
    const sl = d('.stable[data-pair="s-l"]')
      .slice(1)
      .split("L")
      .map((s) => s.split(",").map(Number) as [number, number]);
    return {
      sl: d('.stable[data-pair="s-l"]'),
      sv: d('.stable[data-pair="s-v"]'),
      lv: d('.stable[data-pair="l-v"]'),
      slTop: sl.reduce((a, b) => (b[1] < a[1] ? b : a)),
      slBottom: sl.reduce((a, b) => (b[1] > a[1] ? b : a)),
      curves: [...document.querySelectorAll(".slice-panel path.curve")].map((el) =>
        el.getAttribute("d"),
      ),
    };
  });
}

/** Parses an SVG polyline path "Mx,yLx,y…" into its points. */
const points = (d: string) =>
  d
    .slice(1)
    .split("L")
    .map((q) => q.split(",").map(Number) as [number, number]);

test("the exaggerate checkbox switches every plot to the exaggerated model", async ({ page }) => {
  const box = page.getByRole("checkbox", { name: /Exaggerate s-l slope/ });
  await expect(box).not.toBeChecked();
  // In the column beside the plots, between the cut input and the Parameters panel.
  const cutInput = (await page.locator(".cut-input").boundingBox())!;
  const substance = (await page.locator(".parameters summary").boundingBox())!;
  const boxRow = (await page.locator(".exaggerate").boundingBox())!;
  expect(boxRow.y).toBeGreaterThanOrEqual(cutInput.y + cutInput.height);
  expect(boxRow.y + boxRow.height).toBeLessThanOrEqual(substance.y);
  expect(Math.abs(boxRow.x - substance.x)).toBeLessThan(1);
  const note = page.locator(".exaggerated-note");
  await expect(note).toBeHidden();
  const real = await readBoundaries(page);
  const values = (await readText(page)).values.map((v) => v.text);

  await box.check();
  await expect(page.locator(".exaggerate .factor")).toHaveText("(Δv_fus ×7,500, schematic)");
  const drawn = await readBoundaries(page);
  // H₂O's line leans back: its top end moves well to the left, from the same triple point.
  expect(drawn.slTop[0]).toBeLessThan(real.slTop[0] - 50);
  expect(
    Math.hypot(drawn.slBottom[0] - real.slBottom[0], drawn.slBottom[1] - real.slBottom[1]),
  ).toBeLessThan(0.5);
  // The liquid and the vapor are untouched, so l-v is the same line; s-v moves under half a px.
  expect(drawn.lv).toBe(real.lv);
  const [a, b] = [points(real.sv), points(drawn.sv)];
  expect(b).toHaveLength(a.length);
  for (const [k, q] of a.entries()) {
    expect(Math.hypot(q[0] - b[k]![0], q[1] - b[k]![1])).toBeLessThan(0.5);
  }
  // The slice follows the model: its curves change, and every marker and bold value lines up with
  // the diagram's, the s-l ones included.
  expect(drawn.curves).not.toEqual(real.curves);
  const { diagram, slice } = await page.evaluate(() => {
    const xs = (sel: string) =>
      [...document.querySelectorAll(`${sel} .crossing-marker`)].map((el) => {
        const r = el.getBoundingClientRect();
        return { pair: el.getAttribute("data-pair"), x: r.x + r.width / 2 };
      });
    return { diagram: xs(".phase-diagram"), slice: xs(".slice-panel") };
  });
  expect(slice.map((m) => m.pair)).toEqual(diagram.map((m) => m.pair));
  expect(diagram.map((m) => m.pair)).toContain("s-l");
  for (const [k, m] of diagram.entries()) expect(Math.abs(m.x - slice[k]!.x)).toBeLessThan(0.5);
  const after = (await readText(page)).values.map((v) => v.text);
  expect(after).toEqual(await stableRows(page));
  expect(after[0]).not.toBe(values[0]);
  await expect(page.locator('.readout li[data-pair="s-l"]').first()).toHaveText(
    /^solid–liquid, slope exaggerated: /,
  );
  // "slope exaggerated", in the axes' gray, up and to the left of the line's top end.
  await expect(note).toBeVisible();
  await expect(note).toHaveText("slope exaggerated");
  const svg = (await page.locator(".phase-diagram svg").boundingBox())!;
  const noteBox = (await note.boundingBox())!;
  const top = { x: svg.x + 60 + drawn.slTop[0], y: svg.y + 12 + drawn.slTop[1] };
  expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(top.x);
  expect(noteBox.y).toBeGreaterThanOrEqual(top.y);
  expect(noteBox.y).toBeLessThan(top.y + 30);
  const muted = await page
    .locator(".phase-diagram .axis")
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(await note.evaluate((el) => getComputedStyle(el).fill)).toBe(muted);

  // It holds through the axis swap, and unticking restores the true model.
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(note).toBeVisible();
  await page.getByRole("button", { name: "constant p" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await box.uncheck();
  await expect(note).toBeHidden();
  const restored = await readBoundaries(page);
  expect([restored.sl, restored.curves]).toEqual([real.sl, real.curves]);
  expect((await readText(page)).values.map((v) => v.text)).toEqual(values);

  // Where there is nothing to exaggerate (a line that already leans far), the box stays ticked
  // but the model is the true one, and there is no note.
  await box.check();
  await page.locator(".parameters summary").click();
  await page.getByRole("combobox", { name: "Substance" }).selectOption("custom");
  // v_l = 3.6 L/mol in Custom's window, 220–380 K: the line drifts more than a tenth of the T
  // range. The window is kept as it is, not fitted to the new v_l.
  await page.getByRole("checkbox", { name: "Automatic window" }).uncheck();
  await page.locator('.parameters input[name="Vl"]').fill("3.6");
  await page.locator('.parameters input[name="Vl"]').press("Enter");
  await expect(page.locator(".validation")).toBeEmpty();
  await expect(page.locator(".exaggerate .factor")).toHaveText("");
  await expect(note).toBeHidden();
});

test("the names follow the regions of the model, also after a substance change mid-swap", async ({
  page,
}) => {
  await page.getByRole("checkbox", { name: /Exaggerate s-l slope/ }).check();
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await page.getByRole("button", { name: "constant p" }).click();
  await page.getByRole("combobox", { name: "Substance" }).selectOption("co2");
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(page.locator(".exaggerate .factor")).toHaveText(/^\(Δv_fus ×\d+, schematic\)$/);
  // Each name sits on its own phase's color in the region bitmap.
  const ok = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.regions")!;
    const ctx = canvas.getContext("2d")!;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const style = getComputedStyle(document.querySelector(".phase-diagram")!);
    const rgb = (v: string) => {
      const h = style.getPropertyValue(v).trim();
      return [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
    };
    const color: Record<string, number[]> = {
      s: rgb("--phase-solid"),
      l: rgb("--phase-liquid"),
      v: rgb("--phase-vapor"),
    };
    // The bitmap is drawn at the region opacity, so the nearest phase color is taken.
    return [...document.querySelectorAll<SVGTextElement>(".phase-label")].map((el) => {
      const x = Math.round(Number(el.getAttribute("x")) * scale);
      const y = Math.round(Number(el.getAttribute("y")) * scale);
      const px = [...ctx.getImageData(x, y, 1, 1).data.slice(0, 3)];
      const dist = (c: number[]) => c.reduce((sum, v, k) => sum + (v - px[k]!) ** 2, 0);
      const nearest = Object.entries(color).reduce((a, b) => (dist(b[1]) < dist(a[1]) ? b : a));
      return nearest[0] === el.dataset.phase;
    });
  });
  expect(ok).toEqual([true, true, true]);
});

test("the note stays clear of the drawn line and the names, for both substances and modes", async ({
  page,
}) => {
  await page.getByRole("checkbox", { name: /Exaggerate s-l slope/ }).check();
  for (const substance of ["h2o", "co2"]) {
    await page.getByRole("combobox", { name: "Substance" }).selectOption(substance);
    for (const mode of ["constant p", "constant T"] as const) {
      await setMode(page, mode);
      const hits = await page.evaluate(() => {
        const note = document.querySelector(".exaggerated-note")!.getBoundingClientRect();
        const inside = (x: number, y: number) =>
          x >= note.left && x <= note.right && y >= note.top && y <= note.bottom;
        const path = document.querySelector<SVGPathElement>(
          '.phase-diagram path.boundary.stable[data-pair="s-l"]',
        )!;
        const ctm = path.getScreenCTM()!;
        const length = path.getTotalLength();
        let line = 0;
        for (let k = 0; k <= 400; k++) {
          const q = path.getPointAtLength((length * k) / 400).matrixTransform(ctm);
          if (inside(q.x, q.y)) line++;
        }
        const names = [...document.querySelectorAll(".phase-label")].filter((el) => {
          const r = el.getBoundingClientRect();
          return !(
            r.right < note.left ||
            r.left > note.right ||
            r.bottom < note.top ||
            r.top > note.bottom
          );
        }).length;
        return { line, names };
      });
      expect(hits, `${substance}, ${mode}`).toEqual({ line: 0, names: 0 });
    }
  }
});
