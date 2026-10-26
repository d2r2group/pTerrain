import { expect, test, type Page } from "@playwright/test";

// The draggable handle on the cut line; the controls have a range slider of their own.
const handle = (page: Page) => page.locator(".cut-handle");
const slice = (page: Page) => page.locator(".slice-panel svg");

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const seen: string[] = [];
  errors.set(page, seen);
  page.on("pageerror", (err) => seen.push(err.message));
  // The tests are written for H₂O; a first visit opens on CO₂ (tested in controls.spec.ts).
  await page.goto("./#h2o");
  await expect(slice(page).locator("path.curve").first()).toBeAttached();
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

/** Client-space geometry of the markers and guides of both panels, read in the page. */
function readGuides(page: Page) {
  return page.evaluate(() => {
    const center = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const panel = (selector: string) => {
      const root = document.querySelector(selector)!;
      return {
        svg: root.querySelector("svg")!.getBoundingClientRect().toJSON() as DOMRect,
        markers: [...root.querySelectorAll(".crossing-marker")].map((el) => ({
          ...center(el),
          pair: el.getAttribute("data-pair"),
          stable: el.classList.contains("stable"),
        })),
        guides: [...root.querySelectorAll("line.guide")].map((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, top: r.y, bottom: r.y + r.height };
        }),
      };
    };
    return { diagram: panel(".phase-diagram"), slice: panel(".slice-panel") };
  });
}

test("draws all three g curves, solid on the envelope and dashed above it", async ({ page }) => {
  for (const mode of ["constant p", "constant T"] as const) {
    await setMode(page, mode);
    for (const phase of ["s", "l", "v"]) {
      await expect(slice(page).locator(`path.curve[data-phase="${phase}"]`).first()).toBeAttached();
    }
    await expect(slice(page).locator("path.curve.stable").first()).toBeAttached();
    await expect(slice(page).locator("path.curve.metastable").first()).toBeAttached();
  }
});

test("the slice shares the diagram's x axis, and its guides continue the diagram's", async ({
  page,
}) => {
  for (const mode of ["constant p", "constant T"] as const) {
    await setMode(page, mode);
    // Its ticked x axis is on top, right under the diagram's x-axis label, which names both; it
    // has no label of its own.
    await expect(page.locator(".slice-panel .x-label")).toHaveCount(0);
    // The same ticks as the diagram's, whose own axis has no numbers.
    const tickXs = (sel: string) =>
      page
        .locator(`${sel} .x-axis .tick`)
        .evaluateAll((els) => els.map((el) => el.getAttribute("transform")!.split(",")[0]));
    expect(await tickXs(".slice-panel")).toEqual(await tickXs(".phase-diagram"));
    const sliceTexts = await page
      .locator(".slice-panel .x-axis .tick text")
      .evaluateAll((els) => els.map((el) => el.textContent));
    expect(sliceTexts.every((t) => t !== "")).toBe(true);
    // The axis sits on the top edge of the plot area, where the frame's right edge ends.
    const plotOrigin = await page
      .locator(".slice-panel path.frame")
      .evaluate((el) => el.parentElement!.getAttribute("transform"));
    await expect(page.locator(".slice-panel .x-axis")).toHaveAttribute("transform", plotOrigin!);
    const sliceFrame = (await page.locator(".slice-panel path.frame").boundingBox())!;
    const diagramLabel = (await page.locator(".phase-diagram .x-label").boundingBox())!;
    const firstTick = (await page
      .locator(".slice-panel .x-axis .tick text")
      .first()
      .boundingBox())!;
    expect(firstTick.y).toBeGreaterThanOrEqual(diagramLabel.y + diagramLabel.height);
    expect(firstTick.y + firstTick.height).toBeLessThanOrEqual(sliceFrame.y);
    const { diagram, slice } = await readGuides(page);
    expect(diagram.markers.length).toBeGreaterThan(1);
    expect(slice.markers).toHaveLength(diagram.markers.length);
    expect(slice.guides).toHaveLength(diagram.guides.length);
    for (const [k, d] of diagram.markers.entries()) {
      const s = slice.markers[k]!;
      expect([s.pair, s.stable]).toEqual([d.pair, d.stable]);
      expect(Math.abs(s.x - d.x)).toBeLessThan(0.5);
      // The diagram's guide runs from its marker to the bottom of its SVG, and the slice's
      // from the top of its SVG, at the same height, to its marker.
      const dg = diagram.guides[k]!;
      const sg = slice.guides[k]!;
      expect(Math.abs(dg.x - d.x)).toBeLessThan(0.5);
      expect(Math.abs(sg.x - d.x)).toBeLessThan(0.5);
      expect(dg.top).toBeCloseTo(d.y, 0);
      expect(sg.bottom).toBeCloseTo(s.y, 0);
      expect(Math.abs(dg.bottom - sg.top)).toBeLessThan(0.5);
      expect(Math.abs(sg.top - slice.svg.y)).toBeLessThan(0.5);
    }
  }
});

