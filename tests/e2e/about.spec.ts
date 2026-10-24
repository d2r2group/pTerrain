import { expect, test, type Page } from "@playwright/test";

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
  await page.goto("./#h2o");
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

const openButton = (page: Page) => page.getByRole("button", { name: "About", exact: true });
const dialog = (page: Page) => page.getByRole("dialog", { name: "About pTerrain" });

test("the info button sits right of the p | T toggle, borderless and 44 px square", async ({
  page,
}) => {
  const toggle = (await page.locator(".mode-toggle").boundingBox())!;
  const info = (await openButton(page).boundingBox())!;
  expect(info.x).toBeGreaterThan(toggle.x + toggle.width);
  expect(Math.abs(info.y - toggle.y)).toBeLessThan(1);
  expect(info.width).toBe(44);
  expect(info.height).toBe(44);
  await expect(openButton(page)).toHaveCSS("border-top-width", "0px");
  await expect(openButton(page)).toHaveAttribute("title", /what each of its buttons is for/);
});

test("it opens a modal overlay that summarizes the app and explains each control", async ({
  page,
}) => {
  await openButton(page).click();
  await expect(dialog(page)).toBeVisible();
  expect(await dialog(page).evaluate((el) => el.matches(":modal"))).toBe(true);
  await expect(dialog(page).locator(".dialog-body > p").first()).toContainText("phase diagram");
  const names = await dialog(page).locator("dt .visually-hidden").allTextContents();
  expect(names).toEqual([
    "p | T",
    "Theme",
    "Substance menu",
    "Metastable",
    "Share",
    "kPa | bar | atm",
    "Exaggerate s-l slope",
    "Parameters",
    "Apply",
    "Import and Export",
    "Model Details",
  ]);
  // Every key holds a copy of its control, and every copy is described.
  for (const key of await dialog(page).locator(".about-key").all())
    expect(await key.evaluate((el) => el.childElementCount)).toBeGreaterThan(0);
  expect(await dialog(page).locator("dd").count()).toBe(names.length);
});

test("the copies look like the controls, show their state and do nothing", async ({ page }) => {
  await page.locator(".plot-bar select").selectOption("co2");
  await page.getByRole("button", { name: "Metastable" }).click();
  await openButton(page).click();
  const copy = (sel: string) => dialog(page).locator(`.about-key ${sel}`);
  // Styled as on the page.
  for (const sel of [".mode-toggle", ".metastable-toggle", ".share"]) {
    const [real, copied] = await Promise.all(
      [page.locator(`.layout ${sel}`), copy(sel)].map((l) =>
        l.evaluate((el) => {
          const s = getComputedStyle(el);
          return [s.height, s.borderTopWidth, s.borderRadius, s.backgroundColor];
        }),
      ),
    );
    expect(copied, sel).toEqual(real);
  }
  // The theme key shows both symbols, moon / sun.
  await expect(dialog(page).locator(".about-key .theme-toggle")).toHaveCount(2);
  await expect(dialog(page).locator(".about-slash")).toHaveText("/");
  // In the page's current state.
  expect(await copy("select").evaluate((el: HTMLSelectElement) => el.value)).toBe("co2");
  await expect(copy(".metastable-toggle")).toHaveAttribute("aria-pressed", "false");
  // Inert: neither focusable nor clickable, and hidden from screen readers.
  await expect(dialog(page).getByRole("button", { name: "Share" })).toHaveCount(0);
  await copy(".share").click({ force: true });
  await copy(".mode-toggle").click({ force: true });
  await page.keyboard.press("Escape");
  await expect(page.locator(".layout .mode-toggle")).toHaveAccessibleName("constant T");
});

for (const width of [390, 360]) {
  test(`on a ${width} px phone the copies are icon only, as on the page`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openButton(page).click();
    const copy = (sel: string) => dialog(page).locator(`.about-key ${sel}`);
    await expect(copy(".metastable-toggle .label")).toBeHidden();
    for (const sel of [".mode-toggle", ".metastable-toggle", ".share"]) {
      const [real, copied] = await Promise.all(
        [page.locator(`.layout ${sel}`), copy(sel)].map(
          async (l) => (await l.boundingBox())!.width,
        ),
      );
      expect(copied, sel).toBe(real);
    }
    // The keys keep their own boxes, where the page's rows give theirs up.
    for (const key of await dialog(page).locator(".about-key").all())
      await expect(key).toHaveCSS("display", "flex");
  });
}

test("only its body scrolls, not the dialog around it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await openButton(page).click();
  const about = page.locator(".about");
  expect(await about.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  const body = about.locator(".dialog-body");
  expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
});

test("Esc closes it and returns focus to the info button", async ({ page }) => {
  await openButton(page).click();
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  await expect(openButton(page)).toBeFocused();
});
