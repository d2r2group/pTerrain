import { readFile } from "node:fs/promises";
import { devices, expect, test, type Page } from "@playwright/test";

// The substance name, the JSON file and the share link.

const handle = (page: Page) => page.locator(".cut-handle");
const value = async (page: Page) => Number(await handle(page).getAttribute("aria-valuenow"));
const field = (page: Page, name: string) => page.locator(`.parameters input[name="${name}"]`);
const nameField = (page: Page) => page.getByRole("textbox", { name: "Substance name" });
const select = (page: Page) => page.getByRole("combobox", { name: "Substance" });
const selected = (page: Page) => select(page).locator("option:checked");
const applyButton = (page: Page) => page.getByRole("button", { name: "Apply" });
const autoBox = (page: Page) => page.getByRole("checkbox", { name: "Automatic window" });
const alert = (page: Page) => page.locator(".validation");
const picker = (page: Page) => page.locator('.parameters input[type="file"]');
const slLine = (page: Page) => page.locator('.phase-diagram path.boundary.stable[data-pair="s-l"]');

const errors = new WeakMap<Page, string[]>();

/** Opens the page at `hash` (by default the H₂O link, as the tests are written for H₂O) and the
 * Parameters panel. */
async function open(page: Page, hash = "#h2o") {
  const seen = errors.get(page) ?? [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
  await page.goto(`./${hash}`);
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
  await page.locator(".parameters summary").click();
}

test.afterEach(({ page }) => {
  expect(errors.get(page) ?? []).toEqual([]);
});

/** Imports `text` as a file through the hidden picker. */
async function importText(page: Page, text: string, name = "substance.json") {
  await picker(page).setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
}

/** Exports the applied substance and returns the download's name and text. */
async function exportFile(page: Page) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  return {
    name: download.suggestedFilename(),
    text: await readFile((await download.path())!, "utf8"),
  };
}

/** Applies a Custom substance named "My substance" with a typed window. */
async function applyCustom(page: Page) {
  await select(page).selectOption("custom");
  await autoBox(page).uncheck();
  await field(page, "Vl").fill("3");
  await field(page, "pmax").fill("120");
  await nameField(page).fill("My substance");
  await applyButton(page).click();
  await expect(alert(page)).toBeEmpty();
  await expect(selected(page)).toHaveText("My substance");
}

/** Records what Share copies, with `navigator.share` taken away. */
async function stubClipboard(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { copied: string[] };
    w.copied = [];
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void w.copied.push(text) },
    });
  });
}
/** Replaces the clipboard on the open page, so that Share copies without permission. */
async function stubClipboardNow(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async () => {} } });
  });
}
const copied = (page: Page) =>
  page.evaluate(() => (window as unknown as { copied: string[] }).copied);

test("the name field shows the substance opened and follows the menu", async ({ page }) => {
  await open(page);
  await expect(nameField(page)).toHaveValue("H₂O");
  await expect(nameField(page)).toHaveAttribute("maxlength", "40");
  await select(page).selectOption("co2");
  await expect(nameField(page)).toHaveValue("CO₂");
  await select(page).selectOption("custom");
  await expect(nameField(page)).toHaveValue("Custom");
  // Under Apply and its buttons, and above the Triple point fieldset, as wide as both.
  const exportBox = (await page.getByRole("button", { name: "Export" }).boundingBox())!;
  const row = (await page.locator(".parameters .name-row").boundingBox())!;
  const set = (await page.locator(".parameters fieldset").first().boundingBox())!;
  expect(exportBox.y + exportBox.height).toBeLessThanOrEqual(row.y);
  expect(row.y + row.height).toBeLessThanOrEqual(set.y);
  expect(Math.abs(row.width - set.width)).toBeLessThan(1);
});

