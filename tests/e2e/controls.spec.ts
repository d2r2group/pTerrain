import { expect, test, type Page } from "@playwright/test";

const handle = (page: Page) => page.locator(".cut-handle");
const value = async (page: Page) => Number(await handle(page).getAttribute("aria-valuenow"));
const field = (page: Page, name: string) => page.locator(`.parameters input[name="${name}"]`);
const slLine = (page: Page) => page.locator('.phase-diagram path.boundary.stable[data-pair="s-l"]');

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
  // The tests are written for H₂O; a first visit opens on CO₂ (tested below).
  await page.goto("./#h2o");
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
  await page.locator(".parameters summary").click();
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

/** Types `text` into a parameter field and applies it with Enter. */
async function setField(page: Page, name: string, text: string) {
  await field(page, name).fill(text);
  await field(page, name).press("Enter");
}

const autoBox = (page: Page) => page.getByRole("checkbox", { name: "Automatic window" });
const applyButton = (page: Page) => page.getByRole("button", { name: "Apply" });

/** Unticks *auto*, so that the window fields can be typed in. */
async function untickAuto(page: Page) {
  await autoBox(page).uncheck();
  await expect(field(page, "Tmin")).toBeEnabled();
}

/** The s-l line's end points in plot pixels: [x at the top, x at the bottom]. */
async function slEnds(page: Page): Promise<[number, number]> {
  const d = (await slLine(page).getAttribute("d"))!;
  const pts = d
    .slice(1)
    .split("L")
    .map((s) => s.split(",").map(Number));
  const top = pts.reduce((a, b) => (b[1]! < a[1]! ? b : a));
  const bottom = pts.reduce((a, b) => (b[1]! > a[1]! ? b : a));
  return [top[0]!, bottom[0]!];
}

test("the cut handle, slider and number field have distinct names", async ({ page }) => {
  await expect(handle(page)).toHaveAccessibleName("Isobar line, p* (kPa)");
  await expect(page.getByRole("slider", { name: "Isobar pressure p* (kPa)" })).toHaveCount(1);
  await expect(
    page.getByRole("spinbutton", { name: "Isobar pressure p* (kPa), typed value" }),
  ).toHaveCount(1);
  // The axis toggle sits above the diagram in the wide layout too.
  const toggle = (await page.locator(".mode-toggle").boundingBox())!;
  const diagram = (await page.locator(".phase-diagram svg").boundingBox())!;
  expect(toggle.y + toggle.height).toBeLessThanOrEqual(diagram.y);
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(handle(page)).toHaveAccessibleName("Isotherm line, T* (K)");
  await expect(page.getByRole("slider", { name: "Isotherm temperature T* (K)" })).toHaveCount(1);
});

test("a first visit opens on CO₂, first in the menu, which switches the substance and resets the cuts", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
  await page.locator(".parameters summary").click();
  const select = page.getByRole("combobox", { name: "Substance" });
  await expect(select).toHaveValue("co2");
  await expect(select.locator("option:not([disabled])")).toHaveText(["CO₂", "H₂O", "Custom"]);
  // CO₂: the s-l line slopes forward, so it is further right at the top.
  let [top, bottom] = await slEnds(page);
  expect(top).toBeGreaterThan(bottom + 2);
  // The default isobar lies halfway between p_tp and p_max on the log axis.
  expect(await value(page)).toBeCloseTo(Math.sqrt(517.964 * 2500), 9);

  await handle(page).focus();
  await page.keyboard.press("PageUp");
  await select.selectOption("h2o");
  // H₂O: the s-l line slopes back, so it is further left at the top (by a fraction of a px).
  [top, bottom] = await slEnds(page);
  expect(top).toBeLessThan(bottom);
  await expect(field(page, "Vs")).toHaveValue("0.019652");
  await expect(field(page, "Vl")).toHaveValue("0.018019");
  expect(await value(page)).toBeCloseTo(Math.sqrt(0.611654 * 25), 9);
});

