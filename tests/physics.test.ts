import { describe, expect, it } from "vitest";
import { boundary, PAIRS, type BoundarySegment, type PhasePair } from "../src/physics/boundaries";
import { crossings, cutLimits, stableCrossing, type Cut } from "../src/physics/crossings";
import {
  entropy,
  gibbs,
  PHASES,
  stablePhase,
  thirdPhase,
  tripleEntropy,
  triplePoint,
  volume,
  type Params,
  type Phase,
  type PlotWindow,
} from "../src/physics/gibbs";
import { exaggerated } from "../src/physics/exaggerate";
import { CUSTOM, PRESETS } from "../src/physics/presets";
import { bisect, findRoots } from "../src/physics/roots";
import { validate, type ValidityCheck } from "../src/physics/validity";

const presets = Object.entries(PRESETS);
const { h2o, co2 } = PRESETS;

/**
 * A window above 250 K for H₂O, where c_p,s = 200 J/(mol·K) breaks the single-crossing check
 * alone; in the preset's window, which reaches 200 K, it also makes S_s negative.
 */
const WARM: PlotWindow = { Tmin: 250, Tmax: 400, pmin: 0.1, pmax: 200 };

/** H₂O with c_p = 0, to check the model without its heat-capacity terms. */
const noCp: Params = { ...h2o.params, cp: { s: 0, l: 0, v: 0 } };

/** The span of G over the window, the scale for "1e-9 relative" on G. */
function gScale(params: Params, window: PlotWindow): number {
  return (tripleEntropy("v", params) * (window.Tmax - window.Tmin)) / 1000;
}

function allPoints(segments: BoundarySegment[]) {
  return segments.flatMap((seg) => seg.points);
}

describe("gibbs", () => {
  it.each(presets)("%s: G_s = G_l = G_v = 0 at the triple point", (_, { params }) => {
    const { T, p } = triplePoint(params);
    expect([T, p]).toEqual([params.Tt, params.pt]);
    for (const phase of PHASES) expect(gibbs(phase, T, p, params)).toBe(0);
  });

  it.each([
    ["H₂O", h2o.params, h2o.window],
    ["CO₂", co2.params, co2.window],
    ["H₂O with c_p = 0", noCp, h2o.window],
  ] as const)("%s: ∂G/∂T = −S and ∂G/∂p = V by finite differences", (_, params, window) => {
    const { Tmin, Tmax, pmin, pmax } = window;
    const points = [
      [Tmin + 10, pmin * 3],
      [params.Tt, params.pt],
      [0.5 * (Tmin + Tmax), Math.sqrt(pmin * pmax)],
      [Tmax - 10, pmax / 2],
    ] as const;
    const hT = 1e-3;
    for (const phase of PHASES) {
      for (const [T, p] of points) {
        const hp = 1e-3 * p;
        const dGdT = (gibbs(phase, T + hT, p, params) - gibbs(phase, T - hT, p, params)) / (2 * hT);
        const dGdp = (gibbs(phase, T, p + hp, params) - gibbs(phase, T, p - hp, params)) / (2 * hp);
        // G is in kJ/mol, S in J/(mol·K) and V in L/mol = J/(mol·kPa).
        expect(dGdT * 1000).toBeCloseTo(-entropy(phase, T, p, params), 4);
        expect((dGdp * 1000) / volume(phase, T, p, params)).toBeCloseTo(1, 4);
      }
    }
  });

  it("evaluates a cut element by element, with either argument as the array", () => {
    const params = h2o.params;
    const Ts = Float64Array.from([250, 300, 350]);
    const ps = Float64Array.from([10, 50, 100]);
    const alongT = gibbs("v", Ts, 80, params);
    const alongP = gibbs("l", 320, ps, params);
    Ts.forEach((T, k) => expect(alongT[k]).toBe(gibbs("v", T, 80, params)));
    ps.forEach((p, k) => expect(alongP[k]).toBe(gibbs("l", 320, p, params)));
    expect(() => gibbs("s", Ts, Float64Array.from([1, 2]), params)).toThrow();
  });

  it("orders the triple-point entropies S_v > S_l > S_s", () => {
    const params = h2o.params;
    expect(tripleEntropy("l", params) - tripleEntropy("s", params)).toBeCloseTo(
      (1000 * params.dHfus) / params.Tt,
      12,
    );
    expect(tripleEntropy("v", params)).toBeGreaterThan(tripleEntropy("l", params));
    expect(tripleEntropy("l", params)).toBeGreaterThan(tripleEntropy("s", params));
  });
});