test("a typed name enables Apply and changes nothing until Apply", async ({ page }) => {
  await open(page);
  await nameField(page).fill("Water");
  await expect(applyButton(page)).toBeEnabled();
  await expect(selected(page)).toHaveText("H₂O");
  await applyButton(page).click();
  // The name does not change the physics: H₂O's parameters keep H₂O selected.
  await expect(select(page)).toHaveValue("h2o");
  await expect(selected(page)).toHaveText("H₂O");
  await expect(applyButton(page)).toBeDisabled();
  await expect(nameField(page)).toHaveValue("Water");

  // On a custom substance the Custom option reads the name, trimmed.
  await field(page, "Vs").fill("0.0195");
  await nameField(page).fill("  Ice Ih  ");
  await nameField(page).press("Enter");
  await expect(select(page)).toHaveValue("custom");
  await expect(selected(page)).toHaveText("Ice Ih");
  await expect(nameField(page)).toHaveValue("Ice Ih");
  // An empty name applies as Custom.
  await nameField(page).fill("");
  await applyButton(page).click();
  await expect(nameField(page)).toHaveValue("Custom");
  await expect(selected(page)).toHaveText("Custom");
  // The menu discards a typed name, and its Custom option reads Custom again after a preset.
  await nameField(page).fill("Unapplied");
  await select(page).selectOption("co2");
  await expect(nameField(page)).toHaveValue("CO₂");
  await expect(select(page).locator('option[value="custom"]')).toHaveText("Custom");
});

test("Export downloads H2O.json, which parses back to H₂O", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "bar", exact: true }).click();
  // An unapplied edit is not exported.
  await field(page, "Vs").fill("0.03");
  const { name, text } = await exportFile(page);
  expect(name).toBe("H2O.json");
  const file = JSON.parse(text);
  expect(file).toMatchObject({
    format: "pterrain-substance",
    version: 1,
    name: "H₂O",
    autoWindow: true,
    window: { Tmin: 200, Tmax: 345, pmin: 0.015, pmax: 25 },
  });
  // In the model's units, whatever unit is shown.
  expect(file.params).toEqual({
    Tt: 273.16,
    pt: 0.611654,
    dHfus: 6.007,
    dHvap: 45.055,
    Ss: 41.34,
    Vs: 0.019652,
    Vl: 0.018019,
    cp: { s: 37.77, l: 76.02, v: 33.95 },
  });
});

test("an exported Custom file, imported after a reload, restores the substance and resets the cuts", async ({
  page,
}) => {
  await open(page);
  await applyCustom(page);
  const diagram = await slLine(page).getAttribute("d");
  const { name, text } = await exportFile(page);
  expect(name).toBe("My_substance.json");

  await page.reload();
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
  await page.locator(".parameters summary").click();
  await handle(page).focus();
  await page.keyboard.press("PageUp");
  await page.getByRole("button", { name: "atm" }).click();
  await importText(page, text, name);
  await expect(alert(page)).toBeEmpty();
  await expect(nameField(page)).toHaveValue("My substance");
  await expect(select(page)).toHaveValue("custom");
  await expect(selected(page)).toHaveText("My substance");
  await expect(autoBox(page)).not.toBeChecked();
  await expect(field(page, "Vl")).toHaveValue("3");
  // Pressures in the shown unit.
  await expect(field(page, "pmax")).toHaveValue(String(Number((120 / 101.325).toPrecision(12))));
  await expect(slLine(page)).toHaveAttribute("d", diagram!);
  await expect(applyButton(page)).toBeDisabled();
  // The default isobar, halfway between p_tp and p_max on the log axis, in atm.
  expect(await value(page)).toBeCloseTo(Math.sqrt(50 * 120) / 101.325, 9);
  // The same file again imports it again.
  await select(page).selectOption("h2o");
  await importText(page, text, name);
  await expect(nameField(page)).toHaveValue("My substance");
});

test("an imported file that fails validate shows the issues and keeps the plots", async ({
  page,
}) => {
  await open(page);
  const { text } = await exportFile(page);
  const file = JSON.parse(text);
  file.name = "Bad";
  file.params.dHfus = -1;
  const before = await slLine(page).getAttribute("d");
  await importText(page, JSON.stringify(file));
  await expect(alert(page).locator('li[data-check="dHfus"]')).toBeVisible();
  await expect(slLine(page)).toHaveAttribute("d", before!);
  await expect(field(page, "dHfus")).toHaveValue("-1");
  await expect(nameField(page)).toHaveValue("Bad");
  await expect(applyButton(page)).toBeEnabled();
});