test("choosing Custom opens the parameters, and scrolls to them only under the plots", async ({
  page,
}) => {
  const select = page.getByRole("combobox", { name: "Substance" });
  const details = page.locator(".parameters");
  // Reduced motion scrolls at once, so a smooth scroll cannot still run into the next check.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, under] of [
    [1280, false],
    [800, true],
    [320, true],
  ] as const) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("./");
    await expect(page.locator(".phase-diagram svg")).toBeVisible();
    await expect(details).not.toHaveAttribute("open");
    await select.selectOption("custom");
    await expect(details).toHaveAttribute("open");
    if (under) {
      // At the top of the window, or as near as the page's end lets it come.
      const { top, end } = await page.evaluate(() => ({
        top: document.querySelector(".parameters")!.getBoundingClientRect().top,
        end: document.documentElement.scrollHeight - window.innerHeight - window.scrollY,
      }));
      expect(top, `${width}`).toBeGreaterThan(-1);
      expect(Math.min(top, end), `${width}`).toBeLessThan(1);
    } else {
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    }
    // A preset neither closes them nor scrolls.
    await page.evaluate(() => window.scrollTo(0, 0));
    await select.selectOption("co2");
    await expect(details).toHaveAttribute("open");
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }
});

test("choosing Custom loads the schematic substance as a starting point", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "Substance" });
  await select.selectOption("custom");
  await expect(select).toHaveValue("custom");
  for (const [name, text] of [
    ["Tt", "300"],
    ["pt", "50"],
    ["dHfus", "2.49"],
    ["dHvap", "12.5"],
    ["Ss", "33.3"],
    ["Vs", "2"],
    ["Vl", "3.5"],
    ["cps", "0"],
    ["Tmin", "220"],
    ["Tmax", "380"],
    ["pmin", "15"],
    ["pmax", "150"],
  ] as const) {
    await expect(field(page, name)).toHaveValue(text);
  }
  await expect(page.locator(".validation")).toBeEmpty();
  // v_s < v_l: the s-l line slopes forward, further right at the top.
  const [top, bottom] = await slEnds(page);
  expect(top).toBeGreaterThan(bottom + 5);
  // The cuts are reset, as for a preset: the isobar halfway between p_tp and p_max on the log axis.
  expect(await value(page)).toBeCloseTo(Math.sqrt(50 * 150), 9);
  // An edit keeps it Custom, and a preset can be chosen again.
  await setField(page, "Vl", "3");
  await expect(select).toHaveValue("custom");
  await select.selectOption("h2o");
  await expect(field(page, "Tt")).toHaveValue("273.16");
});

test("a valid edit is applied, and the menu shows Custom", async ({ page }) => {
  const before = await slLine(page).getAttribute("d");
  await setField(page, "Vs", "0.0195");
  await expect(page.locator(".validation")).toBeEmpty();
  await expect(slLine(page)).not.toHaveAttribute("d", before!);
  await expect(page.getByRole("combobox", { name: "Substance" })).toHaveValue("custom");
  await expect(page.locator(".validation")).toBeEmpty();
});

test("the panel opens with auto ticked, and Apply waits for an edit", async ({ page }) => {
  await expect(autoBox(page)).toBeChecked();
  for (const name of ["Tmin", "Tmax", "pmin", "pmax"])
    await expect(field(page, name)).toBeDisabled();
  await expect(field(page, "Tt")).toBeEnabled();
  await expect(applyButton(page)).toBeDisabled();
  // Above the Triple point fieldset and as wide, and hidden with the closed panel.
  const button = (await applyButton(page).boundingBox())!;
  const set = (await page.locator(".parameters fieldset").first().boundingBox())!;
  await expect(page.locator(".parameters fieldset legend").first()).toHaveText("Triple point");
  expect(button.y + button.height).toBeLessThanOrEqual(set.y);
  expect(Math.abs(button.x - set.x)).toBeLessThan(1);
  expect(Math.abs(button.width - set.width)).toBeLessThan(1);
  // On a row of its own: nothing else sits beside it.
  for (const box of await page
    .locator(".parameters fieldset")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top)))
    expect(box).toBeGreaterThanOrEqual(button.y + button.height);
  await page.locator(".parameters summary").click();
  await expect(applyButton(page)).toBeHidden();
  await page.locator(".parameters summary").click();
  // A typed value enables it, and typing the applied value back disables it again.
  await field(page, "Vs").fill("0.03");
  await expect(applyButton(page)).toBeEnabled();
  await field(page, "Vs").fill("0.019652");
  await expect(applyButton(page)).toBeDisabled();
});