describe("stablePhase", () => {
  it("H₂O: ice, water and steam where they belong", () => {
    const { params } = h2o;
    expect(stablePhase(260, 101.325, params)).toBe("s");
    expect(stablePhase(300, 101.325, params)).toBe("l");
    expect(stablePhase(380, 101.325, params)).toBe("v");
    expect(stablePhase(260, 0.1, params)).toBe("v");
    // The s-l line slopes back: at 200 kPa the ice melts just below 273.15 K.
    expect(stablePhase(params.Tt - 0.005, 200, params)).toBe("l");
  });

  it("CO₂: no liquid at 1 atm, liquid above the triple point", () => {
    const { params } = co2;
    expect(stablePhase(190, 101.325, params)).toBe("s");
    expect(stablePhase(200, 101.325, params)).toBe("v");
    expect(stablePhase(240, 3000, params)).toBe("l");
    // The s-l line slopes forward: just above T_tp at 5 MPa it is still solid.
    expect(stablePhase(params.Tt + 0.5, 5000, params)).toBe("s");
  });

  // On the log p axis: about 43 % s, 10 % l, 46 % v for H₂O and 44 % s, 10 % l,
  // 46 % v for CO₂.
  it.each([
    ["H₂O", h2o, { s: 0.43, l: 0.1, v: 0.46 }],
    ["CO₂", co2, { s: 0.44, l: 0.1, v: 0.46 }],
  ] as const)("%s: all three regions are visible in the window", (_, { params, window }, area) => {
    const counts: Record<Phase, number> = { s: 0, l: 0, v: 0 };
    const n = 200;
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < n; b++) {
        const T = window.Tmin + ((a + 0.5) / n) * (window.Tmax - window.Tmin);
        const p = window.pmin * (window.pmax / window.pmin) ** ((b + 0.5) / n);
        counts[stablePhase(T, p, params)]++;
      }
    }
    for (const phase of PHASES) expect(counts[phase] / n ** 2).toBeCloseTo(area[phase], 2);
  });
});

/** The T of the stable crossing of `pair` along the isobar at p, in a wide window. */
function transitionT(params: Params, pair: PhasePair, p: number): number {
  const wide: PlotWindow = { Tmin: 100, Tmax: 450, pmin: 1e-4, pmax: 1e4 };
  const c = stableCrossing({ kind: "isobar", p }, pair, params, wide);
  if (!c) throw new Error(`no stable ${pair.join("-")} crossing at ${p} kPa`);
  return c.T;
}

/** The p of the stable crossing of `pair` along the isotherm at T, in a wide window. */
function transitionP(params: Params, pair: PhasePair, T: number): number {
  const wide: PlotWindow = { Tmin: 100, Tmax: 450, pmin: 1e-4, pmax: 1e4 };
  const c = stableCrossing({ kind: "isotherm", T }, pair, params, wide);
  if (!c) throw new Error(`no stable ${pair.join("-")} crossing at ${T} K`);
  return c.p;
}

// The model against the reference data, with the agreed tolerances.
describe("reference data", () => {
  const within = (value: number, reference: number, relative: number) =>
    expect(Math.abs(value / reference - 1)).toBeLessThan(relative);

  it("H₂O: boiling and melting points at 1 atm", () => {
    expect(Math.abs(transitionT(h2o.params, ["l", "v"], 101.325) - 373.12)).toBeLessThan(1);
    expect(Math.abs(transitionT(h2o.params, ["s", "l"], 101.325) - 273.152)).toBeLessThan(0.01);
  });

  it("H₂O: vapor pressure of water and of ice within 3 %", () => {
    within(transitionP(h2o.params, ["l", "v"], 298.15), 3.17, 0.03);
    within(transitionP(h2o.params, ["l", "v"], 353.15), 47.4, 0.03);
    within(transitionP(h2o.params, ["s", "v"], 253.15), 0.1035, 0.03);
  });

  it("CO₂: sublimation point at 1 atm within 2 K, vapor pressure at 233 K within 10 %", () => {
    expect(Math.abs(transitionT(co2.params, ["s", "v"], 101.325) - 194.69)).toBeLessThan(2);
    within(transitionP(co2.params, ["l", "v"], 233), 1000, 0.1);
  });

  it("CO₂: melting point at 5 MPa, which V_s is fitted to", () => {
    expect(Math.abs(transitionT(co2.params, ["s", "l"], 5000) - 217.55)).toBeLessThan(0.01);
  });

  // S in J/(mol·K) over V in L/mol gives kPa/K.
  it.each([
    ["H₂O", h2o.params, -13.5e3],
    ["CO₂", co2.params, 4.7e3],
  ] as const)("%s: the s-l slope at the triple point is %s kPa/K to 2 %", (_, params, slope) => {
    const dS = tripleEntropy("l", params) - tripleEntropy("s", params);
    within(dS / (params.Vl - params.Vs), slope, 0.02);
  });
});

