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
  // The compact header: the logo, GitHub, the main row and the theme button on one row, inside
  // the viewport. The Metastable eye drops its label, which stays its accessible name (aria-label), and the
  // p | T toggle is 44 px wide in all, since either half switches the mode.
  const headerItems = page.locator(
    "header .logo, header .repo-link, .main-row > *, header .theme-toggle",
  );
  const boxes = await headerItems.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, centre: r.top + r.height / 2 };
    }),
  );
  expect(boxes).toHaveLength(6);
  for (const b of boxes) expect(Math.abs(b.centre - boxes[0]!.centre)).toBeLessThan(3);
  for (let k = 1; k < boxes.length; k++)
    expect(boxes[k]!.left).toBeGreaterThan(boxes[k - 1]!.right);
  expect(boxes.at(-1)!.right).toBeLessThanOrEqual(viewport.width);
  expect(toggle.width).toBe(44);
  const metastable = page.getByRole("button", { name: "Metastable" });
  expect((await metastable.boundingBox())!.width).toBe(44);
  await expect(metastable.locator(".label")).toBeHidden();
  const [scrollWidth, innerWidth] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    window.innerWidth,
  ]);
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
});

test("on a narrower phone the main row moves under the logo, and nothing scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const logo = (await page.locator(".logo").boundingBox())!;
  const row = (await page.locator(".main-row").boundingBox())!;
  expect(row.y).toBeGreaterThanOrEqual(logo.y + logo.height);
  for (const name of ["Source on GitHub", /Switch to/]) {
    const b = (await page
      .getByRole(name === "Source on GitHub" ? "link" : "button", { name })
      .boundingBox())!;
    expect(b.y).toBeLessThan(row.y);
    expect(b.x + b.width).toBeLessThanOrEqual(375);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
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