test("an edit changes nothing until Apply", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "Substance" });
  const readout = page.locator(".readout .transitions");
  const lv = page.locator('.phase-diagram path.boundary.stable[data-pair="l-v"]');
  const before = await lv.getAttribute("d");
  const rows = await readout.textContent();
  await field(page, "dHvap").fill("40");
  await field(page, "dHvap").blur();
  await expect(applyButton(page)).toBeEnabled();
  await expect(lv).toHaveAttribute("d", before!);
  await expect(readout).toHaveText(rows!);
  await expect(select).toHaveValue("h2o");

  await applyButton(page).click();
  await expect(lv).not.toHaveAttribute("d", before!);
  await expect(readout).not.toHaveText(rows!);
  await expect(select).toHaveValue("custom");
  await expect(applyButton(page)).toBeDisabled();
});

test("an invalid edit warns only on Apply, and Apply stays enabled", async ({ page }) => {
  const alert = page.locator(".validation");
  const before = await slLine(page).getAttribute("d");
  await field(page, "dHfus").fill("-1");
  await field(page, "dHfus").blur();
  await expect(alert).toBeEmpty();
  await applyButton(page).click();
  await expect(alert.locator('li[data-check="dHfus"]')).toBeVisible();
  await expect(slLine(page)).toHaveAttribute("d", before!);
  await expect(applyButton(page)).toBeEnabled();
  await expect(page.getByRole("combobox", { name: "Substance" })).toHaveValue("custom");
  // Typing the applied value back leaves nothing to apply, so the warning goes.
  await field(page, "dHfus").fill("6.007");
  await expect(applyButton(page)).toBeDisabled();
  await expect(alert).toBeEmpty();
  await expect(field(page, "dHfus")).not.toHaveAttribute("aria-invalid");
  await expect(page.getByRole("combobox", { name: "Substance" })).toHaveValue("h2o");
});

test("with auto, an edited T_tp moves the window to keep the triple point in the middle", async ({
  page,
}) => {
  await setField(page, "Tt", "280");
  await expect(page.locator(".validation")).toBeEmpty();
  // 280 (1 ∓ 0.27) K to the nearest 5 K.
  await expect(field(page, "Tmin")).toHaveValue("205");
  await expect(field(page, "Tmax")).toHaveValue("355");
  const num = async (name: string) => Number(await field(page, name).inputValue());
  const [pt, pmin, pmax] = [await num("pt"), await num("pmin"), await num("pmax")];
  const up = Math.log(pt / pmin) / Math.log(pmax / pmin);
  expect(up).toBeGreaterThan(0.4);
  expect(up).toBeLessThan(0.6);
  await expect(field(page, "Tmin")).toBeDisabled();
});

test("unticking auto enables the window fields, and a typed window is applied as typed", async ({
  page,
}) => {
  await untickAuto(page);
  await expect(field(page, "pmax")).toHaveValue("25");
  await setField(page, "pmax", "8");
  await expect(page.locator(".validation")).toBeEmpty();
  await expect(field(page, "pmax")).toHaveValue("8");
  await expect(page.locator(".phase-diagram .y-axis .tick").last()).toHaveText("1");
  const number = page.getByRole("spinbutton", { name: /Isobar pressure/ });
  await number.fill("1000");
  await number.press("Enter");
  expect(await value(page)).toBe(8);
  // Ticking again grays the fields, and keeps the window until the next Apply.
  await autoBox(page).check();
  await expect(field(page, "pmax")).toBeDisabled();
  await expect(field(page, "pmax")).toHaveValue("8");
  await expect(applyButton(page)).toBeEnabled();
  await applyButton(page).click();
  await expect(field(page, "pmax")).toHaveValue("25");
  await expect(page.getByRole("combobox", { name: "Substance" })).toHaveValue("h2o");
});

test("Apply without edits keeps H₂O selected and its window unchanged", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "Substance" });
  const sv = page.locator('.phase-diagram path.boundary.stable[data-pair="s-v"]');
  const before = await sv.getAttribute("d");
  // Unticked, the fields hold the applied window; ticked again, the rule gives it back.
  for (const on of [false, true]) {
    await autoBox(page).setChecked(on);
    await applyButton(page).click();
    await expect(select).toHaveValue("h2o");
    await expect(field(page, "Tmax")).toHaveValue("345");
    await expect(field(page, "pmin")).toHaveValue("0.015");
    await expect(sv).toHaveAttribute("d", before!);
    await expect(applyButton(page)).toBeDisabled();
  }
});