describe("boundary", () => {
  const cases = [
    ...presets.map(([id, { params, window }]) => [id, params, window] as const),
    ["H₂O with c_p = 0", noCp, h2o.window] as const,
  ];

  it.each(cases)("%s: the two G values agree on every boundary point", (_, params, window) => {
    const tol = 1e-9 * gScale(params, window);
    for (const [i, j] of PAIRS) {
      const points = allPoints(boundary(i, j, params, window));
      expect(points.length).toBeGreaterThan(10);
      for (const { T, p } of points) {
        expect(Math.abs(gibbs(i, T, p, params) - gibbs(j, T, p, params))).toBeLessThan(tol);
      }
    }
  });

  it.each(cases)(
    "%s: points stay in the window and lines end on its edges",
    (_, params, window) => {
      const eps = 1e-9;
      const onEdge = ({ T, p }: { T: number; p: number }) =>
        Math.abs(T - window.Tmin) < eps ||
        Math.abs(T - window.Tmax) < eps ||
        Math.abs(p - window.pmin) < eps ||
        Math.abs(p - window.pmax) < eps;
      for (const [i, j] of PAIRS) {
        const segments = boundary(i, j, params, window);
        for (const { T, p } of allPoints(segments)) {
          expect(T).toBeGreaterThanOrEqual(window.Tmin - eps);
          expect(T).toBeLessThanOrEqual(window.Tmax + eps);
          expect(p).toBeGreaterThanOrEqual(window.pmin - eps);
          expect(p).toBeLessThanOrEqual(window.pmax + eps);
        }
        const ends = segments.flatMap((seg) => [seg.points[0], seg.points.at(-1)]);
        // Each line has two ends on the window edge; the others are the triple-point split.
        expect(ends.filter((pt) => pt && onEdge(pt)).length).toBe(2);
      }
    },
  );

  it.each(cases)(
    "%s: stable parts lie below the third phase, metastable above",
    (_, params, window) => {
      for (const [i, j] of PAIRS) {
        const k = thirdPhase(i, j);
        const segments = boundary(i, j, params, window);
        expect(segments.map((seg) => seg.stable).sort()).toEqual([false, true]);
        for (const seg of segments) {
          // Skip the split point itself, where all three G tie.
          for (const { T, p } of seg.points.slice(1, -1)) {
            const margin = gibbs(k, T, p, params) - gibbs(i, T, p, params);
            if (seg.stable) expect(margin).toBeGreaterThan(0);
            else expect(margin).toBeLessThan(0);
          }
        }
      }
    },
  );

  it.each(cases)(
    "%s: the stable and metastable parts meet at the triple point",
    (_, params, window) => {
      for (const [i, j] of PAIRS) {
        const [first, second] = boundary(i, j, params, window);
        const join = first?.points.at(-1);
        expect(join).toEqual(second?.points[0]);
        expect(join?.T).toBeCloseTo(params.Tt, 6);
        expect((join?.p as number) / params.pt).toBeCloseTo(1, 8);
      }
    },
  );

  it.each(cases)("%s: slopes at the triple point match Clapeyron ΔS/ΔV", (_, params) => {
    const { Tt, pt } = params;
    // About as tall as wide on the scale of the steep s-l line, so every line crosses it.
    const tiny: PlotWindow = {
      Tmin: Tt - 1e-4,
      Tmax: Tt + 1e-4,
      pmin: pt * (1 - 1e-4),
      pmax: pt * (1 + 1e-4),
    };
    for (const [i, j] of PAIRS) {
      const points = allPoints(boundary(i, j, params, tiny));
      const a = points[0];
      const b = points.at(-1);
      if (!a || !b) throw new Error(`no ${i}-${j} boundary near the triple point`);
      const slope = (b.p - a.p) / (b.T - a.T);
      // S in J/(mol·K) over V in L/mol gives kPa/K.
      const dS = tripleEntropy(j, params) - tripleEntropy(i, params);
      const dV = volume(j, Tt, pt, params) - volume(i, Tt, pt, params);
      expect(slope / (dS / dV)).toBeCloseTo(1, 4);
    }
  });

  it("the s-l line slopes back for H₂O and forward for CO₂", () => {
    const slope = (params: Params, window: PlotWindow) =>
      boundary("s", "l", params, window).map((seg) => {
        const a = seg.points[0];
        const b = seg.points.at(-1);
        if (!a || !b) throw new Error("empty segment");
        return (b.p - a.p) / (b.T - a.T);
      });
    // About −13.5 MPa/K and +4.7 MPa/K, bent a little by the c_p terms away from T_tp.
    for (const s of slope(h2o.params, h2o.window)) expect(s / -13.5e3).toBeCloseTo(1, 1);
    for (const s of slope(co2.params, co2.window)) expect(s / 4.7e3).toBeCloseTo(1, 1);
  });

  it("samples the s-l line evenly in log p", () => {
    const points = allPoints(boundary("s", "l", h2o.params, h2o.window));
    const decades = points.map((q) => Math.log10(q.p));
    const steps = decades.slice(1).map((d, k) => d - (decades[k] as number));
    // Apart from the edge and triple-point points, the steps are equal on the log axis.
    const typical = steps.sort((a, b) => a - b)[Math.floor(steps.length / 2)] as number;
    expect(steps.filter((d) => Math.abs(d / typical - 1) < 1e-6).length).toBeGreaterThan(
      0.9 * steps.length,
    );
  });

  it("rejects a boundary of a phase with itself", () => {
    expect(() => boundary("s", "s", h2o.params, h2o.window)).toThrow();
  });

  it("CO₂: a stable s-l line that leaves through T_max ends exactly on that edge", () => {
    // The s-l line leans forward, past 216.8 K at about 1.5 MPa, well below p_max.
    const window: PlotWindow = { ...co2.window, Tmax: 216.8 };
    const stable = boundary("s", "l", co2.params, window).filter((seg) => seg.stable);
    expect(stable).toHaveLength(1);
    const end = stable[0]!.points.at(-1)!;
    expect(end.T).toBeCloseTo(window.Tmax, 9);
    expect(end.p).toBeLessThan(0.9 * window.pmax);
    const tol = 1e-9 * gScale(co2.params, window);
    expect(
      Math.abs(gibbs("s", end.T, end.p, co2.params) - gibbs("l", end.T, end.p, co2.params)),
    ).toBeLessThan(tol);
  });

  it("an l-v line that leaves through p_max and comes back is traced as two runs", () => {
    // A large c_p,l bends the l-v line over: it peaks at about 58.7 kPa near 350 K, above p_max,
    // and leaves through p_max at about 317 K and comes back at about 388 K.
    const params: Params = { ...CUSTOM.params, dHvap: 5, cp: { s: 0, l: 100, v: 0 } };
    const window: PlotWindow = { Tmin: 200, Tmax: 400, pmin: 3, pmax: 55 };
    const points = allPoints(boundary("l", "v", params, window));
    const onTop = points.filter((q) => Math.abs(q.p - window.pmax) < 1e-9 * window.pmax);
    // Where the line leaves through p_max, and where it comes back in.
    expect(onTop).toHaveLength(2);
    const [out, back] = onTop.map((q) => q.T).sort((a, b) => a - b) as [number, number];
    expect(out).toBeLessThan(350);
    expect(back).toBeGreaterThan(350);
    // Nothing is drawn in between, where the line lies above the window.
    expect(points.filter((q) => q.T > out && q.T < back)).toEqual([]);
    for (const { p } of points) expect(p).toBeLessThanOrEqual(window.pmax);
    expect(points.at(-1)!.T).toBe(window.Tmax);
  });
});

