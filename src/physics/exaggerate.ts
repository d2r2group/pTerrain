// The exaggerated s-l slope. At true scale the s-l line of H₂O and CO₂ looks
// vertical, and no zoom changes that: its slope is hundreds of times the s-v line's. Here the
// model itself is changed, so that every plot stays consistent: the condensed phase whose volume
// makes |ΔV_fus| grow (the solid for water, the liquid for CO₂) gets an extra c (p − p_iv(T))
// in its G. That adds c to its volume, which tilts the s-l line, and vanishes on its own vapour
// line p_iv(T), so the s-v and l-v lines stay where they are.

import { boundary } from "./boundaries";
import { stableCrossing } from "./crossings";
import { condensedVolume, gibbs, R, type Params, type PlotWindow, type Stretch } from "./gibbs";
import { bisect, linspace } from "./roots";
import { validate } from "./validity";

/** How far the stable s-l line is made to drift across the window, as a fraction of its T range. */
export const LEAN = 0.1;
/** The most of the room beside the line (to the l-v line, or to T_min) that the lean may take. */
const ROOM = 0.5;
/** Steps of the table of p_iv(T) across the window. */
const TABLE = 256;

export interface Exaggerated {
  /** The parameters with the extra term, or the given ones where there is nothing to do. */
  params: Params;
  /** The factor on |ΔV_fus|; 1 where there is nothing to exaggerate. */
  factor: number;
}

/**
 * The exaggerated model for this substance and window: the stable s-l line drifts LEAN of the T
 * range between p_t and its top end, but by no more than ROOM of the room on that side (to the
 * l-v line when it leans forward, to T_min when it leans back). The stretched model must pass
 * `validate`; where it does not, the factor is halved until it does, down to 1. A
 * line that already leans that far, a triple point outside the window, or a vertical line
 * (ΔV_fus = 0) get factor 1.
 */
export function exaggerated(params: Params, window: PlotWindow): Exaggerated {
  const same = { params, factor: 1 };
  const { Tt, pt } = params;
  const dV = params.Vl - params.Vs;
  if (dV === 0 || !(pt > window.pmin && pt < window.pmax)) return same;
  const top = boundary("s", "l", params, window)
    .filter((seg) => seg.stable)
    .flatMap((seg) => seg.points)
    .reduce<{ T: number; p: number } | null>((a, q) => (!a || q.p > a.p ? q : a), null);
  if (!top) return same;

  const sign = Math.sign(dV);
  const lv = stableCrossing({ kind: "isobar", p: top.p }, ["l", "v"], params, window);
  const room = sign > 0 ? (lv?.T ?? window.Tmax) - Tt : Tt - window.Tmin;
  const lean = Math.min(LEAN * (window.Tmax - window.Tmin), ROOM * room);
  if (Math.abs(top.T - Tt) >= lean) return same;

  const phase = sign > 0 ? "l" : "s";
  const V = condensedVolume(phase, params);
  const ref = vapourLine(phase, params, window);
  if (!ref) return same;
  const withC = (c: number): Params => ({ ...params, stretch: { phase, c, ...ref } });

  // Where the s-l line meets the top isobar for a given c, as how far past the target it lies;
  // a line that has left the window has gone past it.
  const target = Tt + sign * lean;
  const past = (c: number): number => {
    const sl = stableCrossing({ kind: "isobar", p: top.p }, ["s", "l"], withC(c), window);
    return sl ? sign * (sl.T - target) : 1;
  };
  // The vapour must stay more than three times less dense than the enlarged phase.
  const cMax = Math.max(0, ((1 - 1e-9) * R * window.Tmin) / (3 * window.pmax) - V);
  const c = past(cMax) <= 0 ? cMax : bisect(past, 0, cMax);
  for (let factor = (Math.abs(dV) + c) / Math.abs(dV); factor > 1; factor /= 2) {
    const model = withC((factor - 1) * Math.abs(dV));
    if (validate(model, window).length === 0) return { params: model, factor };
  }
  return same;
}

/**
 * The real vapour line of a condensed phase, p_iv(T) with G_i = G_v, as a table over the window
 * that is linear in ln p between steps (and past its ends), with its derivative; null where it
 * cannot be found. Below RT/V_i, G_i − G_v falls with p, so the root is unique.
 */
function vapourLine(
  phase: "s" | "l",
  params: Params,
  window: PlotWindow,
): Pick<Stretch, "pRef" | "dpRef"> | null {
  const V = condensedVolume(phase, params);
  const Ts = linspace(window.Tmin, window.Tmax, TABLE + 1);
  const logs = new Float64Array(Ts.length);
  for (let k = 0; k < Ts.length; k++) {
    const T = Ts[k] as number;
    const f = (u: number) =>
      gibbs(phase, T, Math.exp(u), params) - gibbs("v", T, Math.exp(u), params);
    const lo = Math.log(params.pt) - 80;
    const hi = Math.log((0.5 * R * T) / V);
    if (!(f(lo) > 0 && f(hi) < 0)) return null;
    logs[k] = bisect(f, lo, hi);
  }
  const h = (window.Tmax - window.Tmin) / TABLE;
  const at = (T: number) => {
    const k = Math.min(TABLE - 1, Math.max(0, Math.floor((T - window.Tmin) / h)));
    const slope = ((logs[k + 1] as number) - (logs[k] as number)) / h;
    return { lnp: (logs[k] as number) + slope * (T - (Ts[k] as number)), slope };
  };
  return {
    pRef: (T) => Math.exp(at(T).lnp),
    dpRef: (T) => {
      const { lnp, slope } = at(T);
      return Math.exp(lnp) * slope;
    },
  };
}
