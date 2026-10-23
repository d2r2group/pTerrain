// The two real substances, H₂O and CO₂, with every input taken at the triple
// point, where the model is referenced. Fluid data from the NIST Chemistry WebBook (IAPWS-95 for
// water, Span–Wagner for CO₂), ice from IAPWS R10-06 and solid CO₂ from Giauque & Egan (1937);
// retrieved in October 2026.

import { autoWindow } from "./autoWindow";
import type { Params, PlotWindow } from "./gibbs";

export interface Preset {
  name: string;
  params: Params;
  window: PlotWindow;
}

export type PresetId = "h2o" | "co2";

/** A preset whose window is the automatic one, the one source of windows. */
function preset(name: string, params: Params): Preset {
  return { name, params, window: autoWindow(params) };
}

/**
 * Where "Custom" starts: the schematic substance of phases 1–7 ("normal"), with rounded numbers
 * chosen for a readable plot rather than for realism. ΔS_fus ≈ R, ΔS_vap ≈ 5R (half of Trouton's
 * rule) and S_s ≈ 4R at T_t = 300 K, no c_p, and V_s < V_l, so the s-l line slopes forward
 * (about +5.5 kPa/K). The window is 220–380 K × 15–150 kPa, with the triple point 52 % up.
 */
export const CUSTOM: Preset = preset("Custom", {
  Tt: 300,
  pt: 50,
  dHvap: 12.5,
  dHfus: 2.49,
  Ss: 33.3,
  Vs: 2.0,
  Vl: 3.5,
  cp: { s: 0, l: 0, v: 0 },
});

export const PRESETS: Record<PresetId, Preset> = {
  // V_s > V_l, so the s-l line slopes back, at about −13.5 MPa/K: almost vertical on the plot.
  // The window, 200–345 K × 0.015–25 kPa, puts the triple point in the middle of the diagram
  // (50 % across and up on the log p axis). The s-v line runs into the bottom edge (at 234.5 K)
  // and the l-v line into the top one (at 338.3 K), not into the sides.
  h2o: preset("H₂O", {
    Tt: 273.16,
    pt: 0.611654,
    dHvap: 45.055,
    dHfus: 6.007,
    Ss: 41.34,
    Vs: 0.019652,
    Vl: 0.018019,
    cp: { s: 37.77, l: 76.02, v: 33.95 },
  }),
  // V_s from Clapeyron and the slope of the Span–Wagner melting curve (+4.7 MPa/K), ΔH_fus from
  // T_t (S_l − S_s). The l-v line falls short of the reference towards T_c = 304 K, because the
  // vapour is ideal; the window, 160–275 K × 100–2500 kPa, stops well below it, with the triple
  // point 49 % across and 51 % up. The s-v line runs into the bottom edge (at 193 K) and the l-v
  // line into the top one (at 269 K).
  co2: preset("CO₂", {
    Tt: 216.592,
    pt: 517.964,
    dHvap: 15.42,
    dHfus: 8.9,
    Ss: 75.09,
    Vs: 0.02856,
    Vl: 0.037345,
    cp: { s: 56, l: 85.96, v: 39.99 },
  }),
};