test("a malformed file shows a one-line warning and changes nothing", async ({ page }) => {
  await open(page);
  await field(page, "Vs").fill("0.03");
  for (const [text, problem] of [
    ["not json", "it is not JSON"],
    ['{"format": "other"}', 'its format is not "pterrain-substance"'],
  ] as const) {
    await importText(page, text);
    await expect(alert(page)).toHaveText(`Not a pTerrain substance file: ${problem}.`);
  }
  await expect(field(page, "Vs")).toHaveValue("0.03");
  await expect(nameField(page)).toHaveValue("H₂O");
  await expect(select(page)).toHaveValue("h2o");
});

test("opening #h2o;T,250 sets H₂O, the isotherm and 250 K, and clears the fragment", async ({
  page,
}) => {
  await open(page, "#h2o;T,250");
  await expect(handle(page)).toHaveAccessibleName("Isotherm line, T* (K)");
  expect(await value(page)).toBe(250);
  await expect(select(page)).toHaveValue("h2o");
  await expect(nameField(page)).toHaveValue("H₂O");
  expect(new URL(page.url()).hash).toBe("");
  await expect(alert(page)).toBeEmpty();
  // A cut outside the limits is clamped; H₂O's isotherms reach from 234.5 K.
  await page.evaluate(() => (location.hash = "#co2;T,1"));
  await expect(select(page)).toHaveValue("co2");
  expect(await value(page)).toBeGreaterThan(160);
});

