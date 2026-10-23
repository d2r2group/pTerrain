import { devices, expect, test, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
  await page.goto("./");
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
  // The footer is measured in Lato, not in the fallback that shows until it has loaded.
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

const openButton = (page: Page) => page.getByRole("button", { name: "Model Details" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Model details" });

async function openDialog(page: Page) {
  await openButton(page).click();
  await expect(dialog(page)).toBeVisible();
}

/** Whether the page scrolls sideways. */
const scrollsSideways = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test("the footer comes after the plots and the controls column, with the links, the button and the copyright", async ({
  page,
}) => {
  const footer = page.getByRole("contentinfo");
  await expect(footer).toBeVisible();
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const bottom = Math.max(
    ...(await Promise.all([".plots", ".controls"].map(box))).map((b) => b.y + b.height),
  );
  expect((await footer.boundingBox())!.y).toBeGreaterThanOrEqual(bottom);
  const link = footer.getByRole("link", { name: "d2r2group.com" });
  await expect(link).toHaveAttribute("href", "https://d2r2group.com");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  // In the purple of the d2r2 logo (lightened in the dark theme).
  await expect(link).toHaveCSS("color", "rgb(117, 30, 215)");
  // A globe, left of the address and hidden from screen readers.
  const globe = link.locator("svg.icon");
  await expect(globe).toHaveAttribute("aria-hidden", "true");
  const globeBox = (await globe.boundingBox())!;
  const text = await link.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.lastChild!);
    return range.getBoundingClientRect().left;
  });
  expect(globeBox.x + globeBox.width).toBeLessThanOrEqual(text);
  // The source on GitHub, after the group's site, with the GitHub mark.
  const github = footer.getByRole("link", { name: "GitHub" });
  await expect(github).toHaveAttribute("href", "https://github.com/d2r2group/pTerrain");
  await expect(github).toHaveAttribute("target", "_blank");
  await expect(github).toHaveAttribute("rel", "noopener noreferrer");
  await expect(github.locator("svg.icon")).toHaveAttribute("aria-hidden", "true");
  expect((await github.boundingBox())!.x).toBeGreaterThan(globeBox.x);
  await expect(footer.getByRole("button", { name: "Model Details" })).toBeVisible();
  await expect(footer.locator(".copyright")).toHaveText("2026 © Peter Schindler");
  // The button is a full touch target.
  expect((await openButton(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

test("the button shows g(T, p) left of its label and keeps its name", async ({ page }) => {
  await expect(openButton(page)).toHaveAccessibleName("Model Details");
  const formula = openButton(page).locator(".button-math svg");
  await expect(formula).toBeVisible();
  const f = (await formula.boundingBox())!;
  // Its glyphs are drawn although the dialog that holds the rest of the math is closed.
  const drawn = (await formula.locator("g").first().boundingBox())!;
  expect(drawn.width).toBeGreaterThan(10);
  const label = await openButton(page).evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el.lastChild!);
    return range.getBoundingClientRect().left;
  });
  expect(f.x + f.width).toBeLessThanOrEqual(label);
});

test("the button opens a named modal dialog and moves focus into it", async ({ page }) => {
  await openDialog(page);
  expect(await dialog(page).evaluate((el) => el.matches(":modal"))).toBe(true);
  expect(await dialog(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await expect(dialog(page).getByRole("heading", { name: "Substance data" })).toBeVisible();
  await expect(dialog(page).getByRole("table")).toBeVisible();
});

test("Esc, the close button and a backdrop click each close it and return focus", async ({
  page,
}) => {
  const closers: [string, () => Promise<void>][] = [
    ["Esc", () => page.keyboard.press("Escape")],
    ["close button", () => dialog(page).getByRole("button", { name: "Close" }).click()],
    ["backdrop", () => page.mouse.click(4, 4)],
  ];
  for (const [name, close] of closers) {
    await openDialog(page);
    await close();
    await expect(dialog(page), name).toBeHidden();
    await expect(openButton(page), name).toBeFocused();
  }
});

test("a selection dragged from the body out onto the backdrop does not close it", async ({
  page,
}) => {
  await openDialog(page);
  const b = (await page.locator(".model-details .dialog-body p").first().boundingBox())!;
  await page.mouse.move(b.x + 10, b.y + 5);
  await page.mouse.down();
  await page.mouse.move(4, 4, { steps: 5 });
  await page.mouse.up();
  await expect(dialog(page)).toBeVisible();
});

test("the body scrolls inside the dialog while the page stays put", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  await openDialog(page);
  const body = page.locator(".model-details .dialog-body");
  const box = (await dialog(page).boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(500 * 0.9 + 1);
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  const pageScroll = await page.evaluate(() => window.scrollY);
  const b = (await body.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScroll);
  // The heading and the close button stay in view.
  await expect(dialog(page).getByRole("button", { name: "Close" })).toBeInViewport();
});

test("the dialog follows the theme", async ({ page }) => {
  const background = () => dialog(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  await openDialog(page);
  const light = await background();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await openDialog(page);
  const dark = await background();
  expect(dark).not.toBe(light);
  await expect(page.getByRole("link", { name: "d2r2group.com" })).toHaveCSS(
    "color",
    "rgb(175, 121, 236)",
  );
  expect(dark).toBe(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
});

test.describe("on a phone", () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices["Pixel 7"];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test("the footer and the dialog cause no sideways scroll", async ({ page }) => {
    const footer = page.getByRole("contentinfo");
    await footer.scrollIntoViewIfNeeded();
    // The two links and the button fit on one line.
    const button = (await openButton(page).boundingBox())!;
    for (const link of await footer.getByRole("link").all()) {
      const b = (await link.boundingBox())!;
      expect(Math.abs(b.y + b.height / 2 - (button.y + button.height / 2))).toBeLessThan(2);
    }
    expect(await scrollsSideways(page)).toBe(false);
    await openButton(page).tap();
    await expect(dialog(page)).toBeVisible();
    const box = (await dialog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16 - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 16 + 1);
    expect(await scrollsSideways(page)).toBe(false);
  });
});
