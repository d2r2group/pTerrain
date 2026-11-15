import { expect, type Page } from "@playwright/test";

/**
 * Waits until both plots have been drawn. Each plot draws first when its ResizeObserver reports a
 * size; until then its SVG is already visible, at the browser's default 300 × 150 px, with the cut
 * line not yet in place and the handle without a value.
 */
export async function plotsDrawn(page: Page): Promise<void> {
  await expect(page.locator(".phase-diagram svg")).toBeVisible();
  await expect(page.locator(".phase-diagram .cut-handle")).toHaveAttribute("aria-valuenow", /\d/);
  await expect(page.locator(".slice-panel svg[width]")).toBeAttached();
}
