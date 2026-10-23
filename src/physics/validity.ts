// The validity limits: parameter and window combinations for which the model stops
// being a sensible phase diagram.

import { PAIRS } from "./boundaries";
import { crossings, type Cut } from "./crossings";
import { entropy, gibbs, PHASES, R, volume, type Params, type PlotWindow } from "./gibbs";
import { linspace, logspace } from "./roots";

export type ValidityCheck =
  | "finite"
  | "triplePoint"
  | "dHfus"
  | "dHvap"
  | "volume"
  | "Tmin"
  | "pmin"
  | "window"
  | "tripleInWindow"
  | "entropy"
  | "vapourDensity"
  | "singleCrossing"
  | "sublimationEdge"
  | "vaporisationEdge";

export interface ValidityIssue {
  check: ValidityCheck;
  message: string;
}

/**
 * Cuts of each kind across the window (isobars evenly in log p) that the single-crossing check
 * scans.
 */
const CHECK_CUTS = 41;
/** Steps along each of those cuts. */
const CHECK_INTERVALS = 256;

/**
 * Every validity limit that the parameters and window break; empty when they are valid. The
 * checks over the window only run once the basic signs and ranges are right.
 */
export function validate(params: Params, window: PlotWindow): ValidityIssue[] {
  const issues: ValidityIssue[] = [];
  const fail = (check: ValidityCheck, message: string) => issues.push({ check, message });

  const numbers = [
    params.Tt,
    params.pt,
    params.dHfus,
    params.dHvap,
    params.Ss,
    params.Vs,
    params.Vl,
    ...PHASES.map((phase) => params.cp[phase]),
    window.Tmin,
    window.Tmax,
    window.pmin,
    window.pmax,
  ];
  if (!numbers.every(Number.isFinite)) {
    fail("finite", "Every parameter must be a number.");
    return issues;
  }
  if (!(params.Tt > 0 && params.pt > 0)) {
    fail("triplePoint", "The triple-point temperature and pressure must be positive.");
  }
  if (!(params.dHfus > 0)) fail("dHfus", "Δh_fus must be positive.");
  if (!(params.dHvap > 0)) fail("dHvap", "Δh_vap must be positive.");
  if (!(params.Vs > 0 && params.Vl > 0)) fail("volume", "v_s and v_l must be positive.");
  if (!(window.Tmin > 0)) fail("Tmin", "T_min must be positive.");
  if (!(window.pmin > 0)) fail("pmin", "p_min must be positive.");
  if (!(window.Tmax > window.Tmin && window.pmax > window.pmin)) {
    fail("window", "T_max and p_max must lie above T_min and p_min.");
  }
  if (issues.length > 0) return issues;

  const { Tt, pt } = params;
  if (!(Tt > window.Tmin && Tt < window.Tmax && pt > window.pmin && pt < window.pmax)) {
    fail("tripleInWindow", "The triple point must lie inside the window.");
  }

  // S_i is monotonic in T and in p, so the corners of the window decide.
  const corners = [
    [window.Tmin, window.pmin],
    [window.Tmin, window.pmax],
    [window.Tmax, window.pmin],
    [window.Tmax, window.pmax],
  ] as const;
  const negative = PHASES.filter(
    (phase) => !corners.every(([T, p]) => entropy(phase, T, p, params) > 0),
  );
  if (negative.length > 0) {
    fail("entropy", `s(T) turns negative in the window for: ${negative.join(", ")}.`);
  }

  // volume() includes the stretch of an exaggerated model (exaggerate.ts); s and l are constant.
  const RTmin = R * window.Tmin;
  const dense = (["s", "l"] as const).some(
    (phase) => !(3 * volume(phase, window.Tmin, window.pmax, params) * window.pmax < RTmin),
  );
  if (dense) {
    fail(
      "vapourDensity",
      "The vapour must be at least three times less dense than s and l: 3 v p_max < R T_min.",
    );
  }

  if (!singleCrossings(params, window)) {
    fail("singleCrossing", "Two G curves cross more than once along some isobar or isotherm.");
  }
  if (sublimationOnTmin(params, window)) {
    fail(
      "sublimationEdge",
      "The solid–vapour line must leave the window through p_min, not T_min: raise p_min or lower T_min.",
    );
  }
  if (vaporisationOnTmax(params, window)) {
    fail(
      "vaporisationEdge",
      "The liquid–vapour line must leave the window through p_max, not T_max: lower p_max or raise T_max.",
    );
  }
  return issues;
}

/**
 * Whether the stable l-v line meets the T_max edge below p_max. It must meet p_max instead, as
 * the s-v line meets p_min, so that it runs into the top edge rather than the right one.
 */
function vaporisationOnTmax(params: Params, window: PlotWindow): boolean {
  const edge: Cut = { kind: "isotherm", T: window.Tmax };
  return crossings(edge, params, window).some(
    (c) => c.stable && c.phases[0] === "l" && c.phases[1] === "v" && c.p < window.pmax,
  );
}

/**
 * Whether the stable s-v line meets the T_min edge above p_min. It must meet p_min instead, so
 * that in constant p mode it runs into the x axis, and every isobar below it crosses it inside
 * the window rather than lying in the vapour only.
 */
function sublimationOnTmin(params: Params, window: PlotWindow): boolean {
  const edge: Cut = { kind: "isotherm", T: window.Tmin };
  return crossings(edge, params, window).some(
    (c) => c.stable && c.phases[0] === "s" && c.phases[1] === "v" && c.p > window.pmin,
  );
}

/**
 * Whether each pair of G curves crosses at most once along every sampled isobar and isotherm.
 * Each phase's G is computed once per point, and the crossings are only counted, not refined.
 */
function singleCrossings(params: Params, window: PlotWindow): boolean {
  // The grids of pairRoots: steps in T along an isobar, in ln p along an isotherm.
  const Ts = linspace(window.Tmin, window.Tmax, CHECK_INTERVALS + 1);
  const ps = linspace(Math.log(window.pmin), Math.log(window.pmax), CHECK_INTERVALS + 1).map(
    Math.exp,
  );
  const cuts = [
    ...Array.from(logspace(window.pmin, window.pmax, CHECK_CUTS), (p) => [Ts, p] as const),
    ...Array.from(linspace(window.Tmin, window.Tmax, CHECK_CUTS), (T) => [T, ps] as const),
  ];
  return cuts.every(([T, p]) => {
    const G = {
      s: gibbs("s", T, p, params),
      l: gibbs("l", T, p, params),
      v: gibbs("v", T, p, params),
    };
    return PAIRS.every(([i, j]) => rootCount(G[i], G[j]) <= 1);
  });
}

/** How many roots findRoots gives for a − b on their grid: its exact zeros and sign changes. */
function rootCount(a: Float64Array, b: Float64Array): number {
  let count = 0;
  for (let k = 0; k < a.length; k++) {
    const f = (a[k] as number) - (b[k] as number);
    if (f === 0) {
      count++;
    } else if (k < a.length - 1) {
      const fNext = (a[k + 1] as number) - (b[k + 1] as number);
      if (Math.sign(fNext) * Math.sign(f) < 0) count++;
    }
  }
  return count;
}
