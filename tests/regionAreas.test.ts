import { describe, expect, it } from "vitest";
import { boundary, PAIRS, type Point } from "../src/physics/boundaries";
import { exaggerated } from "../src/physics/exaggerate";
import { PHASES, type Params, type PlotWindow } from "../src/physics/gibbs";
import { CUSTOM, PRESETS } from "../src/physics/presets";
import { areaRing, regionAreas, signedArea } from "../src/physics/regionAreas";
import { projection, rasterPhases, toScreen, type PlotSize } from "../src/ui/geometry";
import { regionPaths, regionRings, type Px } from "../src/ui/regionPaths";
import type { Mode } from "../src/ui/state";

// The stable regions as polygons, for the figure export's vector fills.

const SIZE: PlotSize = { width: 720, height: 360 };
const MODES: readonly Mode[] = ["isobar", "isotherm"];

/** Each preset and Custom, each with and without the exaggerated s-l slope. */
const CASES: [string, Params, PlotWindow][] = [PRESETS.h2o, PRESETS.co2, CUSTOM].flatMap((p) => [
  [p.name, p.params, p.window] as [string, Params, PlotWindow],
  [`${p.name} exaggerated`, exaggerated(p.params, p.window).params, p.window] as [
    string,
    Params,
    PlotWindow,
  ],
]);

function inside([x, y]: Px, ring: readonly Px[]): boolean {
  let hit = false;
  ring.forEach(([x0, y0], k) => {
    const [x1, y1] = ring[(k + 1) % ring.length]!;
    if (y0 > y !== y1 > y && x < x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)) hit = !hit;
  });
  return hit;
}

function distanceToPolyline([x, y]: Px, line: readonly Px[]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < line.length; k++) {
    const [ax, ay] = line[k]!;
    const [bx, by] = line[k + 1]!;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

describe.each(CASES)("%s", (_, params, window) => {
  const areas = regionAreas(params, window);

  it("has the triple point as a vertex of all three regions", () => {
    expect(new Set(areas.map((a) => a.phase))).toEqual(new Set(PHASES));
    for (const phase of PHASES) {
      const rings = areas.filter((a) => a.phase === phase).map(areaRing);
      expect(rings.some((r) => r.some((q) => q.T === params.Tt && q.p === params.pt))).toBe(true);
    }
  });

  describe.each(MODES)("%s", (mode) => {
    const m = projection(mode, window, SIZE);
    const px = (q: Point): Px => toScreen(m, q.T, q.p);

    it("tiles the plot area: the areas sum to it", () => {
      const sum = areas.reduce((s, a) => s + Math.abs(signedArea(areaRing(a).map(px))), 0);
      expect(Math.abs(sum / (SIZE.width * SIZE.height) - 1)).toBeLessThan(1e-6);
    });

    it("puts each grid point clear of a boundary in exactly one region, of the raster's phase", () => {
      const [cols, rows] = [200, 100];
      const raster = rasterPhases(params, window, mode, cols, rows);
      const rings = areas.map((a) => ({ phase: a.phase, ring: areaRing(a).map(px) }));
      const lines = PAIRS.flatMap(([i, j]) => boundary(i, j, params, window))
        .filter((s) => s.stable)
        .map((s) => s.points.map(px));
      let checked = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const at: Px = [((c + 0.5) * SIZE.width) / cols, ((r + 0.5) * SIZE.height) / rows];
          if (lines.some((l) => distanceToPolyline(at, l) <= 1)) continue;
          const holding = rings.filter(({ ring }) => inside(at, ring));
          expect(holding).toHaveLength(1);
          expect(holding[0]!.phase).toBe(PHASES[raster[r * cols + c]!]);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(0.9 * cols * rows);
    });

    it("keeps each simplified ring within 0.33 px of the unsimplified one", () => {
      const simplified = regionRings(areas, mode, window, SIZE);
      areas.forEach((a, k) => {
        const ring = simplified[k]!.points;
        const closed = [...ring, ring[0]!];
        for (const q of areaRing(a)) expect(distanceToPolyline(px(q), closed)).toBeLessThan(0.33);
      });
    });

    it("shares the vertices of every edge between the regions on either side", () => {
      const rings = regionRings(areas, mode, window, SIZE);
      const onFrame = ([x, y]: Px) => x === 0 || y === 0 || x === SIZE.width || y === SIZE.height;
      rings.forEach((ring, k) => {
        for (const v of ring.points) {
          if (onFrame(v)) continue;
          const others = rings.filter((_, j) => j !== k);
          expect(others.some((o) => o.points.some((w) => w[0] === v[0] && w[1] === v[1]))).toBe(
            true,
          );
        }
      });
    });

    it("writes one path per phase present, under 10 KB of path data", () => {
      const paths = regionPaths(areas, mode, window, SIZE);
      expect(paths.map((p) => p.phase)).toEqual(
        PHASES.filter((ph) => areas.some((a) => a.phase === ph)),
      );
      const bytes = paths.reduce((n, p) => n + p.d.length, 0);
      expect(bytes).toBeLessThan(10_000);
      for (const p of paths) expect(p.d).toMatch(/^M[\d.,\- L]+Z(M[\d.,\- L]+Z)*$/);
    });
  });
});
