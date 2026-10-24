import { devices, expect, test, type Page } from "@playwright/test";

// A phone with a touch screen. The browser comes from the project, so the
// device's own browser type is not taken over.
const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices["Pixel 7"];
test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

const handle = (page: Page) => page.locator(".cut-handle");
const value = async (page: Page) => Number(await handle(page).getAttribute("aria-valuenow"));
/** A pressure as the number field shows it: three significant figures. */
const sig3 = (x: number) => String(Number(x.toPrecision(3)));

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
  await page.goto("./");
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

/**
 * Drags one finger from (x, y) by dy, in `steps` moves, through real touch events. The finger
 * holds still before it lifts: back-to-back moves read as a flick, and a tap that lands while
 * the resulting fling is still running only stops it, without a click.
 */
async function touchDrag(page: Page, x: number, y: number, dy: number, steps = 6) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", ty: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y: ty, id: 1 }],
    });
  await touch("touchStart", y);
  for (let k = 1; k <= steps; k++) await touch("touchMove", y + (dy * k) / steps);
  // Chromium takes a pointer as stopped once it has not moved for 40 ms.
  await page.waitForTimeout(100);
  await touch("touchMove", y + dy);
  await touch("touchEnd", y + dy);
  await cdp.detach();
}

test("the header fits one row, the controls sit below the plots, and nothing scrolls sideways", async ({
  page,
}) => {
  const diagram = (await page.locator(".phase-diagram svg").boundingBox())!;
  const slice = (await page.locator(".slice-panel svg").boundingBox())!;
  const controls = (await page.locator(".controls").boundingBox())!;
  expect(slice.y).toBeGreaterThanOrEqual(diagram.y + diagram.height - 0.5);
  expect(Math.abs(slice.x - diagram.x)).toBeLessThan(0.5);
  expect(controls.y).toBeGreaterThanOrEqual(slice.y + slice.height);
  // The substance panel moves below the plots with the cut slider, under it.
  const cutInput = (await page.locator(".cut-input").boundingBox())!;
  const substance = (await page.locator(".substance").boundingBox())!;
  expect(substance.y).toBeGreaterThanOrEqual(cutInput.y + cutInput.height);
  expect(substance.x + substance.width).toBeLessThanOrEqual(viewport.width);
  // The axis toggle stays above the diagram, so switching needs no scroll.
  const toggle = (await page.locator(".mode-toggle").boundingBox())!;
  expect(toggle.y + toggle.height).toBeLessThanOrEqual(diagram.y);
  // The header: the logo, the main row and the theme button on one row, inside the viewport.
  const headerItems = page.locator("header .logo, .main-row > *, header .theme-toggle");
  const boxes = await headerItems.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, center: r.top + r.height / 2 };
    }),
  );
  expect(boxes).toHaveLength(4);
  for (const b of boxes) expect(Math.abs(b.center - boxes[0]!.center)).toBeLessThan(3);
  for (let k = 1; k < boxes.length; k++)
    expect(boxes[k]!.left).toBeGreaterThan(boxes[k - 1]!.right);
  expect(boxes.at(-1)!.right).toBeLessThanOrEqual(viewport.width);
  // Above the plots, the menu, Metastable and Share on one row; the menu still at least as wide as
  // Metastable, which keeps its label.
  const metastable = page.getByRole("button", { name: "Metastable" });
  const eye = (await metastable.boundingBox())!;
  const menu = (await page.locator(".plot-bar select").boundingBox())!;
  const share = (await page.getByRole("button", { name: "Share" }).boundingBox())!;
  expect(eye.y + eye.height).toBeLessThanOrEqual(diagram.y);
  expect(Math.abs(menu.y - share.y)).toBeLessThan(1);
  expect(menu.width).toBeGreaterThanOrEqual(eye.width);
  expect(share.x + share.width).toBeLessThanOrEqual(viewport.width);
  await expect(metastable.locator(".label")).toBeVisible();
  const [scrollWidth, innerWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

test("the compact header fits one row down to 360 px; narrower, the buttons share a row under it", async ({
  page,
}) => {
  // Below 408 px the header is compact: a smaller logo and a p | T toggle 44 px wide in all,
  // since either half switches the mode.
  await page.setViewportSize({ width: 400, height: 800 });
  expect((await page.locator(".mode-toggle").boundingBox())!.width).toBe(44);
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const buttons = [".mode-toggle", ".metastable-toggle", ".plot-bar .share"];
  await page.setViewportSize({ width: 360, height: 800 });
  const centers = await page
    .locator("header .logo, .main-row > *, header .theme-toggle")
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return r.top + r.height / 2;
      }),
    );
  for (const c of centers) expect(Math.abs(c - centers[0]!)).toBeLessThan(3);
  // Metastable and Share are still right of the menu.
  const menu = await box(".plot-bar select");
  expect(Math.abs((await box(".metastable-toggle")).y - menu.y)).toBeLessThan(1);

  // Narrower: the logo, the info button and the theme button; the three buttons, evenly spread
  // over the page; the menu, as wide as the page; then the plots.
  for (const width of [359, 320, 280]) {
    await page.setViewportSize({ width, height: 800 });
    const logo = await box(".logo");
    const theme = await box("header .theme-toggle");
    const info = await box(".info-button");
    const plots = await box(".plots");
    const select = await box(".plot-bar select");
    const row = await Promise.all(buttons.map(box));
    expect(Math.abs(theme.y + theme.height / 2 - (logo.y + logo.height / 2))).toBeLessThan(3);
    expect(Math.abs(logo.x - plots.x), `${width}`).toBeLessThan(1);
    expect(Math.abs(theme.x + theme.width - (plots.x + plots.width))).toBeLessThan(1);
    // The info button stays on the top row, next to the theme button.
    expect(Math.abs(info.y - theme.y)).toBeLessThan(1);
    expect(Math.abs(info.x + info.width - theme.x)).toBeLessThan(1);
    for (const b of row) {
      expect(b.width).toBe(44);
      expect(b.y).toBeGreaterThanOrEqual(Math.max(logo.y + logo.height, theme.y + theme.height));
      expect(Math.abs(b.y - row[0]!.y)).toBeLessThan(1);
    }
    expect(Math.abs(row[0]!.x - plots.x)).toBeLessThan(1);
    expect(Math.abs(row[2]!.x + row[2]!.width - (plots.x + plots.width))).toBeLessThan(1);
    const gaps = row.slice(1).map((b, k) => b.x - row[k]!.x);
    for (const g of gaps) expect(Math.abs(g - gaps[0]!), `${width}`).toBeLessThan(1);
    expect(select.y).toBeGreaterThanOrEqual(row[0]!.y + row[0]!.height);
    expect(Math.abs(select.x - plots.x)).toBeLessThan(1);
    expect(Math.abs(select.width - plots.width)).toBeLessThan(1);
    expect(plots.y).toBeGreaterThanOrEqual(select.y + select.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
});

