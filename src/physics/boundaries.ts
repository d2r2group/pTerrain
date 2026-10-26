// Phase boundaries g_i = g_j traced as polylines in (T, p), split into stable and metastable
// parts.

import { G_TIE, gibbs, thirdPhase, type Params, type Phase, type PlotWindow } from "./gibbs";
import { bisect, linspace, logspace } from "./roots";

export interface Point {
  T: number;
  p: number;
}

/** A piece of a boundary that is either stable (the third phase lies higher) or metastable. */
export interface BoundarySegment {
  stable: boolean;
  points: Point[];
}

export type PhasePair = readonly [Phase, Phase];

/** The three two-phase boundaries: s-l, s-v and l-v. */
export const PAIRS: readonly PhasePair[] = [
  ["s", "l"],
  ["s", "v"],
  ["l", "v"],
];

interface UV {
  u: number;
  v: number;
}

/**
 * The boundary g_i = g_j inside the window, as polylines that end exactly on the window edges
 * and are split where the third phase crosses (the triple point). `samples` steps are taken
 * along the tracing variable, evenly in T or in log p, since the p axis is logarithmic. Assumes
 * parameters that pass `validate`.
 */
export function boundary(
  i: Phase,
  j: Phase,
  params: Params,
  window: PlotWindow,
  samples = 256,
): BoundarySegment[] {
  if (i === j) throw new Error("boundary: the two phases must differ");
  const k = thirdPhase(i, j);

  // The vapor lines are solved for p along isotherms: below RT/v_i g_v − g_i rises
  // monotonically with p, so the root is unique. The s-l line can be steep, so it is solved for
  // T along isobars, where `validate` guarantees at most one crossing.
  const alongT = i === "v" || j === "v";
  const toPoint = (u: number, v: number): Point => (alongT ? { T: u, p: v } : { T: v, p: u });
  const [u0, u1, v0, v1] = alongT
    ? [window.Tmin, window.Tmax, window.pmin, window.pmax]
    : [window.pmin, window.pmax, window.Tmin, window.Tmax];

  const f = (u: number, v: number): number => {
    const { T, p } = toPoint(u, v);
    return gibbs(i, T, p, params) - gibbs(j, T, p, params);
  };
  const rootAt = (u: number): number | null => {
    const fa = f(u, v0);
    const fb = f(u, v1);
    if (fa !== 0 && fb !== 0 && Math.sign(fa) === Math.sign(fb)) return null;
    return bisect((v) => f(u, v), v0, v1);
  };
  // g_k − g_i on the boundary, shifted so that ties count as stable: ≥ 0 means stable.
  const margin = (u: number, v: number): number => {
    const { T, p } = toPoint(u, v);
    return gibbs(k, T, p, params) - gibbs(i, T, p, params) + G_TIE;
  };
  const isTie = (q: UV): boolean => Math.abs(margin(q.u, q.v) - G_TIE) <= G_TIE;

  // Where the boundary leaves the window between a sample with a root and one without: the
  // window edge on which f changes sign between the two samples.
  const edgePoint = (ua: number, ub: number): UV => {
    const edge = Math.sign(f(ua, v0)) !== Math.sign(f(ub, v0)) ? v0 : v1;
    return { u: bisect((u) => f(u, edge), ua, ub), v: edge };
  };

  const us = (alongT ? linspace : logspace)(u0, u1, samples + 1);
  const runs: UV[][] = [];
  let run: UV[] | null = null;
  us.forEach((u, idx) => {
    const v = rootAt(u);
    if (v !== null) {
      if (!run) {
        run = idx > 0 ? [edgePoint(us[idx - 1] as number, u)] : [];
        runs.push(run);
      }
      run.push({ u, v });
    } else if (run) {
      run.push(edgePoint(us[idx - 1] as number, u));
      run = null;
    }
  });

  // The point between a and b where the stability flag flips.
  const splitPoint = (a: UV, b: UV): UV => {
    const vAt = (u: number): number =>
      rootAt(u) ?? (Math.abs(u - a.u) < Math.abs(u - b.u) ? a.v : b.v);
    const u = bisect((x) => margin(x, vAt(x)), a.u, b.u);
    return { u, v: vAt(u) };
  };

  const segments: BoundarySegment[] = [];
  for (const pts of runs) {
    const first = pts[0];
    if (!first) continue;
    let stable = margin(first.u, first.v) >= 0;
    let current: UV[] = [first];
    for (let m = 1; m < pts.length; m++) {
      const prev = pts[m - 1] as UV;
      const pt = pts[m] as UV;
      const flag = margin(pt.u, pt.v) >= 0;
      if (flag !== stable) {
        // A sample that lands on the triple point is the split itself.
        const split = isTie(prev) ? prev : isTie(pt) ? pt : splitPoint(prev, pt);
        if (split !== prev) current.push(split);
        segments.push({ stable, points: current.map((q) => toPoint(q.u, q.v)) });
        stable = flag;
        current = [split];
      }
      if (pt !== current[0]) current.push(pt);
    }
    segments.push({ stable, points: current.map((q) => toPoint(q.u, q.v)) });
  }
  return segments.filter((seg) => seg.points.length >= 2);
}
