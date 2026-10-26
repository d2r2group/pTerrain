// Text on the phase diagram: where each region's name goes, how the bold
// transition values under the x axis are kept apart, and where the "slope exaggerated" note goes.

import { PHASES, type Params, type Phase, type PlotWindow } from "../physics/gibbs";
import { fromScreen, invert, projection, rasterPhases, type PlotSize } from "./geometry";
import type { Mode } from "./state";
import type { PressureUnit } from "./units";

/** Stands in for an infinite squared distance in the distance transform. */
const FAR = 1e20;
/** How far below the largest clearance, in cells, a cell still counts as on the ridge. */
const RIDGE = 1;
/** The raster cell of the label search, CSS px: fine enough for a label, and 4× cheaper than 1. */
const CELL = 2;

/**
 * The "slope exaggerated" note's layout, CSS px: its baseline under the top edge, the extent of
 * its 12 px text above and below the baseline, and its gap to the line.
 */
const NOTE = { below: 14, ascent: 10, descent: 3, gap: 6 } as const;

/** Where a phase's name goes, in (T, p), so that it can follow the axis swap. */
export interface PhaseLabel {
  phase: Phase;
  T: number;
  p: number;
  /** The distance in px from the point to the region's edge or the plot frame. */
  clearance: number;
}

/**
 * The label point of each phase in this mode: the pole of inaccessibility of its region inside
 * the plot area, on a raster of CELL CSS px. A centroid could fall outside a non-convex region.
 * A phase whose largest clearance is under `halfWidth(phase)` px gets no label.
 */
export function phaseLabels(
  params: Params,
  window: PlotWindow,
  mode: Mode,
  size: PlotSize,
  halfWidth: (phase: Phase) => number,
): PhaseLabel[] {
  const cols = Math.max(1, Math.round(size.width / CELL));
  const rows = Math.max(1, Math.round(size.height / CELL));
  const grid = rasterPhases(params, window, mode, cols, rows);
  const toTp = invert(projection(mode, window, { width: cols, height: rows }));
  const out: PhaseLabel[] = [];
  PHASES.forEach((phase, index) => {
    const pole = poleOfInaccessibility(grid, cols, rows, index);
    if (!pole) return;
    // A cell is CELL px only up to the rounding of cols and rows; the smaller scale is taken.
    const clearance = pole.clearance * Math.min(size.width / cols, size.height / rows);
    if (clearance < halfWidth(phase)) return;
    const [T, p] = fromScreen(toTp, pole.x, pole.y);
    out.push({ phase, T, p, clearance });
  });
  return out;
}

/**
 * The center of the cell of `value` in the cols × rows `grid` (row by row from the top left)
 * that lies farthest from every other cell and from the grid's edge, with that distance in
 * cells, or null if `value` does not occur. The distance is a lower bound: it is measured to the
 * nearest corner of the nearest cell outside. Where a ridge of cells comes within RIDGE of the
 * farthest, as along a strip, the one nearest the ridge's centroid is taken, so that the label
 * sits in the middle of the strip rather than at its first cell.
 */
export function poleOfInaccessibility(
  grid: Uint8Array,
  cols: number,
  rows: number,
  value: number,
): { x: number; y: number; clearance: number } | null {
  // A border of outside cells stands for the plot frame.
  const W = cols + 2;
  const H = rows + 2;
  const f = new Float64Array(W * H);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r * cols + c] === value) f[(r + 1) * W + c + 1] = FAR;
    }
  }
  distanceTransform(f, W, H);
  let best = 0;
  for (let k = 0; k < f.length; k++) best = Math.max(best, f[k] as number);
  if (best === 0) return null;
  const floor = (Math.sqrt(best) - RIDGE) ** 2;
  const ridge: number[] = [];
  for (let k = 0; k < f.length; k++) if ((f[k] as number) >= floor) ridge.push(k);
  const cx = mean(ridge.map((k) => k % W));
  const cy = mean(ridge.map((k) => Math.floor(k / W)));
  let at = ridge[0] as number;
  for (const k of ridge) {
    const d = ((k % W) - cx) ** 2 + (Math.floor(k / W) - cy) ** 2;
    if (d < ((at % W) - cx) ** 2 + (Math.floor(at / W) - cy) ** 2) at = k;
  }
  return {
    x: (at % W) - 1 + 0.5,
    y: Math.floor(at / W) - 1 + 0.5,
    clearance: Math.sqrt(f[at] as number) - Math.SQRT1_2,
  };
}

/**
 * Squared Euclidean distance to the nearest 0 cell, in place, for a W × H grid of 0 (outside)
 * and FAR (inside): Felzenszwalb and Huttenlocher's transform, by columns and then by rows.
 */