describe("roots", () => {
  it("bisect without a sign change stays inside [a, b], so callers check the signs first", () => {
    const x = bisect((u) => u * u + 1, -1, 2);
    expect(x).toBeGreaterThanOrEqual(-1);
    expect(x).toBeLessThanOrEqual(2);
  });

  it("findRoots counts an exact zero on a grid point once", () => {
    // The grid is −1, −0.5, 0, 0.5, 1: the root at 0 is a grid point.
    expect(findRoots((x) => x, -1, 1, 4)).toEqual([0]);
    expect(findRoots((x) => x - 1, -1, 1, 4)).toEqual([1]);
    expect(findRoots((x) => (x + 0.5) * (x - 0.5), -1, 1, 4)).toEqual([-0.5, 0.5]);
  });

  it("findRoots takes NaN for neither a root nor a sign change", () => {
    const f = (x: number) => (x < 0 ? Number.NaN : x - 0.3);
    const roots = findRoots(f, -1, 1, 8);
    expect(roots).toHaveLength(1);
    expect(roots[0]).toBeCloseTo(0.3, 12);
    expect(findRoots(() => Number.NaN, 0, 1, 8)).toEqual([]);
  });
});

describe("crossings", () => {
  it("stableCrossing finds the stable crossing of one pair, or nothing", () => {
    const isobar: Cut = { kind: "isobar", p: 10 };
    const lv = stableCrossing(isobar, ["l", "v"], h2o.params, h2o.window);
    expect(lv).toEqual(
      crossings(isobar, h2o.params, h2o.window).find(
        (c) => c.stable && c.phases.join("-") === "l-v",
      ),
    );
    // Water boils at about 319 K under 10 kPa.
    expect(lv?.T).toBeGreaterThan(315);
    expect(lv?.T).toBeLessThan(323);
    // Above p_tp the s-v crossing of water is metastable, so there is no stable one.
    expect(stableCrossing(isobar, ["s", "v"], h2o.params, h2o.window)).toBeUndefined();
  });

  it.each(presets)(
    "%s: cuts through the triple point have all three crossings there",
    (_, { params, window }) => {
      const cuts: Cut[] = [
        { kind: "isobar", p: params.pt },
        { kind: "isotherm", T: params.Tt },
      ];
      for (const cut of cuts) {
        const found = crossings(cut, params, window);
        expect(found.map((c) => c.phases.join("-")).sort()).toEqual(["l-v", "s-l", "s-v"]);
        for (const c of found) {
          expect(c.T).toBeCloseTo(params.Tt, 9);
          expect(c.p).toBeCloseTo(params.pt, 9);
          expect(c.stable).toBe(true);
        }
      }
    },
  );

  it.each(presets)(
    "%s: crossings lie on the G curves, sorted, and flag the envelope",
    (_, { params, window }) => {
      const tol = 1e-9 * gScale(params, window);
      const cuts: Cut[] = [
        { kind: "isobar", p: Math.sqrt(window.pmin * params.pt) },
        { kind: "isobar", p: Math.sqrt(params.pt * window.pmax) },
        { kind: "isotherm", T: params.Tt - 10 },
        { kind: "isotherm", T: params.Tt + 20 },
      ];
      for (const cut of cuts) {
        const found = crossings(cut, params, window);
        expect(found.some((c) => c.stable)).toBe(true);
        const xs = found.map((c) => (cut.kind === "isobar" ? c.T : c.p));
        expect(xs).toEqual([...xs].sort((a, b) => a - b));
        for (const { phases, T, p, stable } of found) {
          const [i, j] = phases;
          expect(Math.abs(gibbs(i, T, p, params) - gibbs(j, T, p, params))).toBeLessThan(tol);
          // A stable crossing is a real transition: the stable phase on either side is i or j.
          const h = cut.kind === "isobar" ? [1e-6, 0] : [0, 1e-7 * p];
          const sides = [
            stablePhase(T - (h[0] as number), p - (h[1] as number), params),
            stablePhase(T + (h[0] as number), p + (h[1] as number), params),
          ].sort();
          if (stable) expect(sides).toEqual([...phases].sort());
          else expect(sides.every((ph) => ph === thirdPhase(i, j))).toBe(true);
        }
      }
    },
  );

  it("gives no crossing for pairs that do not cross inside the window", () => {
    // Liquid water only, between 280 and 350 K at 1 atm.
    const narrow: PlotWindow = { Tmin: 280, Tmax: 350, pmin: 50, pmax: 250 };
    expect(crossings({ kind: "isobar", p: 101.325 }, h2o.params, narrow)).toEqual([]);
  });

  it("finds a crossing at the low-p end of a window several decades wide", () => {
    // Scanned in log p, the s-v crossing near p_min is not lost between linear steps.
    const wide: PlotWindow = { ...h2o.window, pmin: 1e-3, Tmin: 230 };
    const found = crossings({ kind: "isotherm", T: 240 }, h2o.params, wide);
    const sv = found.find((c) => c.stable && c.phases.join("-") === "s-v");
    expect(sv?.p).toBeGreaterThan(0.02);
    expect(sv?.p).toBeLessThan(0.04);
  });
});

