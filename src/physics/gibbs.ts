// Closed-form molar Gibbs energies of the three phases, referenced to the triple point.
// Units: T in K, p in kPa, ΔH in kJ/mol, S and c_p in J/(mol·K), V in L/mol, G in kJ/mol.
// L·kPa = J, so V·p and R·T·ln p both come out in J/mol before the final /1000.

/** Molar gas constant, J/(mol·K). */
export const R = 8.314462618;

export type Phase = "s" | "l" | "v";
export const PHASES: readonly Phase[] = ["s", "l", "v"];

/** Two G values closer than this (kJ/mol) count as equal, e.g. at the triple point. */
export const G_TIE = 1e-9;

export interface Params {
  /** Triple-point temperature, K. */
  Tt: number;
  /** Triple-point pressure, kPa. */
  pt: number;
  /** Enthalpy of fusion at the triple point, kJ/mol. */
  dHfus: number;
  /** Enthalpy of vaporization at the triple point, kJ/mol. */
  dHvap: number;
  /** Molar entropy of the solid at the triple point, J/(mol·K). */
  Ss: number;
  /** Molar volume of the solid, L/mol. */
  Vs: number;
  /** Molar volume of the liquid, L/mol. */
  Vl: number;
  /** Constant c_p of each phase, J/(mol·K). */
  cp: Record<Phase, number>;
  /** An extra term in one condensed phase's G, for the exaggerated s-l slope (exaggerate.ts). */
  stretch?: Stretch;
}

/**
 * An extra c (p − p_ref(T)) in the G of a condensed phase, J/mol with c in L/mol and p in kPa.
 * It adds c to that phase's volume, which tilts the s-l line, and vanishes on the curve p_ref(T),
 * which exaggerate.ts sets to that phase's own vapor line, so that line does not move.
 */
export interface Stretch {
  phase: "s" | "l";
  c: number;
  pRef(T: number): number;
  /** dp_ref/dT, kPa/K. */
  dpRef(T: number): number;
}

/** The T × p range that the diagram shows. */
export interface PlotWindow {
  Tmin: number;
  Tmax: number;
  pmin: number;
  pmax: number;
}

/** Molar entropy of a phase at the triple point, J/(mol·K). */
export function tripleEntropy(phase: Phase, params: Params): number {
  const Sl = params.Ss + (1000 * params.dHfus) / params.Tt;
  if (phase === "s") return params.Ss;
  if (phase === "l") return Sl;
  return Sl + (1000 * params.dHvap) / params.Tt;
}

/**
 * Molar entropy −∂G/∂T, J/(mol·K): S_i + c_p,i ln(T/T_tp), and for the ideal-gas vapor also
 * − R ln(p/p_tp); a `stretch` adds c dp_ref/dT to its phase.
 */
export function entropy(phase: Phase, T: number, p: number, params: Params): number {
  const S = tripleEntropy(phase, params) + params.cp[phase] * Math.log(T / params.Tt);
  if (phase === "v") return S - R * Math.log(p / params.pt);
  const { stretch } = params;
  return stretch?.phase === phase ? S + stretch.c * stretch.dpRef(T) : S;
}

/** The parameter v_s or v_l of a condensed phase, L/mol, without any `stretch`. */
export function condensedVolume(phase: "s" | "l", params: Params): number {
  return phase === "s" ? params.Vs : params.Vl;
}

/** Molar volume, L/mol: constant for s and l (plus c under a `stretch`), RT/p for the vapor. */
export function volume(phase: Phase, T: number, p: number, params: Params): number {
  if (phase === "v") return (R * T) / p;
  const V = condensedVolume(phase, params);
  return params.stretch?.phase === phase ? V + params.stretch.c : V;
}

function gibbsAt(phase: Phase, T: number, p: number, params: Params): number {
  const dT = T - params.Tt;
  const thermal =
    -tripleEntropy(phase, params) * dT - params.cp[phase] * (T * Math.log(T / params.Tt) - dT);
  const mechanical =
    phase === "v"
      ? R * T * Math.log(p / params.pt)
      : condensedVolume(phase, params) * (p - params.pt);
  const { stretch } = params;
  const extra = stretch?.phase === phase ? stretch.c * (p - stretch.pRef(T)) : 0;
  return (thermal + mechanical + extra) / 1000;
}

/**
 * Molar Gibbs energy in kJ/mol, zero for every phase at the triple point. Either argument may
 * be an array (a cut), and the result is then an array of the same length.
 */
export function gibbs(phase: Phase, T: number, p: number, params: Params): number;
export function gibbs(
  phase: Phase,
  T: number | Float64Array,
  p: number | Float64Array,
  params: Params,
): Float64Array;
export function gibbs(
  phase: Phase,
  T: number | Float64Array,
  p: number | Float64Array,
  params: Params,
): number | Float64Array {
  if (typeof T === "number" && typeof p === "number") return gibbsAt(phase, T, p, params);
  const n = typeof T === "number" ? (p as Float64Array).length : T.length;
  if (typeof p !== "number" && p.length !== n) {
    throw new Error("gibbs: T and p arrays must have the same length");
  }
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const Tk = typeof T === "number" ? T : (T[k] as number);
    const pk = typeof p === "number" ? p : (p[k] as number);
    out[k] = gibbsAt(phase, Tk, pk, params);
  }
  return out;
}

/** The phase with the lowest G at (T, p); ties go to the first of s, l, v. */
export function stablePhase(T: number, p: number, params: Params): Phase {
  let best: Phase = "s";
  let bestG = gibbsAt("s", T, p, params);
  for (const phase of ["l", "v"] as const) {
    const G = gibbsAt(phase, T, p, params);
    if (G < bestG) {
      best = phase;
      bestG = G;
    }
  }
  return best;
}

/** The triple point (T_tp, p_tp), where all three G vanish by construction. */
export function triplePoint(params: Params): { T: number; p: number } {
  return { T: params.Tt, p: params.pt };
}

/** The phase that is neither i nor j. */
export function thirdPhase(i: Phase, j: Phase): Phase {
  return PHASES.find((phase) => phase !== i && phase !== j) as Phase;
}
