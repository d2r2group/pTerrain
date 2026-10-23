import { expect, test } from "@playwright/test";

test("the built page loads without errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("./");

  await expect(page).toHaveTitle("pTerrain");
  await expect(page.getByRole("heading", { level: 1 })).toHaveAccessibleName("pTerrain");
  expect(errors).toEqual([]);
});