describe("validate", () => {
  it.each(presets)("%s passes every check", (_, { params, window }) => {
    expect(validate(params, window)).toEqual([]);
  });

  it("Custom's schematic starting point passes every check, with a forward s-l slope", () => {
    expect(validate(CUSTOM.params, CUSTOM.window)).toEqual([]);
    const [seg] = boundary("s", "l", CUSTOM.params, CUSTOM.window);
    const a = seg!.points[0]!;
    const b = seg!.points.at(-1)!;
    // ΔS_fus/ΔV_fus = (2490/300 J/(mol·K)) / (1.5 L/mol) ≈ +5.5 kPa/K.
    expect((b.p - a.p) / (b.T - a.T)).toBeCloseTo(5.53, 1);
  });

  it("passes the c_p = 0 fixture that the boundary tests use", () => {
    expect(validate(noCp, h2o.window)).toEqual([]);
  });

  const broken: [ValidityCheck, (params: Params, window: PlotWindow) => void][] = [
    ["finite", (params) => (params.Vs = Number.NaN)],
    ["triplePoint", (params) => (params.pt = 0)],
    ["dHfus", (params) => (params.dHfus = -1)],
    ["dHvap", (params) => (params.dHvap = 0)],
    ["volume", (params) => (params.Vl = 0)],
    ["Tmin", (_, window) => (window.Tmin = 0)],
    ["pmin", (_, window) => (window.pmin = 0)],
    ["window", (_, window) => (window.pmax = window.pmin)],
    // T_tp = 273.16 K lies under T_min.
    ["tripleInWindow", (_, window) => (window.Tmin = 280)],
    // S_s(200 K) = 0 + 37.77 ln(200/273.16) < 0.
    ["entropy", (params) => (params.Ss = 0)],
    // 3 · 0.0197 L/mol · 40 MPa = 2358 J/mol > R · 200 K = 1663 J/mol.
    ["vaporDensity", (_, window) => (window.pmax = 40000)],
    // c_p,s = 200 J/(mol·K) bends the s-l line back into a window above 250 K.
    [
      "singleCrossing",
      (params, window) => {
        params.cp.s = 200;
        Object.assign(window, WARM);
      },
    ],
    // The s-v line meets T_min = 200 K at 1.6e-4 kPa.
    ["sublimationEdge", (_, window) => (window.pmin = 1e-4)],
    // The l-v line meets T_max = 350 K at 41.3 kPa.
    ["vaporizationEdge", (_, window) => (window.pmax = 50)],
  ];

  it.each(broken)("rejects parameters that break %s", (check, mutate) => {
    const params = structuredClone(h2o.params);
    const window = { ...h2o.window };
    mutate(params, window);
    const issues = validate(params, window);
    expect(issues.map((issue) => issue.check)).toContain(check);
    for (const issue of issues) expect(issue.message).not.toBe("");
  });

  // The s-v line meets T_min at 1.6e-4 kPa (H₂O) and 3.91 kPa (CO₂). A p_min under that breaks
  // only this check, and lowering T_min (to where the s-v line lies under p_min) fixes it too.
  it.each([
    ["H₂O", h2o, 1e-4, 190],
    ["CO₂", co2, 3, 150],
  ] as const)(
    "%s: the s-v line must leave the window through p_min, not T_min",
    (_, { params, window }, pmin, Tmin) => {
      const low = { ...window, pmin };
      expect(validate(params, low).map((issue) => issue.check)).toEqual(["sublimationEdge"]);
      expect(validate(params, { ...low, Tmin })).toEqual([]);
      // In the presets the stable s-v line starts on the p_min edge, above T_min.
      const start = boundary("s", "v", params, window).find((seg) => seg.stable)!.points[0]!;
      expect(start.p).toBe(window.pmin);
      expect(start.T).toBeGreaterThan(window.Tmin + 1);
    },
  );

  // The l-v line meets T_max at 41.3 kPa (H₂O) and 2.87 MPa (CO₂). A p_max over that breaks only
  // this check, and raising T_max (to where the l-v line lies above p_max) fixes it too.
  it.each([
    ["H₂O", h2o, 50, 360],
    ["CO₂", co2, 3000, 285],
  ] as const)(
    "%s: the l-v line must leave the window through p_max, not T_max",
    (_, { params, window }, pmax, Tmax) => {
      const high = { ...window, pmax };
      expect(validate(params, high).map((issue) => issue.check)).toEqual(["vaporizationEdge"]);
      expect(validate(params, { ...high, Tmax })).toEqual([]);
      // In the presets the stable l-v line ends on the p_max edge, below T_max.
      const lv = boundary("l", "v", params, window).find((seg) => seg.stable)!.points;
      const end = lv.reduce((a, b) => (b.T > a.T ? b : a));
      expect(end.p).toBe(window.pmax);
      expect(end.T).toBeLessThan(window.Tmax - 1);
    },
  );

  it("the single-crossing example breaks only that check", () => {
    const params = structuredClone(h2o.params);
    params.cp.s = 200;
    expect(validate(params, WARM).map((issue) => issue.check)).toEqual(["singleCrossing"]);
  });
});

