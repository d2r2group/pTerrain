// The g curves along a cut, for the slice panel: g − g_tp of the three phases, split into stable
// and metastable runs, and the g axis that follows the cut.

import { crossings, alongRange, pointOnCut, type Crossing, type Cut } from "./crossings";
import { gibbs, PHASES, stablePhase, type Params, type Phase, type PlotWindow } from "./gibbs";
import { linspace, logspace } from "./roots";

/** Steps along the cut for each g curve (a few hundred points). */
const SAMPLES = 300;
/** Headroom above and below the crossings, as a fraction of the g axis half-span. */
const G_PAD = 0.1;
/** Cuts of each mode that `gHalfSpan` scans across the window. */
const SPAN_CUTS = 200;

/** A run of one phase's g curve that is either on the lower envelope or above it. */
export interface SliceSegment {
  phase: Phase;
  stable: boolean;
  /** [x along the cut, g − g_tp in kJ/mol]. */
  points: [number, number][];
}

/** Position along the cut: T on an isobar, p on an isotherm. */
export function alongCut(cut: Cut, point: { T: number; p: number }): number {
  return cut.kind === "isobar" ? point.T : point.p;
}

/**
 * The three g curves along the cut, each split into stable runs (on the lower envelope) and
 * metastable ones. The runs of a phase meet exactly at the stable crossings, which are added to
 * the `samples` steps, even in T on an isobar and in log p on an isotherm. `found` is the cut's
 * `crossings`, for a caller that has them already.
 */
export function sliceSegments(
  cut: Cut,
  params: Params,
  window: PlotWindow,
  {
    samples = SAMPLES,
    found = crossings(cut, params, window),
  }: { samples?: number; found?: readonly Crossing[] } = {},
): SliceSegment[] {
  const [a, b] = alongRange(cut, window);
  const breaks = found
    .filter((c) => c.stable)
    .map((c) => alongCut(cut, c))
    .filter((x) => x > a && x < b);
  const steps = (cut.kind === "isobar" ? linspace : logspace)(a, b, samples + 1);
  const xs = [...new Set([...steps, ...breaks])].sort((u, v) => u - v);

  // Between consecutive stable crossings the envelope belongs to one phase.
  const edges = [a, ...breaks, b];
  const intervals: { lo: number; hi: number; phase: Phase }[] = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const lo = edges[k] as number;
    const hi = edges[k + 1] as number;
    if (hi <= lo) continue;
    const { T, p } = pointOnCut(cut, 0.5 * (lo + hi));
    intervals.push({ lo, hi, phase: stablePhase(T, p, params) });
  }

  const segments: SliceSegment[] = [];
  for (const phase of PHASES) {
    const runs: { lo: number; hi: number; stable: boolean }[] = [];
    for (const { lo, hi, phase: env } of intervals) {
      const stable = env === phase;
      const last = runs[runs.length - 1];
      if (last && last.stable === stable) last.hi = hi;
      else runs.push({ lo, hi, stable });
    }
    for (const { lo, hi, stable } of runs) {
      const points = xs
        .filter((x) => x >= lo && x <= hi)
        .map((x): [number, number] => {
          const { T, p } = pointOnCut(cut, x);
          return [x, gibbs(phase, T, p, params)];
        });
      segments.push({ phase, stable, points });
    }
  }
  return segments;
}

/**
 * Where the g axis is centered on this cut, kJ/mol: the g − g_tp of its highest stable crossing,
 * so that crossing sits halfway up the panel. A cut without a stable crossing lies in one phase,
 * and that phase's g at the middle of the cut is centered instead.
 */
export function gCenter(
  cut: Cut,
  params: Params,
  window: PlotWindow,
  found: readonly Crossing[] = crossings(cut, params, window),
): number {
  return gAnchor(cut, params, window, found).g;
}

/**
 * `gCenter`'s value, `g`, with what it is taken from, `by`: the pair of the highest stable
 * crossing ("s-l", …) or the one phase of a cut without one. The center moves continuously with
 * the cut while `by` stays the same, and jumps where it changes.
 */
export function gAnchor(
  cut: Cut,
  params: Params,
  window: PlotWindow,
  found: readonly Crossing[] = crossings(cut, params, window),
): { g: number; by: string } {
  let best: { g: number; by: string } | null = null;
  for (const c of found) {
    if (!c.stable) continue;
    const g = gibbs(c.phases[0], c.T, c.p, params);
    if (!best || g > best.g) best = { g, by: c.phases.join("-") };
  }
  if (best) return best;
  const [a, b] = alongRange(cut, window);
  const { T, p } = pointOnCut(cut, 0.5 * (a + b));
  const phase = stablePhase(T, p, params);
  return { g: gibbs(phase, T, p, params), by: phase };
}

/**
 * Half the height of the g axis, kJ/mol: the farthest any crossing, stable or metastable, lies
 * from its cut's center (`gCenter`), over SPAN_CUTS cuts of each mode evenly across the axis
 * (isobars in log p), with G_PAD headroom. So every crossing stays inside the panel as the axis
 * follows the cut, and the scale does not change while the cut is dragged or the mode is toggled.
 * Cuts that lie in one phase only are left out: their metastable crossings can lie far above the
 * envelope and would flatten every other cut, so there they may leave the panel. A curve that
 * leaves the panel is clipped.
 */
export function gHalfSpan(params: Params, window: PlotWindow, cuts = SPAN_CUTS): number {
  // Each mode's cuts, even in log₁₀ p for the isobars and in T for the isotherms.
  const families: { lo: number; hi: number; cut: (u: number) => Cut }[] = [
    {
      lo: Math.log10(window.pmin),
      hi: Math.log10(window.pmax),
      cut: (u) => ({ kind: "isobar", p: 10 ** u }),
    },
    { lo: window.Tmin, hi: window.Tmax, cut: (u) => ({ kind: "isotherm", T: u }) },
  ];
  let half = 0;
  for (const { lo, hi, cut: cutAt } of families) {
    for (let k = 0; k <= cuts; k++) {
      const cut = cutAt(lo + ((hi - lo) * k) / cuts);
      const found = crossings(cut, params, window);
      if (!found.some((c) => c.stable)) continue;
      const center = gCenter(cut, params, window, found);
      for (const c of found) {
        half = Math.max(half, Math.abs(gibbs(c.phases[0], c.T, c.p, params) - center));
      }
    }
  }
  // Without any crossing in the window there is nothing to fit, so 1 kJ/mol is shown.
  return half > 0 ? (1 + G_PAD) * half : 1;
}