test("a link to a Custom substance with a typed window restores it", async ({ page }) => {
  await stubClipboard(page);
  await open(page);
  await applyCustom(page);
  await page.getByRole("button", { name: "constant T" }).click();
  await page.getByRole("spinbutton", { name: /Isotherm temperature/ }).fill("290");
  await page.getByRole("spinbutton", { name: /Isotherm temperature/ }).press("Enter");
  await expect(page.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  const diagram = await slLine(page).getAttribute("d");
  await page.getByRole("button", { name: "Share" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const [link] = await copied(page);
  expect(link).toMatch(/#1,My%20substance,300,50,2.49,12.5,33.3,2,3,0,0,0,220,380,15,120;T,290$/);
  await expect(page.getByRole("button", { name: "Share" })).toBeVisible({ timeout: 3000 });

  // The copied link opens the same view in a new page.
  const other = await page.context().newPage();
  await open(other, new URL(link!).hash);
  await expect(nameField(other)).toHaveValue("My substance");
  await expect(selected(other)).toHaveText("My substance");
  await expect(autoBox(other)).not.toBeChecked();
  await expect(field(other, "Tmin")).toBeEnabled();
  await expect(field(other, "pmax")).toHaveValue("120");
  await expect(handle(other)).toHaveAccessibleName("Isotherm line, T* (K)");
  expect(await value(other)).toBe(290);
  await expect(other.locator(".phase-diagram")).not.toHaveClass(/swapping/);
  await expect(slLine(other)).toHaveAttribute("d", diagram!);
  expect(errors.get(other) ?? []).toEqual([]);
});

test("a link pasted into an open tab applies through hashchange", async ({ page }) => {
  await open(page);
  await page.evaluate(() => (location.hash = "#1,Pasted,300,50,2.49,12.5,33.3,2,3.5,0,0,0;p,30"));
  await expect(nameField(page)).toHaveValue("Pasted");
  await expect(autoBox(page)).toBeChecked();
  await expect(field(page, "pmax")).toHaveValue("150");
  expect(await value(page)).toBe(30);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  // The same link pasted again applies again.
  await field(page, "Vl").fill("3");
  await applyButton(page).click();
  await page.evaluate(() => (location.hash = "#1,Pasted,300,50,2.49,12.5,33.3,2,3.5,0,0,0;p,30"));
  await expect(field(page, "Vl")).toHaveValue("3.5");
});

test("a malformed link warns and leaves the default substance", async ({ page }) => {
  await open(page, "#2,x,1");
  await expect(alert(page)).toHaveText("Not a pTerrain link: version 2 is not supported.");
  await expect(select(page)).toHaveValue("co2");
  await expect(nameField(page)).toHaveValue("CO₂");
  expect(new URL(page.url()).hash).toBe("");
  // A link whose substance fails `validate` lists the issues.
  await page.evaluate(() => (location.hash = "#1,Bad,300,50,-1,12.5,33.3,2,3.5,0,0,0"));
  await expect(alert(page).locator('li[data-check="dHfus"]')).toBeVisible();
  await expect(select(page)).toHaveValue("custom");
  await expect(selected(page)).toHaveText("Custom");
  await expect(nameField(page)).toHaveValue("Bad");
});

test("a link that can be neither shared nor copied is shown selected", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", { value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await open(page);
  await page.getByRole("button", { name: "Share" }).click();
  const link = page.getByRole("textbox", { name: "Share link" });
  await expect(link).toHaveValue(/#h2o;p,3\.91$/);
  await expect(link).toHaveAttribute("readonly");
  await expect(link).toBeFocused();
  expect(await link.evaluate((el: HTMLInputElement) => el.selectionEnd! - el.selectionStart!)).toBe(
    (await link.inputValue()).length,
  );
});

test("Import and Export sit under Apply, as wide as it, and hide with the panel", async ({
  page,
}) => {
  await open(page);
  const buttons = ["Import", "Export"].map((name) => page.getByRole("button", { name }));
  const boxes = await Promise.all(buttons.map(async (b) => (await b.boundingBox())!));
  const apply = (await applyButton(page).boundingBox())!;
  const name = (await page.locator(".parameters .name-row").boundingBox())!;
  for (const box of boxes) {
    expect(box.y).toBeGreaterThanOrEqual(apply.y + apply.height);
    expect(box.y + box.height).toBeLessThanOrEqual(name.y);
    expect(Math.abs(box.y - boxes[0]!.y)).toBeLessThan(1);
    expect(Math.abs(box.height - apply.height)).toBeLessThan(1);
  }
  expect(Math.abs(boxes[0]!.x - apply.x)).toBeLessThan(1);
  expect(Math.abs(boxes[1]!.x + boxes[1]!.width - (apply.x + apply.width))).toBeLessThan(1);
  // Each has an icon, hidden from screen readers, and is named by its text alone; Apply has none.
  for (const button of buttons) {
    await expect(button.locator('svg.icon[aria-hidden="true"]')).toHaveCount(1);
  }
  await expect(applyButton(page).locator("svg")).toHaveCount(0);
  await page.locator(".parameters summary").click();
  for (const button of buttons) await expect(button).toBeHidden();
});

test("the menu and Share sit above the plots, as wide as them, with Share at the right", async ({
  page,
}) => {
  await open(page);
  await page.locator(".parameters summary").click();
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!;
  const share = page.getByRole("button", { name: "Share" });
  await expect(share).toBeVisible();
  await expect(share.locator('svg.icon[aria-hidden="true"]')).toHaveCount(1);
  const bar = await box(".plot-bar");
  const plots = await box(".plots");
  const diagram = await box(".phase-diagram");
  const shareBox = (await share.boundingBox())!;
  const menu = (await select(page).boundingBox())!;
  expect(Math.abs(bar.x - plots.x)).toBeLessThan(1);
  expect(Math.abs(bar.width - plots.width)).toBeLessThan(1);
  expect(bar.y + bar.height).toBeLessThanOrEqual(diagram.y);
  expect(Math.abs(menu.x - bar.x)).toBeLessThan(1);
  // The menu fills the bar up to Metastable, then Share, each 0.5rem apart.
  const eyeButton = page.getByRole("button", { name: "Metastable" });
  const eyeBox = (await eyeButton.boundingBox())!;
  expect(Math.abs(eyeBox.x - (menu.x + menu.width) - 8)).toBeLessThan(1);
  expect(Math.abs(shareBox.x - (eyeBox.x + eyeBox.width) - 8)).toBeLessThan(1);
  expect(Math.abs(shareBox.x + shareBox.width - (bar.x + bar.width))).toBeLessThan(1);
  // No "Substance" text beside the menu, which keeps it as its name.
  await expect(page.locator(".plot-bar")).not.toContainText("Substance");
  // Copied keeps the width.
  await stubClipboardNow(page);
  await share.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect((await page.locator(".plot-bar .share").boundingBox())!.width).toBeCloseTo(
    shareBox.width,
    0,
  );
  // Both keep their labels until the header compacts, below 23.5rem (376 px) of page width,
  // 408 px of window. Then Share shows the icon alone, still named Share, and Metastable the eye
  // alone, both 44 px square, as the logo shrinks.
  await expect(share).toBeVisible({ timeout: 3000 });
  const label = page.locator(".metastable-toggle .label");
  const logoHeight = async () => (await page.locator("header .logo svg").boundingBox())!.height;
  await page.setViewportSize({ width: 409, height: 700 });
  await expect(label).toBeVisible();
  expect((await share.boundingBox())!.width).toBeCloseTo(shareBox.width, 0);
  expect(await logoHeight()).toBeCloseTo(36, 0);
  await page.setViewportSize({ width: 408, height: 700 });
  await expect(label).toBeHidden();
  expect(await logoHeight()).toBeCloseTo(24, 0);
  for (const button of [share, eyeButton]) {
    const { width, height } = (await button.boundingBox())!;
    expect(width).toBeCloseTo(44, 0);
    expect(height).toBeCloseTo(44, 0);
  }
  // A classic scrollbar narrows the page, not the window; 15 px of padding stand in for one, as
  // headless Chromium's scrollbars overlay the page. At 420 px both are compact already.
  await page.addStyleTag({ content: "body { padding-right: calc(1rem + 15px) }" });
  await page.setViewportSize({ width: 420, height: 700 });
  await expect(label).toBeHidden();
  expect((await share.boundingBox())!.width).toBeCloseTo(44, 0);
});

test.describe("on a phone", () => {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices["Pixel 7"];
  test.use({ viewport, deviceScaleFactor, isMobile, hasTouch, userAgent });

  test("Share opens the share sheet with the link and the name", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shared: ShareData[] };
      w.shared = [];
      Object.defineProperty(navigator, "share", {
        value: async (data: ShareData) => void w.shared.push(data),
      });
    });
    await open(page);
    await page.getByRole("button", { name: "Share" }).click();
    const shared = () => page.evaluate(() => (window as unknown as { shared: ShareData[] }).shared);
    await expect.poll(shared).toHaveLength(1);
    const [data] = await shared();
    expect(data!.title).toBe("H₂O");
    expect(data!.url).toMatch(/\/#h2o;p,3\.91$/);
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
  });
});

/** The height of the slice's g axis, kJ/mol, read from its ticks and its frame. */
function sliceRange(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".slice-panel")!;
    const ticks = [...root.querySelectorAll(".y-axis .tick")].map((el) => ({
      G: Number(el.textContent!.replace("−", "-")),
      y: el.getBoundingClientRect().y,
    }));
    const [a, b] = [ticks[0]!, ticks.at(-1)!];
    const height = root.querySelector("path.frame")!.getBoundingClientRect().height;
    return (height * (b.G - a.G)) / (a.y - b.y);
  });
}