test("the menu discards unapplied edits, and a unit change is not an edit", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "Substance" });
  await page.getByRole("button", { name: "bar", exact: true }).click();
  await expect(applyButton(page)).toBeDisabled();
  await field(page, "Vs").fill("0.03");
  await select.selectOption("co2");
  await expect(field(page, "Vs")).toHaveValue("0.02856");
  await expect(applyButton(page)).toBeDisabled();
  await select.selectOption("h2o");
  await expect(field(page, "Vs")).toHaveValue("0.019652");
  await page.getByRole("button", { name: "kPa" }).click();
  await expect(applyButton(page)).toBeDisabled();
});

test("an invalid edit shows a warning and keeps the last valid diagram", async ({ page }) => {
  const before = await slLine(page).getAttribute("d");
  await setField(page, "dHfus", "-1");
  const alert = page.locator(".validation");
  await expect(alert.locator('li[data-check="dHfus"]')).toBeVisible();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(field(page, "dHfus")).toHaveAttribute("aria-invalid");
  await expect(slLine(page)).toHaveAttribute("d", before!);

  // Breaking a limit over the window: the vapor is too dense at p_max.
  await setField(page, "dHfus", "6.007");
  await expect(alert).toBeEmpty();
  await untickAuto(page);
  await setField(page, "pmax", "40000");
  await expect(alert.locator('li[data-check="vaporDensity"]')).toBeVisible();
  await expect(page.locator(".phase-diagram .y-axis .tick").last()).toHaveText("10");

  // Choosing a preset again clears the warning and the fields.
  await page.getByRole("combobox", { name: "Substance" }).selectOption("h2o");
  await expect(alert).toBeEmpty();
  await expect(field(page, "pmax")).toHaveValue("25");
  await expect(field(page, "dHfus")).not.toHaveAttribute("aria-invalid");
});

