// The substance as the panel's fields see it: the field keys and labels,
// the conversion between them and the parameters and window, the preset they match, the phase
// names and the readout rows. No DOM here, so the diagram and the overlay can use it too.

import type { Params, Phase, PlotWindow } from "../physics/gibbs";
import { PRESETS, type PresetId } from "../physics/presets";
import { cutOf, type State } from "./state";
import { formatPressure, formatTemperature } from "./units";

/** The phase names, shown on the diagram's regions and named by the readout. */
export const PHASE_NAME: Record<Phase, string> = { s: "solid", l: "liquid", v: "vapor" };

/** One line of the readout: where two g curves cross along the cut. */
export interface ReadoutRow {
  phases: readonly [Phase, Phase];
  /** The position along the cut: T in K on an isobar, p in kPa on an isotherm. */
  value: number;
  /** The value as shown, in the shown pressure unit: "373.6 K" or "3.17 kPa". */
  text: string;
  stable: boolean;
}

/** The readout rows of the current cut, in order along it. */
export function readoutRows(state: Readonly<State>): ReadoutRow[] {
  const cut = cutOf(state);
  return state.crossings.map((c) => ({
    phases: c.phases,
    value: cut.kind === "isobar" ? c.T : c.p,
    text: cut.kind === "isobar" ? formatTemperature(c.T) : formatPressure(c.p, state.pressureUnit),
    stable: c.stable,
  }));
}

/** The editable inputs of the substance panel: every parameter and the window edges. */
export type FieldKey =
  | "Tt"
  | "pt"
  | "dHfus"
  | "dHvap"
  | "Ss"
  | "Vs"
  | "Vl"
  | "cps"
  | "cpl"
  | "cpv"
  | "Tmin"
  | "Tmax"
  | "pmin"
  | "pmax";

/**
 * Field labels as HTML (fixed strings), grouped as in the panel. Molar quantities are lowercase,
 * and every variable is italic, with Δ and the subscripts upright, except the p of c_p.
 */
export const FIELD_GROUPS: readonly {
  legend: string;
  fields: readonly [FieldKey, string, string][];
}[] = [
  {
    legend: "Triple point",
    fields: [
      ["Tt", "<i>T</i><sub>t</sub>", "K"],
      ["pt", "<i>p</i><sub>t</sub>", "kPa"],
    ],
  },
  {
    legend: "Enthalpies",
    fields: [
      ["dHfus", "Δ<i>h</i><sub>fus</sub>", "kJ/mol"],
      ["dHvap", "Δ<i>h</i><sub>vap</sub>", "kJ/mol"],
    ],
  },
  { legend: "Entropy", fields: [["Ss", "<i>s</i><sub>s</sub>", "J/(mol·K)"]] },
  {
    legend: "Molar volumes",
    fields: [
      ["Vs", "<i>v</i><sub>s</sub>", "L/mol"],
      ["Vl", "<i>v</i><sub>l</sub>", "L/mol"],
    ],
  },
  {
    legend: "Heat capacities",
    fields: [
      ["cps", "<i>c</i><sub><i>p</i>,s</sub>", "J/(mol·K)"],
      ["cpl", "<i>c</i><sub><i>p</i>,l</sub>", "J/(mol·K)"],
      ["cpv", "<i>c</i><sub><i>p</i>,v</sub>", "J/(mol·K)"],
    ],
  },
  {
    legend: "Window",
    fields: [
      ["Tmin", "<i>T</i><sub>min</sub>", "K"],
      ["Tmax", "<i>T</i><sub>max</sub>", "K"],
      ["pmin", "<i>p</i><sub>min</sub>", "kPa"],
      ["pmax", "<i>p</i><sub>max</sub>", "kPa"],
    ],
  },
];

/** The parameters and window as field values. */
export function substanceValues(params: Params, window: PlotWindow): Record<FieldKey, number> {
  return {
    Tt: params.Tt,
    pt: params.pt,
    dHfus: params.dHfus,
    dHvap: params.dHvap,
    Ss: params.Ss,
    Vs: params.Vs,
    Vl: params.Vl,
    cps: params.cp.s,
    cpl: params.cp.l,
    cpv: params.cp.v,
    Tmin: window.Tmin,
    Tmax: window.Tmax,
    pmin: window.pmin,
    pmax: window.pmax,
  };
}

/** The parameters and window that the field values describe; the inverse of `substanceValues`. */
export function substanceFrom(values: Readonly<Record<FieldKey, number>>): {
  params: Params;
  window: PlotWindow;
} {
  const { Tt, pt, dHfus, dHvap, Ss, Vs, Vl, cps, cpl, cpv, Tmin, Tmax, pmin, pmax } = values;
  return {
    params: { Tt, pt, dHfus, dHvap, Ss, Vs, Vl, cp: { s: cps, l: cpl, v: cpv } },
    window: { Tmin, Tmax, pmin, pmax },
  };
}

/** The preset whose parameters and window equal these, or null for a custom substance. */
export function matchPreset(params: Params, window: PlotWindow): PresetId | null {
  const values = substanceValues(params, window);
  const ids = Object.keys(PRESETS) as PresetId[];
  return (
    ids.find((id) => {
      const preset = substanceValues(PRESETS[id].params, PRESETS[id].window);
      return (Object.keys(values) as FieldKey[]).every((key) => values[key] === preset[key]);
    }) ?? null
  );
}