test("the g range field is disabled with auto, empty with the fitted height as placeholder", async ({
  page,
}) => {
  await open(page);
  const gRange = field(page, "gRange");
  await expect(gRange).toBeDisabled();
  await expect(gRange).toHaveValue("");
  await expect(gRange).toHaveAccessibleName("Window: Δg (kJ/mol)");
  const fitted = Number(await gRange.getAttribute("placeholder"));
  expect(fitted).toBeCloseTo(await sliceRange(page), 1);
  // Unticked, it is enabled and still empty; Apply without a height keeps H₂O and the fit.
  await autoBox(page).uncheck();
  await expect(gRange).toBeEnabled();
  await expect(gRange).toHaveValue("");
  await applyButton(page).click();
  await expect(selected(page)).toHaveText("H₂O");
  expect(await sliceRange(page)).toBeCloseTo(fitted, 1);
  // Another substance shows its own fitted height.
  await select(page).selectOption("co2");
  await expect(gRange).not.toHaveAttribute("placeholder", String(fitted));
});

test("a typed g range sets the slice's g axis, and emptying the field fits it again", async ({
  page,
}) => {
  await open(page);
  const fitted = await sliceRange(page);
  await autoBox(page).uncheck();
  await field(page, "gRange").fill("30");
  await expect(applyButton(page)).toBeEnabled();
  // Nothing changes until Apply.
  expect(await sliceRange(page)).toBeCloseTo(fitted, 1);
  await applyButton(page).click();
  await expect(alert(page)).toBeEmpty();
  expect(await sliceRange(page)).toBeCloseTo(30, 1);
  // A typed height makes the substance custom, under its name.
  await expect(select(page)).toHaveValue("custom");
  await expect(selected(page)).toHaveText("H₂O");
  // The exaggerated s-l slope keeps it.
  await page.getByRole("checkbox", { name: /Exaggerate/ }).check();
  expect(await sliceRange(page)).toBeCloseTo(30, 1);
  await page.getByRole("checkbox", { name: /Exaggerate/ }).uncheck();

  await field(page, "gRange").fill("");
  await applyButton(page).click();
  expect(await sliceRange(page)).toBeCloseTo(fitted, 1);
  await expect(selected(page)).toHaveText("H₂O");
  await expect(select(page)).toHaveValue("h2o");
});