test("the slider and number field set the cut, and snapping goes to the triple point", async ({
  page,
}) => {
  const number = page.getByRole("spinbutton", { name: /Isobar pressure/ });
  await number.fill("7.5");
  await number.press("Enter");
  expect(await value(page)).toBe(7.5);
  await expect(number).toHaveValue("7.5");
  // A typed value stays as typed; the store keeps it exactly.
  await number.fill("12.345");
  await number.press("Enter");
  expect(await value(page)).toBe(12.345);
  await expect(number).toHaveValue("12.345");

  // Out-of-window values are clamped; text that is not a number is ignored.
  await number.fill("1000");
  await number.press("Enter");
  expect(await value(page)).toBe(25);
  await expect(number).toHaveValue("25");

  const range = page.getByRole("slider", { name: "Isobar pressure p* (kPa)" });
  await range.focus();
  await range.press("Home");
  expect(await value(page)).toBe(0.015);
  // The slider moves in log p: halfway along it is the geometric mean of the window's edges.
  await range.evaluate((el: HTMLInputElement) => {
    el.value = String(0.5 * (Number(el.min) + Number(el.max)));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(await value(page)).toBeCloseTo(Math.sqrt(0.015 * 25), 9);

  await page.getByRole("button", { name: "pTerrain" }).click();
  expect(await value(page)).toBe(0.611654);
  await expect(number).toHaveValue("0.612");
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await page.getByRole("button", { name: "pTerrain" }).click();
  expect(await value(page)).toBe(273.16);
  await expect(page.getByRole("spinbutton", { name: /Isotherm temperature/ })).toHaveValue("273.2");
});

test("a typed pressure keeps all its digits after Enter", async ({ page }) => {
  // CO₂'s window starts at 100 kPa, so 1 atm lies inside it.
  await page.getByRole("combobox", { name: "Substance" }).selectOption("co2");
  const number = page.getByRole("spinbutton", { name: /Isobar pressure/ });
  await number.fill("101.325");
  await number.press("Enter");
  expect(await value(page)).toBe(101.325);
  await expect(number).toHaveValue("101.325");
  // It is still there once the field loses focus.
  await number.blur();
  await expect(number).toHaveValue("101.325");
});

test("a window where the s-v line meets T_min is rejected", async ({ page }) => {
  const before = await page
    .locator('.phase-diagram path.boundary.stable[data-pair="s-v"]')
    .getAttribute("d");
  await untickAuto(page);
  await setField(page, "pmin", "0.0001");
  const alert = page.locator(".validation");
  await expect(alert.locator('li[data-check="sublimationEdge"]')).toBeVisible();
  await expect(field(page, "pmin")).toHaveAttribute("aria-invalid");
  await expect(field(page, "Tmin")).toHaveAttribute("aria-invalid");
  await expect(
    page.locator('.phase-diagram path.boundary.stable[data-pair="s-v"]'),
  ).toHaveAttribute("d", before!);
  await setField(page, "pmin", "0.015");
  await expect(alert).toBeEmpty();
  await expect(page.getByRole("combobox", { name: "Substance" })).toHaveValue("h2o");
});

test("a window where the l-v line meets T_max is rejected", async ({ page }) => {
  const lv = page.locator('.phase-diagram path.boundary.stable[data-pair="l-v"]');
  const before = await lv.getAttribute("d");
  // The l-v line meets T_max = 345 K at about 34 kPa.
  await untickAuto(page);
  await setField(page, "pmax", "50");
  const alert = page.locator(".validation");
  await expect(alert.locator('li[data-check="vaporizationEdge"]')).toBeVisible();
  await expect(field(page, "pmax")).toHaveAttribute("aria-invalid");
  await expect(field(page, "Tmax")).toHaveAttribute("aria-invalid");
  await expect(lv).toHaveAttribute("d", before!);
  await setField(page, "pmax", "25");
  await expect(alert).toBeEmpty();
  await expect(page.getByRole("combobox", { name: "Substance" })).toHaveValue("h2o");
});

test("a window that leaves out the triple point is rejected", async ({ page }) => {
  const alert = page.locator(".validation");
  const sv = page.locator('.phase-diagram path.boundary.stable[data-pair="s-v"]');
  const before = await sv.getAttribute("d");
  await untickAuto(page);
  await setField(page, "Tmin", "280");
  await expect(alert.locator('li[data-check="tripleInWindow"]')).toBeVisible();
  await expect(sv).toHaveAttribute("d", before!);
  // The window fields are marked, not the triple point's.
  for (const name of ["Tmin", "Tmax", "pmin", "pmax"]) {
    await expect(field(page, name)).toHaveAttribute("aria-invalid", "");
  }
  for (const name of ["Tt", "pt"])
    await expect(field(page, name)).not.toHaveAttribute("aria-invalid");
  await expect(page.getByRole("button", { name: "pTerrain" })).toBeEnabled();
  await setField(page, "Tmin", "200");
  await expect(alert).toBeEmpty();
});

test("the readout lists the crossings for screen readers only, in order along the cut", async ({
  page,
}) => {
  const rows = page.locator(".readout .transitions li");
  const markers = page.locator(".phase-diagram .crossing-marker");
  await expect(rows).toHaveCount(await markers.count());
  const pairs = await markers.evaluateAll((els) => els.map((el) => el.getAttribute("data-pair")));
  expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-pair")))).toEqual(
    pairs,
  );
  // Each row names its two phases and gives the value, but nothing of it is on screen: the bold
  // values under the diagram's x axis show the transitions there.
  await expect(rows.first()).toHaveText(/^solid–liquid: \d+\.\d K$/);
  await expect(page.getByRole("region", { name: "Readout" })).toHaveCSS("position", "absolute");
  expect((await page.locator(".readout").boundingBox())!.width).toBeLessThanOrEqual(1);
  await expect(page.locator(".chip")).toHaveCount(0);
  // The readout no longer repeats the cut value; the number field shows it.
  await expect(page.locator(".readout .cut-value")).toHaveCount(0);
});

test("the metastable toggle hides the dashed branches and their guides, not the stable ones", async ({
  page,
}) => {
  const metastable = page.locator(".plots .metastable, .readout .metastable");
  const stable = page.locator(".plots .stable");
  // H₂O's dashed s-l extension is vertical and a condensed g(p) nearly flat, so both have an empty
  // box; the vapor's dashed curve is checked.
  const dashed = page.locator('.slice-panel path.curve.metastable[data-phase="v"]').first();
  expect(await metastable.count()).toBeGreaterThan(0);
  await expect(dashed).toBeVisible();

  const toggle = page.getByRole("button", { name: "Metastable" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  for (const el of await metastable.all()) await expect(el).toBeHidden();
  // Vertical guide lines have an empty box, so `display` is checked rather than visibility.
  for (const el of await stable.all()) await expect(el).not.toHaveCSS("display", "none");

  // Still hidden after a new cut and in the other mode.
  await handle(page).focus();
  await page.keyboard.press("PageDown");
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  for (const el of await metastable.all()) await expect(el).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(dashed).toBeVisible();
});

/** The pixels that must not move when the unit changes: the cut line, a boundary and a curve. */
const drawing = (page: Page) =>
  page.evaluate(() => ({
    cut: document.querySelector(".cut-line")!.getAttribute("y1"),
    boundary: document
      .querySelector('.phase-diagram path.boundary.stable[data-pair="l-v"]')!
      .getAttribute("d"),
    curve: document.querySelector('.slice-panel path.curve[data-phase="v"]')!.getAttribute("d"),
    regions: (document.querySelector("canvas.regions") as HTMLCanvasElement).toDataURL(),
  }));

test("the pressure unit toggle sits in the cut input, beside the p* label", async ({ page }) => {
  const units = page.getByRole("group", { name: "Pressure unit" });
  await expect(units.getByRole("button")).toHaveText(["kPa", "bar", "atm"]);
  await expect(units.getByRole("button", { name: "kPa" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".cut-input .unit-toggle")).toHaveCount(1);
  await expect(page.locator(".main-row .unit-toggle")).toHaveCount(0);
  const label = (await page.locator(".cut-input label").boundingBox())!;
  const toggle = (await units.boundingBox())!;
  expect(toggle.x).toBeGreaterThan(label.x + label.width);
  expect(Math.abs(toggle.y + toggle.height / 2 - (label.y + label.height / 2))).toBeLessThan(2);
});

test("switching the unit relabels the axes, readout and fields, and moves nothing", async ({
  page,
}) => {
  const before = await drawing(page);
  await page.getByRole("button", { name: "bar", exact: true }).click();
  await expect(page.locator(".phase-diagram .y-label")).toHaveText("p (bar)");
  await expect(page.locator(".cut-input label")).toHaveText("p* (bar)");
  await expect(handle(page)).toHaveAccessibleName("Isobar line, p* (bar)");
  // The default isobar, √(p_tp p_max) = 3.91 kPa.
  await expect(page.getByRole("spinbutton", { name: /Isobar pressure/ })).toHaveValue("0.0391");
  // H₂O's p axis, 0.015–25 kPa, is 0.00015–0.25 bar: ticks at the powers of ten of bar.
  await expect(page.locator(".phase-diagram .y-axis .tick text")).toHaveText([
    "0.001",
    "0.01",
    "0.1",
  ]);
  await expect(field(page, "pt")).toHaveValue("0.00611654");
  await expect(field(page, "pmax")).toHaveValue("0.25");
  await expect(page.locator('.parameters label:has(input[name="pmin"]) .field-unit')).toHaveText(
    "bar",
  );
  await expect(page.getByRole("spinbutton", { name: "Window: pmin (bar)" })).toHaveCount(1);
  expect(await drawing(page)).toEqual(before);

  // Along an isotherm the readout, the bold values and the slice's x axis are in bar too.
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(page.locator(".phase-diagram .x-label")).toHaveText("p (bar)");
  await expect(page.locator(".readout .transitions li.stable").first()).toHaveText(/ bar$/);
  await expect(page.locator(".transition-value text").first()).toHaveText(/ bar$/);
  await page.getByRole("button", { name: "atm" }).click();
  await expect(page.locator(".readout .transitions li.stable").first()).toHaveText(/ atm$/);
  await expect(page.locator(".slice-panel svg")).toHaveAttribute("aria-label", /K$/);
});

test("the unit survives a reload and keeps the preset selected", async ({ page }) => {
  const select = page.getByRole("combobox", { name: "Substance" });
  await page.getByRole("button", { name: "atm" }).click();
  await expect(select).toHaveValue("h2o");
  // An edit elsewhere and back: the untouched pressure fields still hold their exact kPa values.
  await untickAuto(page);
  await setField(page, "Tmin", "201");
  await expect(select).toHaveValue("custom");
  await setField(page, "Tmin", "200");
  await expect(select).toHaveValue("h2o");
  // A pressure typed back in another unit matches the preset too, without conversion noise.
  await page.getByRole("button", { name: "bar", exact: true }).click();
  await setField(page, "pmax", "0.26");
  await expect(select).toHaveValue("custom");
  await setField(page, "pmax", "0.25");
  await expect(select).toHaveValue("h2o");
  await page.getByRole("button", { name: "atm" }).click();
  await page.reload();
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
  await expect(page.getByRole("button", { name: "atm" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".phase-diagram .y-label")).toHaveText("p (atm)");
  // The reload drops the H₂O link, so the page opens on CO₂, which the unit keeps selected too.
  await page.getByRole("button", { name: "kPa" }).click();
  await expect(select).toHaveValue("co2");
});

test("a value typed in bar or atm lands at the same cut as its kPa equivalent", async ({
  page,
}) => {
  const number = page.getByRole("spinbutton", { name: /Isobar pressure/ });
  await number.fill("10.1325");
  await number.press("Enter");
  const y = await page.locator(".cut-line").getAttribute("y1");
  await number.fill("1");
  await number.press("Enter");
  await page.getByRole("button", { name: "atm" }).click();
  await number.fill("0.1");
  await number.press("Enter");
  await expect(page.locator(".cut-line")).toHaveAttribute("y1", y!);
  expect(await value(page)).toBeCloseTo(0.1, 12);
  await page.getByRole("button", { name: "bar", exact: true }).click();
  await expect(number).toHaveValue("0.101");
  await number.fill("0.101325");
  await number.press("Enter");
  expect(Number(await page.locator(".cut-line").getAttribute("y1"))).toBeCloseTo(Number(y), 9);
});

test("a unit change converts a typed but unapplied pressure, and the plots stay", async ({
  page,
}) => {
  const sv = page.locator('.phase-diagram path.boundary.stable[data-pair="s-v"]');
  const before = await sv.getAttribute("d");
  // p_min above p_max fails validate, so the field keeps it unapplied.
  await untickAuto(page);
  await setField(page, "pmin", "50");
  await expect(page.locator('.validation li[data-check="window"]')).toBeVisible();
  await page.getByRole("button", { name: "bar", exact: true }).click();
  await expect(field(page, "pmin")).toHaveValue("0.5");
  await expect(field(page, "pmax")).toHaveValue("0.25");
  await expect(sv).toHaveAttribute("d", before!);
  await page.getByRole("button", { name: "kPa" }).click();
  await expect(field(page, "pmin")).toHaveValue("50");
  await expect(sv).toHaveAttribute("d", before!);
});

test("no SVG attribute holds NaN after preset, unit, exaggeration and mode changes", async ({
  page,
}) => {
  const nanAttributes = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("svg, svg *")].flatMap((el) =>
        [...el.attributes]
          .filter((a) => a.value.includes("NaN"))
          .map((a) => `${el.tagName}.${a.name}="${a.value}"`),
      ),
    );
  const exaggerate = page.getByRole("checkbox", { name: /Exaggerate s-l slope/ });
  const steps = [
    () => page.getByRole("combobox", { name: "Substance" }).selectOption("co2"),
    () => page.getByRole("button", { name: "atm" }).click(),
    () => exaggerate.check(),
    () => page.locator(".mode-toggle").click(),
    () => page.getByRole("combobox", { name: "Substance" }).selectOption("custom"),
    () => page.getByRole("button", { name: "bar", exact: true }).click(),
    () => exaggerate.uncheck(),
    () => page.locator(".mode-toggle").click(),
    () => page.getByRole("combobox", { name: "Substance" }).selectOption("h2o"),
  ];
  for (const step of steps) {
    await step();
    await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
    expect(await nanAttributes()).toEqual([]);
  }
});