test("the overlays do not scroll sideways, down to 320 px", async ({ page }) => {
  // The screen-reader MathML beside each equation is clipped, but would still widen the body.
  for (const name of ["model-details", "about"]) {
    for (const width of [412, 360, 320]) {
      await page.setViewportSize({ width, height: 800 });
      const opener = name === "about" ? ".info-button" : ".model-details-button";
      await page.locator(opener).first().click();
      const body = page.locator(`.${name} .dialog-body`);
      await expect(body).toBeVisible();
      const [scroll, client] = await body.evaluate((b) => [b.scrollWidth, b.clientWidth]);
      expect(scroll, `${name} at ${width}`).toBeLessThanOrEqual(client);
      await page.keyboard.press("Escape");
    }
  }
});

test("a finger drags the cut line without scrolling the page", async ({ page }) => {
  const before = await value(page);
  const box = (await page.locator(".cut-line").boundingBox())!;
  const x = box.x + box.width / 3;
  const y = box.y + box.height / 2;
  await touchDrag(page, x, y + 10, -30);
  expect(await value(page)).toBeGreaterThan(before);
  const moved = (await page.locator(".cut-line").boundingBox())!;
  expect(moved.y + moved.height / 2).toBeCloseTo(y - 30, 0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("spinbutton", { name: /Isobar pressure/ })).toHaveValue(
    sig3(await value(page)),
  );
});

test("a tap switches the cut, and the finger then drags the isotherm", async ({ page }) => {
  const isobar = await value(page);
  // A tap can return before the browser turns it into a click, so the swap is only awaited once
  // the button shows the new mode; otherwise "not swapping" holds before the swap even starts.
  const toggle = page.locator(".mode-toggle");
  await toggle.tap();
  await expect(toggle).toHaveAccessibleName("constant p");
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(page.locator(".phase-diagram .x-label")).toHaveText("p (kPa)");

  await page.evaluate(() => window.scrollTo(0, 0));
  const before = await value(page);
  const box = (await page.locator(".cut-line").boundingBox())!;
  await touchDrag(page, box.x + box.width / 3, box.y + box.height / 2, 40);
  expect(await value(page)).toBeLessThan(before);
  await expect(page.getByRole("spinbutton", { name: /Isotherm temperature/ })).toHaveValue(
    (await value(page)).toFixed(1),
  );

  await toggle.tap();
  await expect(toggle).toHaveAccessibleName("constant T");
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(handle(page)).toHaveAttribute("aria-valuenow", String(isobar));
});
