import { tickStep } from "d3";
import { describe, expect, it } from "vitest";
import { boundary, PAIRS, type Point } from "../src/physics/boundaries";
import { crossings, alongRange, pointOnCut, type Cut } from "../src/physics/crossings";
import {
  G_TIE,
  gibbs,
  PHASES,
  stablePhase,
  type Params,
  type PlotWindow,
} from "../src/physics/gibbs";
import { PRESETS } from "../src/physics/presets";
import {
  apply,
  blendMatrix,
  compose,
  cutValueAt,
  cutY,
  frameBottomRight,
  frameTopRight,
  fromScreen,
  IDENTITY,
  invert,
  lerpAffine,
  plotHeight,
  plotWidth,
  projection,
  RasterCache,
  rasterPhases,
  toScreen,
  type PlotSize,
} from "../src/ui/geometry";
import {
  matchPreset,
  readoutRows,
  substanceFrom,
  substanceValues,
} from "../src/ui/substanceFields";
import { cutAfterKey } from "../src/ui/cutDrag";
import {
  extremeWithin,
  phaseLabels,
  placeNote,
  poleOfInaccessibility,
  spreadApart,
} from "../src/ui/labels";
import {
  alongCut,
  gCentre,
  gDomain,
  gHalfSpan,
  relativeG,
  sliceSegments,
} from "../src/physics/slice";
import {
  cutBounds,
  cutFor,
  cutOf,
  defaultCuts,
  fromCutAxis,
  Store,
  toCutAxis,
  type Mode,
  type State,
} from "../src/ui/state";
import { formatPressure, formatValue } from "../src/ui/units";

const { h2o, co2 } = PRESETS;
const win: PlotWindow = h2o.window;
const size: PlotSize = { width: 640, height: 400 };
const MODES: readonly Mode[] = ["isobar", "isotherm"];