function distanceTransform(f: Float64Array, W: number, H: number): void {
  const n = Math.max(W, H);
  const line = new Float64Array(n);
  const out = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let c = 0; c < W; c++) {
    for (let r = 0; r < H; r++) line[r] = f[r * W + c] as number;
    distance1d(line, H, out, v, z);
    for (let r = 0; r < H; r++) f[r * W + c] = out[r] as number;
  }
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) line[c] = f[r * W + c] as number;
    distance1d(line, W, out, v, z);
    for (let c = 0; c < W; c++) f[r * W + c] = out[c] as number;
  }
}

/** The 1D lower envelope of parabolas: d[q] = min over s of (q − s)² + f[s]. */
function distance1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  const at = (q: number) => f[q] as number;
  const meet = (q: number, s: number) => (at(q) + q * q - (at(s) + s * s)) / (2 * (q - s));
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k] as number);
    while (s <= (z[k] as number)) {
      k--;
      s = meet(q, v[k] as number);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while ((z[k + 1] as number) < q) k++;
    const s = v[k] as number;
    d[q] = (q - s) * (q - s) + at(s);
  }
}

/**
 * Centers for labels of the given `widths`, wanted at `xs`, so that neighbors keep at least
 * `gap` between them. Labels that would come too close are moved apart as a group, each by the
 * same amount where they are the same width (least squares), and a group is then shifted as a
 * whole to stay inside `bounds`. The result is in the order of `xs`.
 */
export function spreadApart(
  xs: readonly number[],
  widths: readonly number[],
  gap = 0,
  bounds: readonly [number, number] = [-Infinity, Infinity],
): number[] {
  const order = xs.map((_, k) => k).sort((a, b) => (xs[a] as number) - (xs[b] as number));
  // Each group is laid out from its left edge: member k's center is left + offsets[k].
  interface Group {
    members: number[];
    offsets: number[];
    width: number;
    left: number;
  }
  const fit = (g: Group) => {
    g.left = mean(g.members.map((k, m) => (xs[k] as number) - (g.offsets[m] as number)));
  };
  const groups: Group[] = [];
  for (const k of order) {
    const w = widths[k] as number;
    let g: Group = { members: [k], offsets: [w / 2], width: w, left: 0 };
    fit(g);
    for (
      let prev = groups.at(-1);
      prev && prev.left + prev.width + gap > g.left;
      prev = groups.at(-1)
    ) {
      groups.pop();
      const shift = prev.width + gap;
      g = {
        members: [...prev.members, ...g.members],
        offsets: [...prev.offsets, ...g.offsets.map((o) => o + shift)],
        width: shift + g.width,
        left: 0,
      };
      fit(g);
    }
    groups.push(g);
  }
  const out = new Array<number>(xs.length);
  for (const g of groups) {
    const left = Math.max(bounds[0], Math.min(bounds[1] - g.width, g.left));
    g.members.forEach((k, m) => (out[k] = left + (g.offsets[m] as number)));
  }
  return out;
}

function mean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** A box on the plot, CSS px: [left, top, right, bottom]. */
export type Box = [number, number, number, number];

/** Where the "slope exaggerated" note goes: its text anchor at (x, y), the baseline. */
export interface NoteSpot {
  x: number;
  y: number;
  anchor: "start" | "end";
}

/**
 * Where the "slope exaggerated" note of `width` px goes, up and to the left of the far end of the
 * drawn s-l line `sl` (plot pixels, in order of rising p): under the top edge with T across,
 * above the line at the right edge with p across. It is kept clear of the line where the line
 * runs beside or under its text, and moves to the other side of the line (right of it, or under
 * it) where it would cover one of the boxes `avoid`, the phase names. Null without a line.
 */
