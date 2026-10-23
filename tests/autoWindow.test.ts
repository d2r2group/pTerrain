import { describe, expect, it } from "vitest";
import { autoWindow, roundNice } from "../src/physics/autoWindow";
import type { Params, PlotWindow } from "../src/physics/gibbs";
import { CUSTOM, PRESETS } from "../src/physics/presets";
import { validate } from "../src/physics/validity";

const substances = [...Object.values(PRESETS), CUSTOM].map((s) => [s.name, s] as const);

/** The NICE mantissas of a rounded pressure edge. */
const MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8];

function isNice(p: number): boolean {
  const mantissa = p / 10 ** Math.floor(Math.log10(p));
  return MANTISSAS.some((m) => Math.abs(mantissa - m) < 1e-9);
}

/** Where the triple point sits in the window: across in T, up in log p. */
function position(params: Params, window: PlotWindow): { across: number; up: number } {
  return {
    across: (params.Tt - window.Tmin) / (window.Tmax - window.Tmin),
    up: Math.log(params.pt / window.pmin) / Math.log(window.pmax / window.pmin),
  };
}

describe("autoWindow", () => {
  it.each(substances)(
    "%s: passes validate, centres the triple point and has rounded edges",
    (_, { params }) => {
      const window = autoWindow(params);
      expect(validate(params, window)).toEqual([]);
      const { across, up } = position(params, window);
      for (const x of [across, up]) {
        expect(x).toBeGreaterThan(0.4);
        expect(x).toBeLessThan(0.6);
      }
      expect(window.Tmin % 5).toBe(0);
      expect(window.Tmax % 5).toBe(0);
      expect(isNice(window.pmin)).toBe(true);
      expect(isNice(window.pmax)).toBe(true);
    },
  );

  // Measured on the model in October 2026.
  it.each([
    ["H₂O", PRESETS.h2o, { Tmin: 200, Tmax: 345, pmin: 0.015, pmax: 25 }],
    ["CO₂", PRESETS.co2, { Tmin: 160, Tmax: 275, pmin: 100, pmax: 2500 }],
    ["Custom", CUSTOM, { Tmin: 220, Tmax: 380, pmin: 15, pmax: 150 }],
  ] as const)("%s: the preset's window is the measured one", (_, preset, window) => {
    expect(preset.window).toEqual(window);
    expect(autoWindow(preset.params)).toEqual(window);
  });

  it("passes validate, or gives the first try, on a sweep of valid Custom parameters", () => {
    // A small seeded generator (mulberry32), so the sweep is the same on every run.
    let seed = 7355;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const between = (lo: number, hi: number) => lo + (hi - lo) * random();
    let tried = 0;
    let failed = 0;
    while (tried < 120) {
      const params: Params = {
        Tt: between(150, 400),
        pt: 10 ** between(-2, 3),
        Vs: between(0.005, 4),
        Vl: between(0.005, 4),
        cp: { s: between(0, 50), l: between(0, 50), v: between(0, 30) },
        dHfus: between(1, 6),
        dHvap: between(8, 25),
        Ss: between(20, 60),
      };
      // Valid parameters: some window passes every check.
      const scaled: PlotWindow = {
        Tmin: 0.8 * params.Tt,
        Tmax: 1.2 * params.Tt,
        pmin: params.pt / 3,
        pmax: params.pt * 3,
      };
      if (validate(params, scaled).length > 0) continue;
      tried++;
      const window = autoWindow(params);
      const issues = validate(params, window);
      if (issues.length > 0) {
        failed++;
        // The first try: f = 0.27, so the T range is T_t (1 ∓ 0.27) to the nearest 5 K.
        expect(window.Tmin).toBe(5 * Math.round((0.73 * params.Tt) / 5));
        expect(window.Tmax).toBe(5 * Math.round((1.27 * params.Tt) / 5));
      }
      // Rounding the edges never puts a vapour line through the side of the window.
      const checks = issues.map((issue) => issue.check);
      expect(checks).not.toContain("sublimationEdge");
      expect(checks).not.toContain("vaporisationEdge");
    }
    expect(failed).toBeLessThan(tried / 4);
  }, 30_000); // A fixed sweep: well past vitest's 5 s default on a slow CI runner.

  it("rounds a pressure to the nearest nice value in log p", () => {
    expect([0.0115, 0.0137, 23.4, 27, 92, 1, 6.8, 7].map(roundNice)).toEqual([
      0.01, 0.015, 25, 25, 100, 1, 6, 8,
    ]);
  });
});