describe("state", () => {
  it.each(Object.entries(PRESETS))("%s: the default cuts lie inside the limits", (_, preset) => {
    const cuts = defaultCuts(preset.params, preset.window);
    const { limits } = new Store(preset).state;
    for (const mode of MODES) {
      const [lo, hi] = limits[mode];
      expect(cuts[mode]).toBeGreaterThan(lo);
      expect(cuts[mode]).toBeLessThan(hi);
    }
  });

  it("holds the isotherm to the T range where it meets a boundary", () => {
    const store = new Store(h2o, "isotherm");
    const [lo, hi] = store.state.limits.isotherm;
    expect(lo).toBeGreaterThan(win.Tmin + 30);
    expect(hi).toBeLessThan(win.Tmax - 5);
    store.setCut(win.Tmin);
    expect(store.state.cuts.isotherm).toBe(lo);
    store.setCut(win.Tmax);
    expect(store.state.cuts.isotherm).toBe(hi);
    // The isobar still reaches the whole window.
    expect(store.state.limits.isobar).toEqual(cutBounds("isobar", win));
  });

  it("keeps both cuts inside the limits through substance changes and the exaggerated view", () => {
    const store = new Store(h2o, "isotherm");
    store.setCut(win.Tmax);
    for (const step of [
      () => store.setSubstance(co2.params, co2.window),
      () => store.setExaggerateSl(true),
      () => store.setExaggerateSl(false),
      () => store.setSubstance(h2o.params, h2o.window),
    ]) {
      step();
      for (const mode of MODES) {
        const [lo, hi] = store.state.limits[mode];
        expect(store.state.cuts[mode]).toBeGreaterThanOrEqual(lo);
        expect(store.state.cuts[mode]).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("keeps the current cut's crossings with the model, and the same array while they hold", () => {
    const store = new Store(h2o);
    const expected = (s: Readonly<State>) => crossings(cutOf(s), s.model, s.window);
    expect(store.state.crossings).toEqual(expected(store.state));
    for (const step of [
      () => store.setCut(12),
      () => store.toggleMode(),
      () => store.setCut(250),
      () => store.setExaggerateSl(true),
      () => store.setSubstance(co2.params, co2.window, { resetCuts: true }),
    ]) {
      step();
      expect(store.state.crossings).toEqual(expected(store.state));
    }
    const { crossings: before } = store.state;
    store.setShowMetastable(false);
    store.setPressureUnit("bar");
    expect(store.state.crossings).toBe(before);
  });

  it("each mode keeps its own cut position across toggles", () => {
    const store = new Store(h2o);
    store.setCut(12);
    store.toggleMode();
    expect(store.state.mode).toBe("isotherm");
    store.setCut(250);
    store.toggleMode();
    expect(cutOf(store.state)).toEqual({ kind: "isobar", p: 12 });
    store.toggleMode();
    expect(cutOf(store.state)).toEqual({ kind: "isotherm", T: 250 });
  });

  it("clamps the cut into the window and ignores values that are not numbers", () => {
    const store = new Store(h2o);
    store.setCut(1e6);
    expect(store.state.cuts.isobar).toBe(win.pmax);
    store.setCut(-5);
    expect(store.state.cuts.isobar).toBe(win.pmin);
    store.setCut(Number.NaN);
    expect(store.state.cuts.isobar).toBe(win.pmin);
  });

  it("notifies listeners with the previous state, only on real changes", () => {
    const store = new Store(h2o);
    const calls: [Readonly<State>, Readonly<State>][] = [];
    const unsubscribe = store.subscribe((state, prev) => calls.push([state, prev]));
    store.setMode("isobar");
    store.setCut(store.state.cuts.isobar);
    expect(calls).toHaveLength(0);
    store.toggleMode();
    expect(calls).toHaveLength(1);
    const [[state, prev]] = calls as [[Readonly<State>, Readonly<State>]];
    expect([prev.mode, state.mode]).toEqual(["isobar", "isotherm"]);
    expect(state.cuts).toBe(prev.cuts);
    unsubscribe();
    store.toggleMode();
    expect(calls).toHaveLength(1);
  });
});

describe("store: substance, snap and metastable toggle", () => {
  it("a new preset resets both cuts to its defaults", () => {
    const store = new Store(h2o);
    store.setCut(13);
    store.setSubstance(co2.params, co2.window, { resetCuts: true });
    expect(store.state.params).toBe(co2.params);
    expect(store.state.cuts).toEqual(defaultCuts(co2.params, co2.window));
  });

  it("an edit keeps each mode's cut, clamped into the new window", () => {
    const store = new Store(h2o);
    store.setCut(25);
    store.toggleMode();
    store.setCut(260);
    store.setSubstance(h2o.params, { ...win, pmax: 15, Tmin: 270 });
    expect(store.state.cuts).toEqual({ isobar: 15, isotherm: 270 });
    expect(store.state.mode).toBe("isotherm");
  });

  it.each(MODES)("%s: snapping puts the cut through the triple point", (mode) => {
    const store = new Store(h2o, mode);
    const other = store.state.cuts[mode === "isobar" ? "isotherm" : "isobar"];
    store.snapToTriplePoint();
    expect(store.state.cuts[mode]).toBe(mode === "isobar" ? h2o.params.pt : h2o.params.Tt);
    expect(store.state.cuts[mode === "isobar" ? "isotherm" : "isobar"]).toBe(other);
    // All three pairs cross there.
    const found = crossings(cutOf(store.state), h2o.params, win);
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it("the exaggerated s-l view is off at first and notifies only on a change", () => {
    const store = new Store(h2o);
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.state.exaggerateSl).toBe(false);
    store.setExaggerateSl(false);
    store.setExaggerateSl(true);
    expect([store.state.exaggerateSl, calls]).toEqual([true, 1]);
  });

  it("the metastable toggle notifies only on a change", () => {
    const store = new Store(h2o);
    let calls = 0;
    store.subscribe(() => calls++);
    expect(store.state.showMetastable).toBe(true);
    store.setShowMetastable(true);
    store.setShowMetastable(false);
    expect([store.state.showMetastable, calls]).toEqual([false, 1]);
  });
});

describe("controls", () => {
  it.each(Object.entries(PRESETS))(
    "%s: the field values round-trip and match their preset",
    (id, { params, window }) => {
      const values = substanceValues(params, window);
      expect(substanceFrom(values)).toEqual({ params, window });
      expect(matchPreset(params, window)).toBe(id);
    },
  );

  it("an edited substance matches no preset", () => {
    expect(matchPreset({ ...h2o.params, Vs: 3.4 }, win)).toBeNull();
    expect(matchPreset(h2o.params, { ...win, pmax: 149 })).toBeNull();
  });

  it("formats values to three significant figures", () => {
    expect([0.611654, 517.964, 5183.2, 100, 0.012345, 0].map(formatValue)).toEqual([
      "0.612",
      "518",
      "5180",
      "100",
      "0.0123",
      "0",
    ]);
  });

  it.each(MODES)("%s: the readout lists every crossing along the cut, in order", (mode) => {
    const store = new Store(h2o, mode);
    const rows = readoutRows(store.state);
    const found = crossings(cutOf(store.state), h2o.params, win);
    expect(rows.map((r) => [r.phases, r.stable])).toEqual(found.map((c) => [c.phases, c.stable]));
    expect(rows.map((r) => r.value)).toEqual(found.map((c) => (mode === "isobar" ? c.T : c.p)));
    expect(rows.map((r) => r.text)).toEqual(
      found.map((c) => (mode === "isobar" ? `${c.T.toFixed(1)} K` : formatPressure(c.p, "kPa"))),
    );
  });
});

describe("geometry", () => {
  it("affine helpers: invert, compose and lerp", () => {
    const m = [2, 0.5, -1, 3, 7, -4] as const;
    const roundTrip = compose(invert(m), m);
    roundTrip.forEach((v, k) => expect(v).toBeCloseTo(IDENTITY[k] as number, 12));
    expect(lerpAffine(IDENTITY, m, 0)).toEqual(IDENTITY);
    expect(lerpAffine(IDENTITY, m, 1)).toEqual(m);
    expect(() => invert([1, 1, 1, 1, 0, 0])).toThrow();
  });

  it("puts T across and p up for an isobar, p across and T up for an isotherm", () => {
    // The window edges land on the plot edges, to rounding.
    const at = (mode: Mode, T: number, p: number, x: number, y: number) => {
      const [px, py] = toScreen(projection(mode, win, size), T, p);
      expect(px).toBeCloseTo(x, 9);
      expect(py).toBeCloseTo(y, 9);
    };
    at("isobar", win.Tmin, win.pmin, 0, size.height);
    at("isobar", win.Tmax, win.pmax, size.width, 0);
    at("isobar", win.Tmax, win.pmin, size.width, size.height);
    at("isotherm", win.Tmin, win.pmin, 0, size.height);
    at("isotherm", win.Tmax, win.pmax, size.width, 0);
    at("isotherm", win.Tmax, win.pmin, 0, 0);
  });

  it("the swap matrix moves each point on a straight line from one mode's position to the other's", () => {
    const points = [
      [win.Tmin, win.pmin],
      [300, 50],
      [377, 12.5],
      [win.Tmax, win.pmax],
    ] as const;
    for (const [from, to] of [
      ["isobar", "isotherm"],
      ["isotherm", "isobar"],
    ] as const) {
      const p0 = projection(from, win, size);
      const p1 = projection(to, win, size);
      for (const t of [0, 0.37, 1]) {
        const m = blendMatrix(from, to, t, win, size);
        for (const [T, p] of points) {
          const [x0, y0] = toScreen(p0, T, p);
          const [x1, y1] = toScreen(p1, T, p);
          const [x, y] = apply(m, x0, y0);
          expect(x).toBeCloseTo(x0 + t * (x1 - x0), 9);
          expect(y).toBeCloseTo(y0 + t * (y1 - y0), 9);
        }
      }
    }
  });

  it.each(MODES)("%s: cutY and cutValueAt are inverses and match the projection", (mode) => {
    const [lo, hi] = cutBounds(mode, win);
    const inner = fromCutAxis(mode, 0.3 * toCutAxis(mode, lo) + 0.7 * toCutAxis(mode, hi));
    for (const value of [lo, inner, hi]) {
      const y = cutY(mode, value, win, size);
      expect(cutValueAt(mode, y, win, size)).toBeCloseTo(value, 9);
      const [T, p] = mode === "isobar" ? [win.Tmin, value] : [value, win.pmin];
      expect(toScreen(projection(mode, win, size), T, p)[1]).toBeCloseTo(y, 9);
    }
  });

  it("rasters the stable phase at each pixel centre", () => {
    const cols = 200;
    const rows = 149;
    const grid = rasterPhases(h2o.params, win, "isobar", cols, rows);
    const toTp = invert(projection("isobar", win, { width: cols, height: rows }));
    for (const [c, r] of [
      [0, 0],
      [57, 20],
      [120, 100],
      [199, 148],
    ] as const) {
      const [T, p] = fromScreen(toTp, c + 0.5, r + 0.5);
      expect(PHASES[grid[r * cols + c] as number]).toBe(stablePhase(T, p, h2o.params));
    }
    // Ice, steam and water at 10 or 1 kPa, and vapour at low p.
    const at = (T: number, p: number) => {
      const [x, y] = toScreen(projection("isobar", win, { width: cols, height: rows }), T, p);
      return PHASES[grid[Math.floor(y) * cols + Math.floor(x)] as number];
    };
    expect([at(220, 10), at(340, 1), at(300, 10), at(300, 0.5)]).toEqual(["s", "v", "l", "v"]);
  });

  it.each(Object.entries(PRESETS))(
    "%s: the isotherm raster is the transpose of the isobar raster",
    (_, { params, window }) => {
      const cols = 37;
      const rows = 23;
      const isobar = rasterPhases(params, window, "isobar", cols, rows);
      const isotherm = rasterPhases(params, window, "isotherm", rows, cols);
      // Isobar pixel (c, r) holds T from c and p from r (counted from the top); isotherm pixel
      // (c', r') holds p from c' and T from r'. The same (T, p) sits at c' = rows−1−r, r' = cols−1−c.
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          expect(isotherm[(cols - 1 - c) * rows + (rows - 1 - r)]).toBe(isobar[r * cols + c]);
        }
      }
    },
  );

  it("the raster cache finds each mode's grid once, and afresh for a new model, window or size", () => {
    const cache = new RasterCache();
    const isobar = cache.get(h2o.params, win, "isobar", 40, 20);
    const isotherm = cache.get(h2o.params, win, "isotherm", 40, 20);
    expect(isobar).toEqual(rasterPhases(h2o.params, win, "isobar", 40, 20));
    expect(isotherm).toEqual(rasterPhases(h2o.params, win, "isotherm", 40, 20));
    expect(cache.get(h2o.params, win, "isobar", 40, 20)).toBe(isobar);
    expect(cache.get(h2o.params, win, "isotherm", 40, 20)).toBe(isotherm);
    expect(cache.get(h2o.params, win, "isobar", 41, 20)).not.toBe(isobar);
    expect(cache.get(co2.params, co2.window, "isobar", 41, 20)).toEqual(
      rasterPhases(co2.params, co2.window, "isobar", 41, 20),
    );
    const wider = { ...win, Tmax: win.Tmax + 1 };
    expect(cache.get(h2o.params, wider, "isotherm", 40, 20)).toEqual(
      rasterPhases(h2o.params, wider, "isotherm", 40, 20),
    );
  });
});

/** Cuts of each mode across the window (isobars evenly in log p), and through the triple point. */
function sampleCuts(params: Params, window: PlotWindow): [Mode, Cut][] {
  const out: [Mode, Cut][] = [];
  for (const mode of MODES) {
    const [lo, hi] = cutBounds(mode, window);
    const values = [lo, hi, mode === "isobar" ? params.pt : params.Tt];
    const [u0, u1] = [toCutAxis(mode, lo), toCutAxis(mode, hi)];
    for (let k = 1; k < 12; k++) values.push(fromCutAxis(mode, u0 + ((u1 - u0) * k) / 12));
    for (const value of values) out.push([mode, cutFor(mode, { isobar: value, isotherm: value })]);
  }
  return out;
}

/** Distance in px from (x, y) to the polyline through `pts`. */
function distanceToPolyline(x: number, y: number, pts: [number, number][]): number {
  let best = Infinity;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k] as [number, number];
    const [bx, by] = pts[k + 1] as [number, number];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

describe("slice panel", () => {
  it("cutFor builds each mode's cut from its own position", () => {
    const cuts = { isobar: 80, isotherm: 310 };
    expect(cutFor("isobar", cuts)).toEqual({ kind: "isobar", p: 80 });
    expect(cutFor("isotherm", cuts)).toEqual({ kind: "isotherm", T: 310 });
  });

  it.each(Object.entries(PRESETS))(
    "%s: each G curve's runs cover the cut, and the solid runs are the lower envelope",
    (_, { params, window }) => {
      for (const [, cut] of sampleCuts(params, window)) {
        const [a, b] = alongRange(cut, window);
        const segments = sliceSegments(cut, params, window, { samples: 120 });
        for (const phase of PHASES) {
          const runs = segments.filter((s) => s.phase === phase);
          expect(runs[0]?.points[0]?.[0]).toBe(a);
          expect(runs[runs.length - 1]?.points.at(-1)?.[0]).toBe(b);
          // Consecutive runs alternate between stable and metastable and meet end to start.
          for (let k = 1; k < runs.length; k++) {
            const prev = runs[k - 1]!;
            const run = runs[k]!;
            expect(run.stable).toBe(!prev.stable);
            expect(run.points[0]).toEqual(prev.points.at(-1));
          }
          for (const run of runs) {
            for (const [x, G] of run.points) {
              const { T, p } = pointOnCut(cut, x);
              expect(G).toBe(relativeG(phase, T, p, params));
            }
            // Away from the run's ends, solid means lowest and dashed means not. A sample on the
            // triple point ties all three, so it is skipped.
            const inner = run.points.slice(1, -1);
            for (const [x, G] of inner) {
              const { T, p } = pointOnCut(cut, x);
              const others = PHASES.filter((q) => q !== phase).map((q) => gibbs(q, T, p, params));
              if (others.some((Gq) => Math.abs(Gq - G) <= G_TIE)) continue;
              expect(stablePhase(T, p, params) === phase).toBe(run.stable);
            }
          }
        }
      }
    },
  );

  it("the solid runs of two phases meet at each stable crossing", () => {
    const { params, window } = h2o;
    const cut: Cut = { kind: "isobar", p: 10 };
    const segments = sliceSegments(cut, params, window);
    const stableCrossings = crossings(cut, params, window).filter((c) => c.stable);
    expect(stableCrossings).toHaveLength(2);
    for (const c of stableCrossings) {
      const x = alongCut(cut, c);
      for (const phase of c.phases) {
        const ends = segments
          .filter((s) => s.phase === phase && s.stable)
          .flatMap((s) => [s.points[0]![0], s.points.at(-1)![0]]);
        expect(ends).toContain(x);
      }
    }
  });

  it.each(Object.entries(PRESETS))(
    "%s: the three plotted curves sum to 0, and the crossings and flags are unchanged",
    (_, { params, window }) => {
      for (const [, cut] of sampleCuts(params, window)) {
        const [a, b] = alongRange(cut, window);
        for (const x of [a, 0.37 * a + 0.63 * b, b]) {
          const { T, p } = pointOnCut(cut, x);
          const sum = PHASES.reduce((acc, phase) => acc + relativeG(phase, T, p, params), 0);
          expect(Math.abs(sum)).toBeLessThan(1e-12);
          // The gaps between the curves are those of G itself.
          expect(relativeG("s", T, p, params) - relativeG("v", T, p, params)).toBeCloseTo(
            gibbs("s", T, p, params) - gibbs("v", T, p, params),
            12,
          );
        }
        for (const c of crossings(cut, params, window)) {
          const [i, j] = c.phases;
          expect(relativeG(i, c.T, c.p, params)).toBeCloseTo(relativeG(j, c.T, c.p, params), 9);
          // Stable means the third curve is not lower, on the mean reference too.
          const k = PHASES.find((q) => q !== i && q !== j)!;
          const margin = relativeG(k, c.T, c.p, params) - relativeG(i, c.T, c.p, params);
          expect(margin >= -1e-9).toBe(c.stable);
        }
      }
    },
  );

  it.each(Object.entries(PRESETS))(
    "%s: the G axis centres the highest stable crossing and holds every crossing of cuts that have one",
    (_, { params, window }) => {
      const half = gHalfSpan(params, window);
      // A denser set of cuts than gHalfSpan scans, in both modes, offset from its samples.
      for (const mode of MODES) {
        const [lo, hi] = cutBounds(mode, window);
        const [u0, u1] = [toCutAxis(mode, lo), toCutAxis(mode, hi)];
        for (let k = 0; k < 333; k++) {
          const value = fromCutAxis(mode, u0 + ((u1 - u0) * (k + 0.5)) / 333);
          const cut = cutFor(mode, { isobar: value, isotherm: value });
          const found = crossings(cut, params, window);
          const [lo, hi] = gDomain(cut, params, window, half);
          // The same half-span on every cut, so the scale does not change with the cut.
          expect(hi - lo).toBeCloseTo(2 * half, 12);
          const stable = found
            .filter((c) => c.stable)
            .map((c) => relativeG(c.phases[0], c.T, c.p, params));
          // A cut in one phase only may have its metastable crossings off the panel.
          if (stable.length === 0) continue;
          expect(0.5 * (lo + hi)).toBeCloseTo(Math.max(...stable), 12);
          for (const c of found) {
            for (const phase of c.phases) {
              const G = relativeG(phase, c.T, c.p, params);
              expect(G).toBeGreaterThan(lo);
              expect(G).toBeLessThan(hi);
            }
          }
        }
      }
    },
  );

  it("a cut without a stable crossing centres its one phase at the middle of the cut", () => {
    const { params } = h2o;
    // The window's low-p corner holds only vapour along this isobar.
    const window: PlotWindow = { ...win, Tmin: 320, Tmax: 350 };
    const cut: Cut = { kind: "isobar", p: 2 };
    expect(crossings(cut, params, window).filter((c) => c.stable)).toHaveLength(0);
    expect(gCentre(cut, params, window)).toBe(relativeG("v", 335, 2, params));
  });

  it.each(Object.entries(PRESETS))(
    "%s: the shaded runs start and end at the stable crossings, in the stable phase",
    (_, { params, window }) => {
      for (const [, cut] of sampleCuts(params, window)) {
        const [a, b] = alongRange(cut, window);
        const shaded = sliceSegments(cut, params, window, { samples: 120 })
          .filter((s) => s.stable)
          .sort((s, t) => s.points[0]![0] - t.points[0]![0]);
        const breaks = crossings(cut, params, window)
          .filter((c) => c.stable)
          .map((c) => alongCut(cut, c))
          .filter((x) => x > a && x < b);
        // The runs tile the cut end to start, and every edge between them is a stable crossing.
        expect(shaded[0]!.points[0]![0]).toBe(a);
        expect(shaded.at(-1)!.points.at(-1)![0]).toBe(b);
        for (let k = 1; k < shaded.length; k++) {
          const edge = shaded[k]!.points[0]![0];
          expect(shaded[k - 1]!.points.at(-1)![0]).toBe(edge);
          expect(breaks).toContain(edge);
          expect(shaded[k]!.phase).not.toBe(shaded[k - 1]!.phase);
        }
        // The middle of each run's range, not a sample: a run only as wide as one step, such as
        // the liquid on an isobar just above p_t, has no sample but its two ends.
        for (const run of shaded) {
          const mid = 0.5 * (run.points[0]![0] + run.points.at(-1)![0]);
          const { T, p } = pointOnCut(cut, mid);
          expect(run.phase).toBe(stablePhase(T, p, params));
        }
      }
    },
  );

  it.each(Object.entries(PRESETS))(
    "%s: each crossing lies within 0.5 px of the drawn boundary part with its stable flag",
    (_, { params, window }) => {
      const traced = PAIRS.flatMap(([i, j]) =>
        boundary(i, j, params, window).map((seg) => ({ pair: `${i}-${j}`, ...seg })),
      );
      let checked = 0;
      for (const [mode, cut] of sampleCuts(params, window)) {
        const m = projection(mode, window, size);
        const screen = (pts: Point[]) => pts.map((q) => toScreen(m, q.T, q.p));
        const tp = toScreen(m, params.Tt, params.pt);
        for (const c of crossings(cut, params, window)) {
          const [x, y] = toScreen(m, c.T, c.p);
          const pair = traced.filter((seg) => seg.pair === c.phases.join("-"));
          const dist = (stable: boolean) =>
            Math.min(
              ...pair
                .filter((seg) => seg.stable === stable)
                .map((seg) => distanceToPolyline(x, y, screen(seg.points))),
            );
          expect(dist(c.stable)).toBeLessThan(0.5);
          // Only next to the triple point, where the two parts meet, is the other part as close.
          if (dist(!c.stable) < 0.5) expect(Math.hypot(x - tp[0], y - tp[1])).toBeLessThan(1);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(40);
    },
  );
});

describe("plot size", () => {
  it("gives both plots half their width as height, within 160–360 px", () => {
    expect(plotHeight(500)).toBe(250);
    expect(plotHeight(200)).toBe(160);
    expect(plotHeight(1000)).toBe(360);
    // Same container width, same plot area, so the diagram and the slice panel match.
    const width = plotWidth(600);
    expect(plotHeight(width)).toBe(Math.round(width / 2));
  });

  it("frames the plot area on the sides without an axis", () => {
    expect(frameTopRight({ width: 640, height: 320 })).toBe("M0,0H640V320");
    // The slice panel has its x axis on top, so its frame runs along the bottom instead.
    expect(frameBottomRight({ width: 640, height: 320 })).toBe("M0,320H640V0");
  });
});

/** The distance in px from (x, y) to the nearest point that is not in `phase`, or off the plot. */
function clearanceAt(
  params: Params,
  window: PlotWindow,
  mode: Mode,
  phase: string,
  x: number,
  y: number,
): number {
  const toTp = invert(projection(mode, window, size));
  for (let r = 0.5; r < 200; r += 0.5) {
    for (let a = 0; a < 2 * Math.PI; a += Math.PI / 90) {
      const sx = x + r * Math.cos(a);
      const sy = y + r * Math.sin(a);
      if (sx < 0 || sy < 0 || sx > size.width || sy > size.height) return r;
      const [T, p] = fromScreen(toTp, sx, sy);
      if (stablePhase(T, p, params) !== phase) return r;
    }
  }
  return Infinity;
}

describe("phase labels", () => {
  const halfWidth = () => 20;

  it.each(
    Object.entries(PRESETS).flatMap(([id, preset]) =>
      MODES.map((mode) => [id, mode, preset] as const),
    ),
  )(
    "%s, %s: each label lies in its own region, at least 10 px from its edge",
    (_, mode, preset) => {
      const { params, window } = preset;
      const found = phaseLabels(params, window, mode, size, halfWidth);
      expect(found.map((l) => l.phase)).toEqual(["s", "l", "v"]);
      for (const label of found) {
        expect(stablePhase(label.T, label.p, params)).toBe(label.phase);
        const [x, y] = toScreen(projection(mode, window, size), label.T, label.p);
        const clearance = clearanceAt(params, window, mode, label.phase, x, y);
        expect(clearance).toBeGreaterThanOrEqual(10);
        // The reported clearance is a lower bound of the true one.
        expect(label.clearance).toBeLessThanOrEqual(clearance + 0.5);
      }
    },
  );

  it("the two modes place the labels at different (T, p), since the plot is not square", () => {
    const { params, window } = h2o;
    const isobar = phaseLabels(params, window, "isobar", size, halfWidth);
    const isotherm = phaseLabels(params, window, "isotherm", size, halfWidth);
    expect(isobar.map((l) => [l.T, l.p])).not.toEqual(isotherm.map((l) => [l.T, l.p]));
  });

  it("a region narrower than its label gets no label", () => {
    // CO₂'s s-l line slopes forward, so a window that ends 2 K above T_t holds only a thin
    // sliver of liquid between it and the right edge.
    const { params } = co2;
    const window: PlotWindow = { ...co2.window, Tmax: params.Tt + 2 };
    const wide = phaseLabels(params, window, "isobar", size, () => 1);
    const narrow = phaseLabels(params, window, "isobar", size, halfWidth);
    expect(wide.map((l) => l.phase)).toContain("l");
    expect(narrow.map((l) => l.phase)).not.toContain("l");
    const liquid = wide.find((l) => l.phase === "l")!;
    expect(liquid.clearance).toBeLessThan(20);
  });

  it("the pole of inaccessibility is the cell farthest from the edges", () => {
    // A 9 × 5 block of 1 inside a frame of 0 cells, in a 13 × 9 grid.
    const cols = 13;
    const rows = 9;
    const grid = new Uint8Array(cols * rows);
    for (let r = 2; r < 7; r++) for (let c = 2; c < 11; c++) grid[r * cols + c] = 1;
    const pole = poleOfInaccessibility(grid, cols, rows, 1)!;
    expect([pole.x, pole.y]).toEqual([6.5, 4.5]);
    // Three cells to the nearest 0 cell above or below, less half a cell's diagonal.
    expect(pole.clearance).toBeCloseTo(3 - Math.SQRT1_2, 9);
    expect(poleOfInaccessibility(grid, cols, rows, 2)).toBeNull();
    // The grid's edge counts as outside too.
    const full = poleOfInaccessibility(new Uint8Array(cols * rows).fill(1), cols, rows, 1)!;
    expect([full.x, full.y]).toEqual([6.5, 4.5]);
  });
});

describe("transition values", () => {
  it("leaves values that are far enough apart where they are", () => {
    expect(spreadApart([10, 100, 60], [20, 20, 20], 4)).toEqual([10, 100, 60]);
  });

  it("pushes two values apart by the same amount each, so they no longer overlap", () => {
    const [a, b] = spreadApart([100, 110], [30, 30], 4) as [number, number];
    expect(a).toBeCloseTo(105 - 17, 9);
    expect(b).toBeCloseTo(105 + 17, 9);
    expect(b - a).toBeCloseTo(34, 9);
  });

  it("keeps a chain of values apart, in their order, and inside the bounds", () => {
    const xs = [50, 52, 54, 300];
    const widths = [40, 30, 40, 40];
    const placed = spreadApart(xs, widths, 6, [0, 320]);
    for (let k = 1; k < xs.length; k++) {
      const gap = placed[k]! - placed[k - 1]! - 0.5 * (widths[k]! + widths[k - 1]!);
      expect(gap).toBeGreaterThanOrEqual(6 - 1e-9);
    }
    expect(placed[0]! - 0.5 * widths[0]!).toBeGreaterThanOrEqual(0);
    expect(placed[3]! + 0.5 * widths[3]!).toBeLessThanOrEqual(320);
    // Unsorted input comes back in its own order.
    expect(spreadApart([100, 10], [10, 10])).toEqual([100, 10]);
  });
});

describe("slope exaggerated note", () => {
  it("extremeWithin takes the extremes over the part of the line inside the band", () => {
    const diagonal: [number, number][] = [
      [0, 0],
      [10, 10],
    ];
    expect(extremeWithin(diagonal, 1, 2, 4, 0, Math.min)).toBeCloseTo(2, 12);
    expect(extremeWithin(diagonal, 1, 2, 4, 0, Math.max)).toBeCloseTo(4, 12);
    expect(extremeWithin(diagonal, 1, 20, 30, 0, Math.min)).toBeNull();
    // A segment along the band's edge direction counts in full where it lies inside the band.
    const flat: [number, number][] = [
      [3, 5],
      [8, 5],
    ];
    expect(extremeWithin(flat, 1, 4, 6, 0, Math.max)).toBe(8);
    expect(extremeWithin(flat, 1, 6, 7, 0, Math.max)).toBeNull();
  });

  it("has no spot without a line", () => {
    expect(placeNote([], "isobar", size, 100, [])).toBeNull();
  });

  it("with T across, sits under the top edge, left of the line and clear of it", () => {
    // A line leaning right as it rises, leaving through the top edge at x = 150.
    const sl: [number, number][] = [
      [100, 200],
      [150, 0],
    ];
    const spot = placeNote(sl, "isobar", size, 100, [])!;
    expect(spot.anchor).toBe("end");
    expect(spot.y).toBe(14);
    // Where the text runs (y from 4 to 17) the line is right of x = 145.75; the gap is 6.
    expect(spot.x).toBeCloseTo(145.75 - 6, 9);
  });

  it("with T across, moves right of the line where it would cover a phase name", () => {
    const sl: [number, number][] = [
      [100, 300],
      [100, -20],
    ];
    expect(placeNote(sl, "isobar", size, 80, [[0, 0, 95, 20]])).toEqual({
      x: 106,
      y: 14,
      anchor: "start",
    });
    // If both sides are covered, the first is kept.
    const both = placeNote(sl, "isobar", size, 80, [[0, 0, 300, 20]])!;
    expect([both.x, both.anchor]).toEqual([94, "end"]);
  });

  it("with p across, sits above the line at the right edge, or under it", () => {
    const sl: [number, number][] = [
      [300, 300],
      [650, 100],
    ];
    const above = placeNote(sl, "isotherm", size, 100, [])!;
    expect(above).toEqual({ x: 634, y: 94, anchor: "end" });
    const below = placeNote(sl, "isotherm", size, 100, [[500, 70, 640, 100]])!;
    expect(below.x).toBe(634);
    // Under the lowest point of the line beneath the text (x from 528 to 640).
    const lowest = 300 - (200 * (528 - 300)) / 350;
    expect(below.y).toBeCloseTo(lowest + 6 + 10, 9);
  });
});

describe("cut keys", () => {
  it.each(MODES)(
    "%s: arrows and Page keys step evenly on the axis; Home and End go to the limits",
    (mode) => {
      const [a, b] = cutBounds(mode, win);
      const step = tickStep(toCutAxis(mode, a), toCutAxis(mode, b), 100);
      const value = mode === "isobar" ? 50 : 300;
      const limits: [number, number] = mode === "isobar" ? [1, 200] : [250, 400];
      const at = (key: string) => cutAfterKey(key, mode, value, win, limits);
      const u = toCutAxis(mode, value);
      expect(at("ArrowUp")).toBeCloseTo(fromCutAxis(mode, u + step), 9);
      expect(at("ArrowRight")).toBe(at("ArrowUp"));
      expect(at("ArrowDown")).toBeCloseTo(fromCutAxis(mode, u - step), 9);
      expect(at("ArrowLeft")).toBe(at("ArrowDown"));
      expect(at("PageUp")).toBeCloseTo(fromCutAxis(mode, u + 10 * step), 9);
      expect(at("PageDown")).toBeCloseTo(fromCutAxis(mode, u - 10 * step), 9);
      expect(at("Home")).toBe(limits[0]);
      expect(at("End")).toBe(limits[1]);
      for (const key of ["a", "Enter", "Tab", "toString"]) expect(at(key)).toBeNull();
    },
  );
});