test("each diagram marker lies within 0.5 px of the boundary part with its flag", async ({
  page,
}) => {
  for (const mode of ["constant p", "constant T"] as const) {
    await setMode(page, mode);
    const distances = await page.evaluate(() =>
      [...document.querySelectorAll(".phase-diagram .crossing-marker")].map((marker) => {
        const cx = Number(marker.getAttribute("cx"));
        const cy = Number(marker.getAttribute("cy"));
        const kind = marker.classList.contains("stable") ? "stable" : "metastable";
        const pair = marker.getAttribute("data-pair");
        const paths = document.querySelectorAll<SVGPathElement>(
          `.phase-diagram path.boundary.${kind}[data-pair="${pair}"]`,
        );
        // The paths are straight-line polylines "Mx,yLx,y…" in the same plot coordinates.
        let best = Infinity;
        for (const path of paths) {
          const pts = (path.getAttribute("d") ?? "")
            .slice(1)
            .split("L")
            .map((s) => s.split(",").map(Number) as [number, number]);
          for (let k = 0; k + 1 < pts.length; k++) {
            const [ax, ay] = pts[k]!;
            const [bx, by] = pts[k + 1]!;
            const dx = bx - ax;
            const dy = by - ay;
            const len2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / len2));
            best = Math.min(best, Math.hypot(cx - ax - t * dx, cy - ay - t * dy));
          }
        }
        return best;
      }),
    );
    expect(distances.length).toBeGreaterThan(1);
    for (const d of distances) expect(d).toBeLessThan(0.5);
  }
});

test("the slice follows the cut, and each mode returns to its last slice", async ({ page }) => {
  await expect(slice(page)).toHaveAttribute("aria-label", /^g\(T\) along the isobar at /);
  await handle(page).focus();
  await page.keyboard.press("PageUp");
  const isobar = await slice(page).getAttribute("aria-label");
  const curves = await slice(page).locator("path.curve").first().getAttribute("d");

  await setMode(page, "constant T");
  await expect(slice(page)).toHaveAttribute("aria-label", /^g\(p\) along the isotherm at /);
  await handle(page).focus();
  await page.keyboard.press("PageDown");
  const isotherm = await slice(page).getAttribute("aria-label");

  await setMode(page, "constant p");
  await expect(slice(page)).toHaveAttribute("aria-label", isobar!);
  expect(await slice(page).locator("path.curve").first().getAttribute("d")).toBe(curves);
  await setMode(page, "constant T");
  await expect(slice(page)).toHaveAttribute("aria-label", isotherm!);
});

