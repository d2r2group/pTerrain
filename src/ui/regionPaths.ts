// The figure export's region fills as SVG paths, in place of the screen's raster: each stable
// region (physics/regionAreas.ts) in plot-area px, its edges simplified by Douglas–Peucker. Each
// edge is mapped and simplified once, so the two regions along a boundary share its vertices
// exactly, and each phase is one `<path>`, so that two faces of one phase show no seam under the
// group's opacity.

import type { Point } from "../physics/boundaries";
import { PHASES, type Phase, type PlotWindow } from "../physics/gibbs";
import type { RegionArea, RegionEdge } from "../physics/regionAreas";
import { projection, toScreen, type PlotSize } from "./geometry";
import type { Mode } from "./state";

/** How far a simplified edge may stray from the boundary, CSS px. */
export const REGION_TOLERANCE = 0.25;

/** A point in plot-area px. */
export type Px = [number, number];

/** The distance from p to the segment from a to b. */
function segmentDistance([x, y]: Px, [ax, ay]: Px, [bx, by]: Px): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/**
 * `points` simplified by Douglas–Peucker: a subset of them, the ends kept, such that every point
 * lies within `tolerance` of the simplified polyline.
 */
export function simplify(points: readonly Px[], tolerance = REGION_TOLERANCE): Px[] {
  const n = points.length;
  if (n <= 2) return [...points];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let worst = -1;
    let far = 0;
    for (let k = i + 1; k < j; k++) {
      const d = segmentDistance(points[k]!, points[i]!, points[j]!);
      if (d > far) {
        far = d;
        worst = k;
      }
    }
    if (worst >= 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/** A coordinate to one decimal, as an SVG path writes it. */
const round = (v: number) => Math.round(v * 10) / 10;

/** A region in plot-area px: its phase and its ring, each edge simplified and rounded. */
export interface RegionRing {
  phase: Phase;
  points: Px[];
}

/**
 * Each area in plot-area px for a plot area of `size` over `window` in `mode`, each edge mapped,
 * simplified (`simplify`) and rounded to one decimal once for every area that has it.
 */
export function regionRings(
  areas: readonly RegionArea[],
  mode: Mode,
  window: PlotWindow,
  size: PlotSize,
): RegionRing[] {
  const m = projection(mode, window, size);
  const edges = new Map<RegionEdge, Px[]>();
  const edgeOf = (edge: RegionEdge): Px[] => {
    let px = edges.get(edge);
    if (!px) {
      const mapped = edge.points.map((q: Point): Px => toScreen(m, q.T, q.p));
      px = simplify(mapped).map(([x, y]): Px => [round(x), round(y)]);
      edges.set(edge, px);
    }
    return px;
  };
  return areas.map((area) => ({
    phase: area.phase,
    points: area.edges.flatMap(({ edge, reversed }) => {
      const px = edgeOf(edge);
      return (reversed ? [...px].reverse() : px).slice(0, -1);
    }),
  }));
}

/** A ring as a closed subpath, a vertex that repeats the one before it left out. */
function subpath(points: readonly Px[]): string {
  const kept = points.filter(
    (p, k) => k === 0 || p[0] !== points[k - 1]![0] || p[1] !== points[k - 1]![1],
  );
  const [first, ...rest] = kept.map(([x, y]) => `${x},${y}`);
  return rest.length < 2 ? "" : `M${first}L${rest.join(" ")}Z`;
}

/**
 * The regions as one path per phase present, in the order of PHASES, each face a subpath, in
 * plot-area px for a plot area of `size` over `window` in `mode`.
 */
export function regionPaths(
  areas: readonly RegionArea[],
  mode: Mode,
  window: PlotWindow,
  size: PlotSize,
): { phase: Phase; d: string }[] {
  const byPhase = new Map<Phase, string[]>();
  for (const ring of regionRings(areas, mode, window, size)) {
    const d = subpath(ring.points);
    if (d) byPhase.set(ring.phase, [...(byPhase.get(ring.phase) ?? []), d]);
  }
  return PHASES.filter((phase) => byPhase.has(phase)).map((phase) => ({
    phase,
    d: byPhase.get(phase)!.join(""),
  }));
}