test("ticking auto again drops a typed g range", async ({ page }) => {
  await open(page);
  const fitted = await sliceRange(page);
  await autoBox(page).uncheck();
  await field(page, "gRange").fill("30");
  await applyButton(page).click();
  // Like the window edges, the disabled field shows what is applied until Apply fits it.
  await autoBox(page).check();
  await expect(field(page, "gRange")).toBeDisabled();
  await expect(field(page, "gRange")).toHaveValue("30");
  await applyButton(page).click();
  await expect(field(page, "gRange")).toHaveValue("");
  expect(await sliceRange(page)).toBeCloseTo(fitted, 1);
  await expect(select(page)).toHaveValue("h2o");
});

test("a g range of 0 is refused by Apply, with the field named", async ({ page }) => {
  await open(page);
  const fitted = await sliceRange(page);
  await autoBox(page).uncheck();
  await field(page, "gRange").fill("0");
  await applyButton(page).click();
  await expect(alert(page).locator('li[data-check="gRange"]')).toBeVisible();
  await expect(field(page, "gRange")).toHaveAttribute("aria-invalid");
  await expect(field(page, "Tmin")).not.toHaveAttribute("aria-invalid");
  expect(await sliceRange(page)).toBeCloseTo(fitted, 1);
});

test("a typed g range survives Export, Import and Share", async ({ page }) => {
  await stubClipboard(page);
  await open(page);
  await applyCustom(page);
  await field(page, "gRange").fill("12.5");
  await applyButton(page).click();
  await expect(alert(page)).toBeEmpty();
  expect(await sliceRange(page)).toBeCloseTo(12.5, 1);

  const { text } = await exportFile(page);
  expect(JSON.parse(text).window.gRange).toBe(12.5);
  await page.getByRole("button", { name: "Share" }).click();
  const [link] = await copied(page);
  expect(link).toMatch(/,220,380,15,120,12\.5;p,[\d.]+$/);

  // Imported after a reload.
  await page.reload();
  await page.locator(".parameters summary").click();
  await importText(page, text);
  await expect(selected(page)).toHaveText("My substance");
  await expect(field(page, "gRange")).toHaveValue("12.5");
  await expect(field(page, "gRange")).toBeEnabled();
  expect(await sliceRange(page)).toBeCloseTo(12.5, 1);

  // Opened from the link in a new page.
  const other = await page.context().newPage();
  await open(other, new URL(link!).hash);
  await expect(field(other, "gRange")).toHaveValue("12.5");
  expect(await sliceRange(other)).toBeCloseTo(12.5, 1);
  expect(errors.get(other) ?? []).toEqual([]);
});

test("the auto box leaves the Window legend as tall as the others, so the borders line up", async ({
  page,
}) => {
  // Under the plots, where the fieldsets sit side by side, Window beside Heat capacities.
  await page.setViewportSize({ width: 760, height: 1200 });
  await open(page);
  const heights = await page
    .locator(".parameters legend")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(new Set(heights).size).toBe(1);
  const top = (name: string) =>
    page
      .locator(".parameters fieldset", { has: page.locator("legend", { hasText: name }) })
      .evaluate((el) => el.getBoundingClientRect().top);
  expect(await top("Window")).toBe(await top("Heat capacities"));
});
