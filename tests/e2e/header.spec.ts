import { expect, test, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

async function open(page: Page) {
  // The tests are written for H₂O; a first visit opens on CO₂ (tested in controls.spec.ts).
  await page.goto("./#h2o");
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
}

/** The color of the region bitmap's top-left pixel, in the solid region of H₂O. */
const regionPixel = (page: Page) =>
  page
    .locator("canvas.regions")
    .evaluate((el: HTMLCanvasElement) => [...el.getContext("2d")!.getImageData(2, 2, 1, 1).data]);

const curveStroke = (page: Page) =>
  page
    .locator('.slice-panel path.curve[data-phase="s"]')
    .first()
    .evaluate((el) => getComputedStyle(el).stroke);

test("the logo is the heading, named pTerrain, and a button that snaps to the triple point", async ({
  page,
}) => {
  await open(page);
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toHaveAccessibleName("pTerrain");
  const logo = heading.getByRole("button", { name: "pTerrain" });
  await expect(logo).toHaveAccessibleDescription(
    "Snap the isobar to the triple point, p_tp = 0.612 kPa",
  );
  await expect(logo).toHaveCSS("cursor", "pointer");
  await page.getByRole("button", { name: "constant T" }).click();
  await expect(logo).toHaveAttribute(
    "title",
    "Snap the isotherm to the triple point, T_tp = 273.2 K",
  );
});

test("the main row sits right of the logo, and the substance panel beside the plots under the cut", async ({
  page,
}) => {
  await open(page);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const logo = await box(".logo");
  const mainRow = await box(".main-row");
  const plots = await box(".plots");
  const cutInput = await box(".cut-input");
  const substance = await box(".substance");
  expect(mainRow.x).toBeGreaterThanOrEqual(logo.x + logo.width);
  expect(mainRow.y).toBeLessThan(logo.y + logo.height);
  expect(plots.y).toBeGreaterThanOrEqual(
    Math.max(logo.y + logo.height, mainRow.y + mainRow.height),
  );
  // In the column right of the plots, under the cut slider.
  expect(substance.x).toBeGreaterThanOrEqual(plots.x + plots.width);
  expect(substance.x).toBeCloseTo(cutInput.x, 0);
  expect(substance.y).toBeGreaterThanOrEqual(cutInput.y + cutInput.height);
  expect(substance.y).toBeLessThan(plots.y + plots.height);
  const row = page.getByRole("group", { name: "Main controls" });
  const names = await row
    .locator(":scope > *")
    .evaluateAll((els) =>
      els.map((el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""),
    );
  expect(names).toEqual(["constant T", "About"]);
  // Every control in the row is the same height.
  const heights = await row
    .locator(":scope > *")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);
  // Every button, the halves of the axis toggle included, is at least 44 × 44 px.
  for (const button of await row.getByRole("button").all()) {
    const { width, height } = (await button.boundingBox())!;
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }
  // The parameter panel starts closed.
  await expect(page.locator(".controls .parameters")).not.toHaveAttribute("open");
  // Opened, its fields stay inside the column.
  await page.locator(".parameters summary").click();
  const form = await box(".parameters form");
  expect(form.x + form.width).toBeLessThanOrEqual(cutInput.x + cutInput.width + 0.5);
});

test("the theme button sits at the far right, borderless and 44 px square", async ({ page }) => {
  await open(page);
  await expect(page.locator("header a")).toHaveCount(0);
  const theme = page.getByRole("button", { name: /Switch to (dark|light) theme/ });
  const t = (await theme.boundingBox())!;
  const row = page.locator(".main-row");
  const first = (await row.locator(":scope > *").first().boundingBox())!;
  const last = (await row.locator(":scope > *").last().boundingBox())!;
  const header = (await page.locator("header").boundingBox())!;
  expect(t.width).toBe(44);
  expect(t.height).toBe(44);
  await expect(theme).toHaveCSS("border-top-width", "0px");
  expect(last.x + last.width).toBeLessThanOrEqual(t.x);
  expect(t.x + t.width).toBeCloseTo(header.x + header.width, 0);
  expect(Math.abs(t.y + t.height / 2 - (first.y + first.height / 2))).toBeLessThan(1);
});

test("the main row stays on the logo's line, left-aligned, on any screen wide enough for it", async ({
  page,
}) => {
  for (const width of [600, 800, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await open(page);
    const logo = (await page.locator(".logo").boundingBox())!;
    const theme = (await page.getByRole("button", { name: /Switch to/ }).boundingBox())!;
    const row = page.locator(".main-row");
    const rowBox = (await row.boundingBox())!;
    const first = (await row.locator(":scope > *").first().boundingBox())!;
    expect(
      Math.abs(rowBox.y + rowBox.height / 2 - (logo.y + logo.height / 2)),
      `${width}`,
    ).toBeLessThan(6);
    // Left-aligned: the row starts one gap (0.75rem) right of the logo, not centered.
    expect(first.x - (logo.x + logo.width), `${width}`).toBeCloseTo(12, 0);
    const last = (await row.locator(":scope > *").last().boundingBox())!;
    expect(last.x + last.width, `${width}`).toBeLessThanOrEqual(theme.x);
    // One line of buttons: every control in the row has the same center.
    const centers = await row
      .locator(":scope > *")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(centers).size, `${width}`).toBe(1);
  }
});

test("the axis toggle is one button that shows an italic p and T, named after the other mode", async ({
  page,
}) => {
  await open(page);
  const toggle = page.locator(".mode-toggle");
  await expect(toggle).toHaveRole("button");
  await expect(toggle.locator("i")).toHaveText(["p", "T"]);
  for (const i of await toggle.locator("i").all())
    await expect(i).toHaveCSS("font-style", "italic");
  // The halves are hidden from screen readers; the button's name is the mode it switches to.
  await expect(toggle.locator(":scope > span[aria-hidden=true]")).toHaveCount(2);
  await expect(toggle).toHaveAccessibleName("constant T");
  await expect(toggle.locator(".current")).toHaveText("p");
  await toggle.click();
  await expect(toggle).toHaveAccessibleName("constant p");
  await expect(toggle.locator(".current")).toHaveText("T");
  await expect(page.getByRole("button", { name: /^constant/ })).toHaveCount(1);
});

test("the Metastable button reports its state with aria-pressed", async ({ page }) => {
  await open(page);
  const button = page.getByRole("button", { name: "Metastable" });
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const eye = async () => (await button.locator("svg path").first().getAttribute("d"))!;
  const openEye = await eye();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  // The eye closes while the branches are hidden.
  expect(await eye()).not.toBe(openEye);
  await expect(page.locator(".phase-diagram")).toHaveClass(/hide-metastable/);
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/hide-metastable/);
});