describe("cutLimits", () => {
  // Where the s-v line meets p_min and the l-v line meets p_max.
  it.each([
    ["H₂O", h2o, 234.5, 338.3],
    ["CO₂", co2, 193.3, 268.7],
  ] as const)(
    "%s: isobars reach the whole window, isotherms from the s-v foot to the l-v top",
    (_, { params, window }, Tlo, Thi) => {
      const limits = cutLimits(params, window);
      expect(limits.isobar).toEqual([window.pmin, window.pmax]);
      expect(limits.isotherm[0]).toBeCloseTo(Tlo, 1);
      expect(limits.isotherm[1]).toBeCloseTo(Thi, 1);
    },
  );

  it.each(presets)("%s: every cut inside the limits meets a stable boundary", (_, preset) => {
    const { params, window } = preset;
    const limits = cutLimits(params, window);
    const stable = (cut: Cut) => crossings(cut, params, window).some((c) => c.stable);
    for (let k = 0; k <= 200; k++) {
      const p = limits.isobar[0] * (limits.isobar[1] / limits.isobar[0]) ** (k / 200);
      expect(stable({ kind: "isobar", p })).toBe(true);
      const [lo, hi] = limits.isotherm;
      // The ends included: there the cut meets the line right next to the window edge.
      expect(stable({ kind: "isotherm", T: lo + ((hi - lo) * k) / 200 })).toBe(true);
    }
    // Just outside them, no isotherm does.
    for (const T of [limits.isotherm[0] - 0.5, limits.isotherm[1] + 0.5]) {
      expect(stable({ kind: "isotherm", T })).toBe(false);
    }
  });

  it.each(presets)(
    "%s: the cuts at the limits meet a boundary in the exaggerated view too",
    (_, preset) => {
      const model = exaggerated(preset.params, preset.window).params;
      const limits = cutLimits(model, preset.window);
      for (const T of limits.isotherm) {
        const found = crossings({ kind: "isotherm", T }, model, preset.window);
        expect(found.some((c) => c.stable)).toBe(true);
      }
    },
  );

  it("is the whole window when no stable boundary lies in it", () => {
    // Vapor only, far above the l-v line.
    const hot: PlotWindow = { Tmin: 400, Tmax: 500, pmin: 0.01, pmax: 30 };
    expect(cutLimits(h2o.params, hot)).toEqual({ isobar: [0.01, 30], isotherm: [400, 500] });
  });
});