export function placeNote(
  sl: readonly [number, number][],
  mode: Mode,
  size: PlotSize,
  width: number,
  avoid: readonly Box[],
): NoteSpot | null {
  const end = sl.at(-1);
  if (!end) return null;
  const spots: (NoteSpot & { box: Box })[] = [];
  if (mode === "isobar") {
    const y = Math.max(0, end[1]) + NOTE.below;
    const [lo, hi] = [y - NOTE.ascent, y + NOTE.descent];
    const left = Math.min(end[0], extremeWithin(sl, 1, lo, hi, 0, Math.min) ?? end[0]);
    const right = Math.max(end[0], extremeWithin(sl, 1, lo, hi, 0, Math.max) ?? end[0]);
    const before = left - NOTE.gap;
    const after = right + NOTE.gap;
    spots.push({ box: [before - width, lo, before, hi], anchor: "end", x: before, y });
    spots.push({ box: [after, lo, after + width, hi], anchor: "start", x: after, y });
  } else {
    const x = Math.min(size.width, end[0]) - NOTE.gap;
    const [lo, hi] = [x - width - NOTE.gap, x + NOTE.gap];
    const top = Math.min(end[1], extremeWithin(sl, 0, lo, hi, 1, Math.min) ?? end[1]);
    const bottom = Math.max(end[1], extremeWithin(sl, 0, lo, hi, 1, Math.max) ?? end[1]);
    const above = Math.max(NOTE.ascent, top - NOTE.gap);
    const below = bottom + NOTE.gap + NOTE.ascent;
    const box = (y: number): Box => [x - width, y - NOTE.ascent, x, y + NOTE.descent];
    spots.push({ box: box(above), anchor: "end", x, y: above });
    spots.push({ box: box(below), anchor: "end", x, y: below });
  }
  const clear = (b: Box) =>
    avoid.every((n) => b[2] < n[0] || b[0] > n[2] || b[3] < n[1] || b[1] > n[3]);
  const { x, y, anchor } = spots.find((sp) => clear(sp.box)) ?? (spots[0] as NoteSpot);
  return { x, y, anchor };
}

/**
 * The least or greatest (`pick`) value of coordinate `of` (0 for x, 1 for y) along the polyline
 * `points`, over the part of it whose coordinate `along` lies between lo and hi, or null if no
 * part does.
 */
export function extremeWithin(
  points: readonly [number, number][],
  along: 0 | 1,
  lo: number,
  hi: number,
  of: 0 | 1,
  pick: (a: number, b: number) => number,
): number | null {
  let best: number | null = null;
  const take = (v: number) => (best = best === null ? v : pick(best, v));
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k] as [number, number];
    const b = points[k + 1] as [number, number];
    // The segment clipped to lo ≤ along ≤ hi; its extremes of `of` are at the clipped ends.
    const [ua, ub] = [a[along], b[along]];
    const t0 = ua === ub ? 0 : (lo - ua) / (ub - ua);
    const t1 = ua === ub ? 1 : (hi - ua) / (ub - ua);
    const from = Math.max(0, Math.min(t0, t1));
    const to = Math.min(1, Math.max(t0, t1));
    if (from > to || (ua === ub && (ua < lo || ua > hi))) continue;
    for (const t of [from, to]) take(a[of] + t * (b[of] - a[of]));
  }
  return best;
}

/** A piece of an axis label: plain text, or an italic variable, maybe with an upright subscript. */
export type LabelPart = string | { symbol: string; sub?: string };

/** A subscript's size, and how far its baseline drops, as fractions of the label's font size. */
const SUB_SIZE = 0.75;
const SUB_DROP = 0.25;

/**
 * The axis labels, with T, p and the molar g in italic; p in the shown unit. g is referenced to
 * the triple point, where all three phases share one value g_tp.
 */
export const AXIS_LABELS = {
  T: () => [{ symbol: "T" }, " (K)"],
  p: (unit: PressureUnit) => [{ symbol: "p" }, ` (${unit})`],
  G: () => [{ symbol: "g" }, " − ", { symbol: "g", sub: "tp" }, " (kJ/mol)"],
} as const satisfies Record<string, (unit: PressureUnit) => readonly LabelPart[]>;

/**
 * Fills an SVG text element with `parts`, one tspan each. Variables get the class `symbol` (set
 * in italic), and a subscript its own smaller tspan of class `sub`, lowered by `dy` (Firefox has
 * no `baseline-shift`); the tspan after it rises back.
 */
export function setAxisLabel(text: SVGTextElement, parts: readonly LabelPart[]): void {
  const tspan = (content: string, cls?: string) => {
    const span = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
    span.textContent = content;
    if (cls) span.classList.add(cls);
    return span;
  };
  const spans: SVGTSpanElement[] = [];
  let lowered = false;
  for (const part of parts) {
    const span = typeof part === "string" ? tspan(part) : tspan(part.symbol, "symbol");
    if (lowered) span.setAttribute("dy", `${-SUB_DROP}em`);
    spans.push(span);
    const subscript = typeof part === "string" ? undefined : part.sub;
    lowered = subscript !== undefined;
    if (subscript !== undefined) {
      const sub = tspan(subscript, "sub");
      // Its dy is in its own, smaller em.
      sub.setAttribute("font-size", `${100 * SUB_SIZE}%`);
      sub.setAttribute("dy", `${SUB_DROP / SUB_SIZE}em`);
      spans.push(sub);
    }
  }
  text.replaceChildren(...spans);
}