test.describe("in a dark system scheme", () => {
  test.use({ colorScheme: "dark" });

  test("the theme button switches, recolors the plots and survives a reload", async ({ page }) => {
    await open(page);
    const html = page.locator("html");
    // The page is light until dark is chosen, whatever the system's scheme.
    await expect(html).not.toHaveAttribute("data-theme");
    await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
    const lightPixel = await regionPixel(page);
    const lightStroke = await curveStroke(page);

    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
    expect(await regionPixel(page)).not.toEqual(lightPixel);
    expect(await curveStroke(page)).not.toBe(lightStroke);
    const darkPixel = await regionPixel(page);

    await page.reload();
    await expect(page.locator(".phase-diagram svg")).toBeVisible();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await regionPixel(page)).toEqual(darkPixel);

    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await expect(html).toHaveAttribute("data-theme", "light");
    expect(await regionPixel(page)).toEqual(lightPixel);
    expect(await curveStroke(page)).toBe(lightStroke);
  });

  test("a theme change also repaints the other mode's regions", async ({ page }) => {
    await open(page);
    const toggle = page.locator(".mode-toggle");
    const swapTo = async (label: string) => {
      await toggle.click();
      await expect(toggle).toHaveAccessibleName(label);
      await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
    };
    await swapTo("constant p");
    const lightPixel = await regionPixel(page);
    await swapTo("constant T");
    await page.getByRole("button", { name: "Switch to dark theme" }).click();
    await swapTo("constant p");
    expect(await regionPixel(page)).not.toEqual(lightPixel);
  });
});

test("the page still works when storage is blocked", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await open(page);
  await page.getByRole("button", { name: /Switch to (dark|light) theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", /^(dark|light)$/);
});

test("all text is set in Lato, with T, p and g in italic on the axes", async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.fonts.ready);
  for (const sel of [
    "body",
    ".phase-diagram .x-axis",
    ".slice-panel .y-axis .tick text",
    "input",
  ]) {
    await expect(page.locator(sel).first()).toHaveCSS("font-family", /^Lato,/);
  }
  expect(await page.evaluate(() => document.fonts.check("italic 13px Lato"))).toBe(true);
  for (const [sel, symbols] of [
    [".phase-diagram .x-label", ["T"]],
    [".phase-diagram .y-label", ["p"]],
    [".slice-panel .y-label", ["g", "g"]],
  ] as const) {
    const label = page.locator(sel);
    await expect(label.locator(".symbol")).toHaveText([...symbols]);
    for (const symbol of await label.locator(".symbol").all()) {
      await expect(symbol).toHaveCSS("font-style", "italic");
    }
    // Units and the minus sign stay upright.
    await expect(label.locator("tspan:not(.symbol)").first()).toHaveCSS("font-style", "normal");
  }
  // g_tp: an upright, smaller subscript, set below the baseline and followed by the units on it.
  const sub = page.locator(".slice-panel .y-label .sub");
  await expect(sub).toHaveText("tp");
  await expect(sub).toHaveCSS("font-style", "normal");
  const [g, tp, units] = await page.evaluate(() =>
    // g − g, tp, (kJ/mol): the label is turned a quarter left, so "down" is to the right.
    [...document.querySelectorAll(".slice-panel .y-label tspan")].slice(2).map((span) => {
      const r = span.getBoundingClientRect();
      return { right: r.right, size: r.width };
    }),
  );
  expect(tp!.right).toBeGreaterThan(g!.right);
  expect(tp!.size).toBeLessThan(g!.size);
  expect(units!.right).toBeCloseTo(g!.right, 0);
});