/** The g axis's px per kJ/mol, and how far the highest stable crossing sits from the middle. */
function readGAxis(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector(".slice-panel")!;
    const ticks = [...root.querySelectorAll(".y-axis .tick")].map((el) => ({
      G: Number(el.textContent!.replace("−", "-")),
      y: el.getBoundingClientRect().y,
    }));
    const [a, b] = [ticks[0]!, ticks.at(-1)!];
    const frame = root.querySelector("path.frame")!.getBoundingClientRect();
    const stable = [...root.querySelectorAll(".crossing-marker.stable")].map((el) => {
      const r = el.getBoundingClientRect();
      return r.y + r.height / 2;
    });
    return {
      scale: (a.y - b.y) / (b.G - a.G),
      // The highest stable crossing has the smallest y on screen.
      offset: Math.min(...stable) - (frame.y + frame.height / 2),
      zeroY: ticks.find((t) => t.G === 0)?.y ?? null,
    };
  });
}

test("the g axis keeps its scale and follows the cut, the highest stable crossing halfway up", async ({
  page,
}) => {
  for (const mode of ["constant p", "constant T"] as const) {
    await setMode(page, mode);
    const before = await readGAxis(page);
    expect(Math.abs(before.offset)).toBeLessThan(0.5);
    const curve = slice(page).locator('path.curve[data-phase="v"]').first();
    const d = await curve.getAttribute("d");

    const box = (await page.locator(".cut-line").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 4 });
    await page.mouse.up();

    await expect(curve).not.toHaveAttribute("d", d!);
    // However fast the drag, the axis follows at once while the same crossing is centered.
    const after = await readGAxis(page);
    expect(Math.abs(after.offset)).toBeLessThan(0.5);
    expect(after.scale).toBeCloseTo(before.scale, 3);
    // The axis moved under the curves: 0 is at another height (or off the panel).
    expect(after.zeroY).not.toBe(before.zeroY);
  }
});

