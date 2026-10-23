import { describe, expect, it } from "vitest";
import { boundary } from "../src/physics/boundaries";
import { stableCrossing } from "../src/physics/crossings";
import { exaggerated, LEAN } from "../src/physics/exaggerate";
import {
  entropy,
  gibbs,
  PHASES,
  R,
  volume,
  type Params,
  type PlotWindow,
} from "../src/physics/gibbs";
import { CUSTOM, PRESETS } from "../src/physics/presets";
import { validate } from "../src/physics/validity";
import { formatFactor } from "../src/ui/controls";
import { Store } from "../src/ui/state";

const { h2o, co2 } = PRESETS;

/** The T where the stable s-l line meets the isobar at p. */
function slAt(params: Params, window: PlotWindow, p: number): number {
  const c = stableCrossing({ kind: "isobar", p }, ["s", "l"], params, window);
  if (!c) throw new Error(`no stable s-l crossing at ${p} kPa`);
  return c.T;
}

describe("exaggerated s-l slope", () => {
  it("H₂O: the solid is enlarged, and the line leans back by LEAN of the T range (capped)", () => {
    const { params, window } = h2o;
    const { params: model, factor } = exaggerated(params, window);
    expect(model.stretch?.phase).toBe("s");
    expect(factor).toBeGreaterThan(1000);
    const lean = Math.min(LEAN * (window.Tmax - window.Tmin), 0.5 * (params.Tt - window.Tmin));
    expect(slAt(model, window, window.pmax)).toBeCloseTo(params.Tt - lean, 3);
  });

  it("CO₂: the liquid is enlarged, and the line leans forward, within the vapour-density cap", () => {
    const { params, window } = co2;
    const { params: model, factor } = exaggerated(params, window);
    expect(model.stretch?.phase).toBe("l");
    expect(factor).toBeGreaterThan(10);
    const lean = slAt(model, window, window.pmax) - params.Tt;
    expect(lean).toBeGreaterThan(5);
    expect(lean).toBeLessThanOrEqual(LEAN * (window.Tmax - window.Tmin) + 1e-6);
    // The enlarged liquid stays more than three times as dense as the vapour anywhere in the
    // window.
    const V = volume("l", window.Tmin, window.pmax, model);
    expect(3 * V).toBeLessThan(volume("v", window.Tmin, window.pmax, model));
    expect(validate(model, window).map((issue) => issue.check)).not.toContain("vapourDensity");
  });

  it("checks the vapour density with the enlarged volume", () => {
    const { params, window } = co2;
    const stretch = exaggerated(params, window).params.stretch!;
    // Under the twofold cap of before RP1: the threefold rule fails.
    const c = (R * window.Tmin) / (2 * window.pmax) - params.Vl;
    const checks = validate({ ...params, stretch: { ...stretch, c } }, window).map((i) => i.check);
    expect(checks).toContain("vapourDensity");
  });

  it("a Custom substance whose full stretch is too wide: the stretched model passes validate, at a reduced factor", () => {
    const params: Params = {
      ...CUSTOM.params,
      Vs: 2.564,
      Vl: 1.791,
      cp: { s: 41.4, l: 17.6, v: 17.3 },
      dHfus: 3.716,
      dHvap: 17.84,
      Ss: 44.49,
    };
    const { window } = CUSTOM;
    expect(validate(params, window)).toEqual([]);
    const { params: model, factor } = exaggerated(params, window);
    expect(validate(model, window)).toEqual([]);
    expect(factor).toBeLessThan(2.95);
  });

  it("every random valid Custom set gives a model that passes validate", () => {
    // A small seeded generator (mulberry32), so the sweep is the same on every run.
    let seed = 7355;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const between = (lo: number, hi: number) => lo + (hi - lo) * random();
    const { window } = CUSTOM;
    let tried = 0;
    let stretched = 0;
    while (tried < 60) {
      const params: Params = {
        ...CUSTOM.params,
        Vs: between(0.5, 4),
        Vl: between(0.5, 4),
        cp: { s: between(0, 50), l: between(0, 50), v: between(0, 30) },
        dHfus: between(1, 6),
        dHvap: between(8, 25),
        Ss: between(20, 60),
      };
      if (validate(params, window).length > 0) continue;
      tried++;
      const e = exaggerated(params, window);
      expect(validate(e.params, window)).toEqual([]);
      if (e.factor > 1) stretched++;
    }
    expect(stretched).toBeGreaterThan(0);
  }, 30_000); // A fixed sweep: well past vitest's 5 s default on a slow CI runner.

  it.each(Object.entries(PRESETS))(
    "%s: the s-v and l-v lines stay where they are, and the model passes every check",
    (_, { params, window }) => {
      const { params: model } = exaggerated(params, window);
      expect(validate(model, window)).toEqual([]);
      for (const [i, j] of [
        ["s", "v"],
        ["l", "v"],
      ] as const) {
        // Every point of the exaggerated line lies on the real one: G_i = G_v there, up to the
        // vapour-line table's interpolation. As a shift in T (ΔG / ΔS) that is under 1 mK.
        const dS =
          1e-3 *
          (entropy(j, params.Tt, params.pt, params) - entropy(i, params.Tt, params.pt, params));
        for (const { T, p } of boundary(i, j, model, window).flatMap((seg) => seg.points)) {
          const real = gibbs(i, T, p, params) - gibbs(j, T, p, params);
          expect(Math.abs(real / dS)).toBeLessThan(1e-3);
        }
      }
      // The triple point stays, and all three G still vanish there.
      for (const phase of PHASES) {
        expect(Math.abs(gibbs(phase, params.Tt, params.pt, model))).toBeLessThan(1e-6);
      }
    },
  );

  it.each(Object.entries(PRESETS))(
    "%s: ∂G/∂T = −S and ∂G/∂p = V hold for the enlarged phase",
    (_, { params, window }) => {
      const { params: model } = exaggerated(params, window);
      const phase = model.stretch!.phase;
      const hT = 1e-3;
      for (const T of [window.Tmin + 7, params.Tt, window.Tmax - 7]) {
        for (const p of [window.pmin * 2, params.pt, window.pmax / 2]) {
          const hp = 1e-3 * p;
          const dGdT = (gibbs(phase, T + hT, p, model) - gibbs(phase, T - hT, p, model)) / (2 * hT);
          const dGdp = (gibbs(phase, T, p + hp, model) - gibbs(phase, T, p - hp, model)) / (2 * hp);
          // Within the linear pieces of the vapour-line table the derivative is exact.
          expect(dGdT * 1000).toBeCloseTo(-entropy(phase, T, p, model), 2);
          expect(dGdp * 1000).toBeCloseTo(volume(phase, T, p, model), 6);
        }
      }
    },
  );

  it("gives factor 1 and the given parameters where there is nothing to exaggerate", () => {
    // A line that already leans far enough (v_l = 3.6 L/mol up to Custom's T_max of 380 K), and
    // a triple point above the window.
    const cases: [Params, PlotWindow][] = [
      [{ ...CUSTOM.params, Vl: 3.6 }, CUSTOM.window],
      [h2o.params, { ...h2o.window, pmin: 0.001, pmax: 0.5 }],
    ];
    for (const [params, window] of cases) {
      const e = exaggerated(params, window);
      expect(e.factor).toBe(1);
      expect(e.params).toBe(params);
    }
  });

  it("formats the factor to two significant figures", () => {
    expect([formatFactor(6441.2), formatFactor(27.04), formatFactor(1.12)]).toEqual([
      "×6,400",
      "×27",
      "×1.1",
    ]);
  });
});

describe("store: the model the plots draw", () => {
  it("is the substance while the view is off, and the exaggerated model while it is on", () => {
    const store = new Store(h2o);
    expect(store.state.model).toBe(h2o.params);
    expect(store.state.exaggeration).toBeGreaterThan(1000);
    store.setExaggerateSl(true);
    expect(store.state.params).toBe(h2o.params);
    expect(store.state.model.stretch?.phase).toBe("s");
    // A new substance brings its own model and factor.
    store.setSubstance(co2.params, co2.window, { resetCuts: true });
    expect(store.state.model.stretch?.phase).toBe("l");
    expect(store.state.exaggeration).toBe(exaggerated(co2.params, co2.window).factor);
    store.setExaggerateSl(false);
    expect(store.state.model).toBe(co2.params);
  });
});
