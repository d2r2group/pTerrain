// Where the g curves of two phases cross along one cut.

import { PAIRS, type PhasePair } from "./boundaries";
import { G_TIE, gibbs, thirdPhase, type Params, type Phase, type PlotWindow } from "./gibbs";
import { findRoots } from "./roots";

/** An isobar (constant p mode, the slice is g(T)) or an isotherm (constant T mode, g(p)). */
export type Cut = { kind: "isobar"; p: number } | { kind: "isotherm"; T: number };

export interface Crossing {
  phases: PhasePair;
  T: number;
  p: number;
  /** True on the lower envelope (the third g lies higher, or ties at the triple point). */
  stable: boolean;
}

/** The point on the cut at position x along it (T on an isobar, p on an isotherm). */
export function pointOnCut(cut: Cut, x: number): { T: number; p: number } {
  return cut.kind === "isobar" ? { T: x, p: cut.p } : { T: cut.T, p: x };
}

/** The range of x along the cut inside the window. */
export function alongRange(cut: Cut, window: PlotWindow): [number, number] {
  return cut.kind === "isobar" ? [window.Tmin, window.Tmax] : [window.pmin, window.pmax];
}

/** Steps of the scan for crossings along a cut. */
const INTERVALS = 32;

/**
 * The positions x along the cut where g_i = g_j inside the window, scanned on INTERVALS
 * steps (in T on an isobar, in ln p on an isotherm, since the p axis is logarithmic) and refined
 * by bisection.
 */
export function pairRoots(
  i: Phase,
  j: Phase,
  cut: Cut,
  params: Params,
  window: PlotWindow,
): number[] {
  const [a, b] = alongRange(cut, window);
  const log = cut.kind === "isotherm";
  const fromU = (u: number) => (log ? Math.exp(u) : u);
  return findRoots(
    (u) => {
      const { T, p } = pointOnCut(cut, fromU(u));
      return gibbs(i, T, p, params) - gibbs(j, T, p, params);
    },
    log ? Math.log(a) : a,
    log ? Math.log(b) : b,
    INTERVALS,
  ).map(fromU);
}

/**
 * Every crossing of two g curves along the cut inside the window, sorted along the cut. A pair
 * that does not cross inside the window gives no crossing.
 */
export function crossings(cut: Cut, params: Params, window: PlotWindow): Crossing[] {
  const out: (Crossing & { x: number })[] = [];
  for (const phases of PAIRS) {
    const [i, j] = phases;
    const k = thirdPhase(i, j);
    for (const x of pairRoots(i, j, cut, params, window)) {
      const { T, p } = pointOnCut(cut, x);
      const stable = gibbs(k, T, p, params) >= gibbs(i, T, p, params) - G_TIE;
      out.push({ phases, T, p, stable, x });
    }
  }
  out.sort((a, b) => a.x - b.x);
  return out.map(({ phases, T, p, stable }) => ({ phases, T, p, stable }));
}

/** Where the cut meets the stable boundary of `pair` inside the window, or undefined. */
export function stableCrossing(
  cut: Cut,
  pair: PhasePair,
  params: Params,
  window: PlotWindow,
): Crossing | undefined {
  return crossings(cut, params, window).find(
    (c) => c.stable && c.phases[0] === pair[0] && c.phases[1] === pair[1],
  );
}

/** How far `cutLimits` moves an end inside the window inwards, as a fraction of the axis. */
const EDGE_NUDGE = 1e-6;

/**
 * The cut values that meet a stable boundary inside the window, for each kind of cut: from the
 * lowest to the highest p (isobars) or T (isotherms) on the stable boundaries,
 * with an end inside the window moved in by EDGE_NUDGE of the axis. The single-crossing check
 * keeps each boundary monotonic in T and p, so its extremes in the window lie on the
 * window's edges or at the triple point. With the triple point inside the window and the edge checks of `validate`,
 * every isobar meets one, so the isobar range is the whole window, and the isotherms between the
 * two ends do too. Without any stable boundary in the window, both are the whole window.
 */
export function cutLimits(
  params: Params,
  window: PlotWindow,
): Record<Cut["kind"], [number, number]> {
  const { Tmin, Tmax, pmin, pmax } = window;
  const edges: Cut[] = [
    { kind: "isobar", p: pmin },
    { kind: "isobar", p: pmax },
    { kind: "isotherm", T: Tmin },
    { kind: "isotherm", T: Tmax },
  ];
  const points: { T: number; p: number }[] = edges.flatMap((edge) =>
    crossings(edge, params, window).filter((c) => c.stable),
  );
  const { Tt, pt } = params;
  if (Tt >= Tmin && Tt <= Tmax && pt >= pmin && pt <= pmax) points.push({ T: Tt, p: pt });
  if (points.length === 0) return { isobar: [pmin, pmax], isotherm: [Tmin, Tmax] };
  // An end inside the window lies where a boundary meets a window edge, so the cut there meets it
  // on that edge, where rounding can put the root just outside. It is moved in by EDGE_NUDGE of
  // the axis (log p for isobars) so that the end cut keeps its crossing.
  const range = (
    values: number[],
    lo: number,
    hi: number,
    toAxis: (v: number) => number,
    fromAxis: (u: number) => number,
  ): [number, number] => {
    const nudge = EDGE_NUDGE * (toAxis(hi) - toAxis(lo));
    const a = Math.min(...values);
    const b = Math.max(...values);
    return [a > lo ? fromAxis(toAxis(a) + nudge) : lo, b < hi ? fromAxis(toAxis(b) - nudge) : hi];
  };
  const id = (v: number) => v;
  return {
    isobar: range(
      points.map((q) => q.p),
      pmin,
      pmax,
      Math.log,
      Math.exp,
    ),
    isotherm: range(
      points.map((q) => q.T),
      Tmin,
      Tmax,
      id,
      id,
    ),
  };
}