test("the g axis glides, not jumps, where the highest stable crossing leaves the window", async ({
  page,
}) => {
  // On Custom's isotherms the s-l crossing leaves through p_max at 318.07 K, and the axis then
  // centers the l-v crossing instead, about 20 px lower.
  await page.getByRole("combobox", { name: "Substance" }).selectOption("custom");
  await setMode(page, "constant T");
  const field = page.getByRole("spinbutton", { name: /Isotherm temperature/ });
  const marker = '.slice-panel .crossing-marker.stable[data-pair="l-v"]';
  /** The l-v marker's height on every frame, from typing T until 600 ms after it. */
  const track = async (T: string) => {
    await page.evaluate((sel) => {
      const seen: number[] = [];
      (window as unknown as { seen: number[] }).seen = seen;
      const start = performance.now();
      const frame = () => {
        seen.push(Number(document.querySelector(sel)!.getAttribute("cy")));
        if (performance.now() - start < 600) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, marker);
    await field.fill(T);
    await field.press("Enter");
    await page.waitForTimeout(700);
    const seen = await page.evaluate(() => (window as unknown as { seen: number[] }).seen);
    const steps = seen.slice(1).map((y, k) => Math.abs(y - seen[k]!));
    return { total: Math.abs(seen.at(-1)! - seen[0]!), largest: Math.max(...steps) };
  };

  for (const [motion, T] of [
    ["no-preference", "318.5"],
    ["reduce", "317.6"],
  ] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    await field.fill(motion === "reduce" ? "318.5" : "317.6");
    await field.press("Enter");
    await page.waitForTimeout(400);
    const { total, largest } = await track(T);
    expect(total, motion).toBeGreaterThan(10);
    if (motion === "reduce") expect(largest).toBeCloseTo(total, 0);
    else expect(largest).toBeLessThan(0.5 * total);
  }
  // Settled: the highest stable crossing is halfway up again.
  expect(Math.abs((await readGAxis(page)).offset)).toBeLessThan(0.5);
});

test("the two plot areas are the same size, each framed on the sides without an axis", async ({
  page,
}) => {
  const diagram = (await page.locator(".phase-diagram path.frame").boundingBox())!;
  const panel = (await page.locator(".slice-panel path.frame").boundingBox())!;
  expect(diagram.height).toBe(panel.height);
  expect(diagram.width).toBe(panel.width);
  expect(diagram.x).toBe(panel.x);
  // Each frame is two edges with no ticks: top and right on the diagram, whose x axis is at the
  // bottom; bottom and right on the slice, whose x axis is on top.
  const d = (sel: string) => page.locator(`${sel} path.frame`).getAttribute("d");
  expect(await d(".phase-diagram")).toMatch(/^M0,0H\d+V\d+$/);
  expect(await d(".slice-panel")).toMatch(/^M0,\d+H\d+V0$/);
});

test("the panel is shaded under the envelope in the stable phase's color", async ({ page }) => {
  for (const mode of ["constant p", "constant T"] as const) {
    await setMode(page, mode);
    const read = () =>
      page.evaluate(() => {
        const root = document.querySelector(".slice-panel")!;
        const box = (el: Element) => el.getBoundingClientRect();
        const style = getComputedStyle(root);
        const color: Record<string, string> = {
          s: style.getPropertyValue("--phase-solid").trim(),
          l: style.getPropertyValue("--phase-liquid").trim(),
          v: style.getPropertyValue("--phase-vapor").trim(),
        };
        const hex = (rgb: string) =>
          "#" +
          rgb
            .match(/\d+/g)!
            .slice(0, 3)
            .map((n) => Number(n).toString(16).padStart(2, "0"))
            .join("");
        const plot = box(root.querySelector("path.frame")!);
        return {
          plot: { left: plot.x, right: plot.x + plot.width },
          shades: [...root.querySelectorAll("path.shade")].map((el) => ({
            phase: el.getAttribute("data-phase")!,
            left: box(el).x,
            right: box(el).x + box(el).width,
            fill: hex(getComputedStyle(el).fill) === color[el.getAttribute("data-phase")!],
            shown: getComputedStyle(el).display !== "none",
          })),
          stable: [...root.querySelectorAll(".crossing-marker.stable")].map(
            (el) => box(el).x + box(el).width / 2,
          ),
          envelope: [...root.querySelectorAll("path.curve.stable")]
            .map((el) => ({ phase: el.getAttribute("data-phase")!, x: box(el).x }))
            .sort((a, b) => a.x - b.x)
            .map((c) => c.phase),
        };
      });
    const { plot, shades, stable, envelope } = await read();
    shades.sort((a, b) => a.left - b.left);
    expect(shades.map((s) => s.phase)).toEqual(envelope);
    expect(shades.every((s) => s.fill && s.shown)).toBe(true);
    // The strip spans the cut, and changes color exactly at the stable crossings.
    expect(Math.abs(shades[0]!.left - plot.left)).toBeLessThan(0.5);
    expect(Math.abs(shades.at(-1)!.right - plot.right)).toBeLessThan(1);
    for (let k = 1; k < shades.length; k++) {
      expect(Math.abs(shades[k]!.left - shades[k - 1]!.right)).toBeLessThan(0.5);
      expect(stable.some((x) => Math.abs(x - shades[k]!.left) < 0.5)).toBe(true);
    }

    // Hiding the metastable branches leaves the shading as it is.
    await page.getByRole("button", { name: "Metastable" }).click();
    const hidden = (await read()).shades.sort((a, b) => a.left - b.left);
    expect(hidden).toEqual(shades);
    await page.getByRole("button", { name: "Metastable" }).click();
  }
});

test("a band along the bottom edge shows the stable phase, also where its curve is off the panel", async ({
  page,
}) => {
  // On the CO₂ isobar at 100 kPa the vapor's curve leaves the bottom of the panel near 230 K.
  await page.goto("./#co2;p,100");
  await expect(slice(page)).toHaveAttribute("aria-label", /isobar at 100/);
  const { plot, band, stable } = await page.evaluate(() => {
    const root = document.querySelector(".slice-panel")!;
    const box = (el: Element) => el.getBoundingClientRect();
    const style = getComputedStyle(root);
    const curve = (phase: string) =>
      style.getPropertyValue(`--curve-${{ s: "solid", l: "liquid", v: "vapor" }[phase]}`).trim();
    const hex = (rgb: string) =>
      "#" +
      rgb
        .match(/\d+/g)!
        .slice(0, 3)
        .map((n) => Number(n).toString(16).padStart(2, "0"))
        .join("");
    const frame = box(root.querySelector("path.frame")!);
    return {
      plot: { left: frame.x, right: frame.x + frame.width, bottom: frame.y + frame.height },
      band: [...root.querySelectorAll(".stable-band rect")]
        .map((el) => ({
          phase: el.getAttribute("data-phase")!,
          left: box(el).x,
          right: box(el).x + box(el).width,
          bottom: box(el).y + box(el).height,
          height: box(el).height,
          colored: hex(getComputedStyle(el).fill) === curve(el.getAttribute("data-phase")!),
        }))
        .sort((a, b) => a.left - b.left),
      stable: [...root.querySelectorAll(".crossing-marker.stable")].map(
        (el) => box(el).x + box(el).width / 2,
      ),
    };
  });
  expect(band.map((b) => b.phase)).toEqual(["s", "v"]);
  for (const b of band) {
    expect(b.colored).toBe(true);
    expect(Math.abs(b.bottom - plot.bottom)).toBeLessThan(0.5);
    expect(b.height).toBeCloseTo(4, 0);
  }
  // It spans the whole cut, the vapor's run included, and changes color at the stable crossing.
  expect(Math.abs(band[0]!.left - plot.left)).toBeLessThan(0.5);
  expect(Math.abs(band[1]!.right - plot.right)).toBeLessThan(1);
  expect(Math.abs(band[1]!.left - band[0]!.right)).toBeLessThan(0.5);
  expect(stable.some((x) => Math.abs(x - band[1]!.left) < 0.5)).toBe(true);
});

test("both y-axis labels sit on one vertical line, 4 px left of the widest tick label", async ({
  page,
}) => {
  const read = () =>
    page.evaluate(() =>
      [".phase-diagram", ".slice-panel"].map((panel) => {
        const label = document.querySelector(`${panel} .y-label`)!.getBoundingClientRect();
        const ticks = [...document.querySelectorAll(`${panel} .y-axis .tick text`)];
        return {
          left: label.left,
          right: label.right,
          ticks: Math.min(...ticks.map((t) => t.getBoundingClientRect().left)),
        };
      }),
    );
  const check = async () => {
    const [diagram, slicePanel] = await read();
    expect(Math.abs(diagram!.left - slicePanel!.left)).toBeLessThan(0.5);
    // Measured from the label that reaches closest to the ticks: the slice's, with g_tp's
    // lowered subscript.
    const gap =
      Math.min(diagram!.ticks, slicePanel!.ticks) - Math.max(diagram!.right, slicePanel!.right);
    expect(gap).toBeGreaterThan(3);
    expect(gap).toBeLessThan(5);
  };
  await check();
  await setMode(page, "constant T");
  await check();
  // Wider tick labels on the diagram ("0.001") move both labels left.
  await setMode(page, "constant p");
  const before = (await read())[1]!.left;
  await page.getByRole("button", { name: "bar", exact: true }).click();
  await expect(page.locator(".phase-diagram .y-label")).toHaveText("p (bar)");
  await check();
  expect((await read())[1]!.left).toBeLessThan(before - 5);
});

test("no axis has outer ticks: its line is one straight segment", async ({ page }) => {
  const lines = page.locator(".phase-diagram .axis .domain, .slice-panel .axis .domain");
  await expect(lines).toHaveCount(4);
  for (const d of await lines.evaluateAll((els) => els.map((el) => el.getAttribute("d") ?? "")))
    expect(d).toMatch(/^M[^A-Z]+[HV][^A-Z]+$/);
});
