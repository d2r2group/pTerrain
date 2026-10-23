// Screen geometry of the phase diagram: where (T, p) lands in each mode, the blend between the
// two modes that the axis toggle animates, and the stable-phase raster.
// The p axis is logarithmic, so the maps are affine in (T, log₁₀ p): `toScreen` and
// `fromScreen` convert p on the way in and out.

import { PHASES, stablePhase, type Params, type PlotWindow } from "../physics/gibbs";
import { cutBounds, fromCutAxis, toCutAxis, type Mode } from "./state";

/**
 * Fixed margins around the plot area, in CSS px. They are not fitted to the tick labels, so the
 * slice panel under the diagram can share the same left edge and width. The right margin holds
 * the cut handle's 11 px knob; the left one the y tick labels and the axis label beside them.
 */
export const MARGIN = { top: 12, right: 13, bottom: 44, left: 50 } as const;

/**
 * The slice panel's margins. Its x axis runs along the top, so the tick labels sit above the plot
 * area, under the diagram's x-axis label, and only the frame line runs along the bottom. Left and
 * right are the diagram's, so the two plots share one x scale.
 */
export const SLICE_MARGIN = { ...MARGIN, top: 26, bottom: 12 } as const;

/**
 * The plot-area width for a panel `containerWidth` CSS px wide. The diagram and the slice panel
 * both use it, so with the same container width they share one x scale.
 */
export function plotWidth(containerWidth: number): number {
  return Math.max(120, Math.floor(containerWidth) - MARGIN.left - MARGIN.right);
}

/**
 * The plot-area height for a plot area `width` CSS px wide: half the width, within 160–360 px.
 * The diagram and the slice panel both use it, so the two plots are the same size.
 */
export function plotHeight(width: number): number {
  return Math.round(Math.min(360, Math.max(160, 0.5 * width)));
}

/**
 * The top and right edges of a plot area, as path data in plot coordinates. With the bottom and
 * left axes they close a frame, without ticks of its own.
 */
export function frameTopRight({ width, height }: PlotSize): string {
  return `M0,0H${width}V${height}`;
}

/**
 * The bottom and right edges of a plot area, for the slice panel, whose x axis is on top. With
 * the top and left axes they close a frame, without ticks of its own.
 */
export function frameBottomRight({ width, height }: PlotSize): string {
  return `M0,${height}H${width}V0`;
}

/** The inner plot area, in CSS px. */
export interface PlotSize {
  width: number;
  height: number;
}

/**
 * A 2D affine map in SVG/CSS `matrix(a, b, c, d, e, f)` order:
 * x' = a x + c y + e and y' = b x + d y + f.
 */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function apply(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** The map that applies `second` after `first`. */
export function compose(second: Affine, first: Affine): Affine {
  const [a2, b2, c2, d2, e2, f2] = second;
  const [a1, b1, c1, d1, e1, f1] = first;
  return [
    a2 * a1 + c2 * b1,
    b2 * a1 + d2 * b1,
    a2 * c1 + c2 * d1,
    b2 * c1 + d2 * d1,
    a2 * e1 + c2 * f1 + e2,
    b2 * e1 + d2 * f1 + f2,
  ];
}

export function invert(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (det === 0) throw new Error("invert: the map is singular");
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** (1 − t) m0 + t m1, entry by entry: a point under it moves on a straight line between the two. */
export function lerpAffine(m0: Affine, m1: Affine, t: number): Affine {
  return m0.map((v, k) => v + t * ((m1[k] as number) - v)) as unknown as Affine;
}

/**
 * The map from (T, log₁₀ p) to plot-area pixels (y down) in this mode: T across and p up for an
 * isobar, p across and T up for an isotherm. Every axis increases up or to the right.
 */
export function projection(mode: Mode, window: PlotWindow, size: PlotSize): Affine {
  const lpmin = Math.log10(window.pmin);
  const sT = 1 / (window.Tmax - window.Tmin);
  const sp = 1 / (Math.log10(window.pmax) - lpmin);
  const { width: W, height: H } = size;
  return mode === "isobar"
    ? [W * sT, 0, 0, -H * sp, -W * sT * window.Tmin, H + H * sp * lpmin]
    : [0, -H * sT, W * sp, 0, -W * sp * lpmin, H + H * sT * window.Tmin];
}

/** Where (T, p) lands under a `projection` (or a blend of two). */
export function toScreen(m: Affine, T: number, p: number): [number, number] {
  return apply(m, T, Math.log10(p));
}

/** The (T, p) at (x, y) under the inverse `inv` of a `projection`. */
export function fromScreen(inv: Affine, x: number, y: number): [number, number] {
  const [T, lp] = apply(inv, x, y);
  return [T, 10 ** lp];
}

/**
 * The screen-to-screen map that the axis toggle animates: at t = 0 it is the identity on the
 * `from` drawing, and at t = 1 it takes each point of it to where `to` draws the same (T, p).
 * It is affine, so it can move the region bitmap as a CSS transform.
 */
export function blendMatrix(
  from: Mode,
  to: Mode,
  t: number,
  window: PlotWindow,
  size: PlotSize,
): Affine {
  const p0 = projection(from, window, size);
  const p1 = projection(to, window, size);
  return compose(lerpAffine(p0, p1, t), invert(p0));
}

/** The cut value (p* for an isobar, T* for an isotherm) at plot-area height y, unclamped. */
export function cutValueAt(mode: Mode, y: number, window: PlotWindow, size: PlotSize): number {
  const [lo, hi] = cutBounds(mode, window).map((v) => toCutAxis(mode, v)) as [number, number];
  return fromCutAxis(mode, lo + (1 - y / size.height) * (hi - lo));
}

/** The plot-area height of the horizontal cut line at `value`. */
export function cutY(mode: Mode, value: number, window: PlotWindow, size: PlotSize): number {
  const [lo, hi] = cutBounds(mode, window).map((v) => toCutAxis(mode, v)) as [number, number];
  return (1 - (toCutAxis(mode, value) - lo) / (hi - lo)) * size.height;
}

/**
 * The stable phase at the centre of every pixel of a cols × rows grid over the plot area, as an
 * index into PHASES, row by row from the top left.
 */
export function rasterPhases(
  params: Params,
  window: PlotWindow,
  mode: Mode,
  cols: number,
  rows: number,
): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const toTp = invert(projection(mode, window, { width: cols, height: rows }));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [T, p] = fromScreen(toTp, c + 0.5, r + 0.5);
      out[r * cols + c] = PHASES.indexOf(stablePhase(T, p, params));
    }
  }
  return out;
}

/**
 * Each mode's `rasterPhases` grid, kept for the parameters, window and grid size it was found
 * for, so that a mode toggle finds each mode's grid once. One byte a pixel.
 */
export class RasterCache {
  #key: { params: Params; window: PlotWindow; cols: number; rows: number } | null = null;
  #phases: Partial<Record<Mode, Uint8Array>> = {};

  /** The grid of `rasterPhases`, found afresh only when this cache does not hold it. */
  get(params: Params, window: PlotWindow, mode: Mode, cols: number, rows: number): Uint8Array {
    const key = this.#key;
    if (
      !key ||
      key.params !== params ||
      key.window !== window ||
      key.cols !== cols ||
      key.rows !== rows
    ) {
      this.#key = { params, window, cols, rows };
      this.#phases = {};
    }
    return (this.#phases[mode] ??= rasterPhases(params, window, mode, cols, rows));
  }
}
