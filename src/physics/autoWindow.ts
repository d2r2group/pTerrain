// The automatic window: centered on the triple point in T and in log p, like
// the earlier hand-tuned preset windows, with the s-v line leaving through p_min and the l-v line
// through p_max, and rounded edges.

import { condensedVolume, gibbs, R, type Params, type PlotWindow } from "./gibbs";
import { bisect } from "./roots";
import { validate } from "./validity";

/** The half-width of the T range, as a fraction of T_tp (hand-picked windows had 0.27, 0.26). */
const SPAN = 0.27;
/** The fraction of the room to the s-v and l-v lines that the p range takes in log p. */
const P_MARGIN = 0.9;
/** The factor on the T span after a window that fails `validate`, and how often it is applied. */
const SHRINK = 0.8;
const RETRIES = 8;
/** The mantissas that a rounded pressure edge may have, times a power of ten. */
const NICE = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/**
 * The window for these parameters: T_tp (1 ∓ f) to the nearest 5 K, and p_tp / r to p_tp r, where
 * log r is P_MARGIN of the smaller log distance from p_tp to the s-v line at T_min and to the l-v
 * line at T_max, each edge rounded to a NICE value. Starting from f = SPAN, f shrinks by SHRINK
 * while the window fails `validate`, up to RETRIES times; if none passes, the first try is
 * returned, so that validating it gives the issues of the first try.
 */
export function autoWindow(params: Params): PlotWindow {
  let first: PlotWindow | null = null;
  for (let k = 0, f = SPAN; k <= RETRIES; k++, f *= SHRINK) {
    const window = windowFor(params, f);
    if (validate(params, window).length === 0) return window;
    first ??= window;
  }
  return first as PlotWindow;
}

/** The window for T span fraction f, before any check. */
function windowFor(params: Params, f: number): PlotWindow {
  const { Tt, pt } = params;
  const Tmin = roundTo5(Tt * (1 - f));
  const Tmax = roundTo5(Tt * (1 + f));
  const below = Math.log(pt / vaporPressure("s", Tmin, params));
  const above = Math.log(vaporPressure("l", Tmax, params) / pt);
  // Without both lines (parameters that `validate` rejects anyway) a decade either side.
  const room = Math.min(below, above);
  const lnr = P_MARGIN * (room > 0 ? room : Math.LN10);
  return { Tmin, Tmax, pmin: roundNice(pt / Math.exp(lnr)), pmax: roundNice(pt * Math.exp(lnr)) };
}

/**
 * The pressure where G_i = G_v on the isotherm T, or NaN where the bracket holds no crossing.
 * Below RT/V_i, G_i − G_v falls with p, so the root is unique.
 */
function vaporPressure(phase: "s" | "l", T: number, params: Params): number {
  const f = (u: number) =>
    gibbs(phase, T, Math.exp(u), params) - gibbs("v", T, Math.exp(u), params);
  const lo = Math.log(params.pt) - 80;
  const hi = Math.log((0.5 * R * T) / condensedVolume(phase, params));
  if (!(f(lo) > 0 && f(hi) < 0)) return NaN;
  return Math.exp(bisect(f, lo, hi));
}

function roundTo5(T: number): number {
  return 5 * Math.round(T / 5);
}

/** The NICE value times a power of ten nearest to p in log p; p itself if not positive. */
export function roundNice(p: number): number {
  if (!(p > 0 && Number.isFinite(p))) return p;
  const decade = Math.floor(Math.log10(p));
  const scale = 10 ** decade;
  const mantissa = p / scale;
  const best = NICE.reduce((a, b) =>
    Math.abs(Math.log(b / mantissa)) < Math.abs(Math.log(a / mantissa)) ? b : a,
  );
  // 0.015 rather than 0.015000000000000001.
  return Number((best * scale).toPrecision(12));
}
