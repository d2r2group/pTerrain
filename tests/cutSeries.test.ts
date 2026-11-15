import { describe, expect, it } from "vitest";
import { CUSTOM, PRESETS } from "../src/physics/presets";
import { cutText, seriesCuts, seriesName } from "../src/ui/cutSeries";
import { stateAtCut, Store, toCutAxis, type Mode } from "../src/ui/state";

// The cuts of a figure series (*All unique cuts*).

const MODES: readonly Mode[] = ["isobar", "isotherm"];

/** Each preset's cuts, as the file names write them, from the top of the diagram down. */
const EXPECTED: Record<string, Record<Mode, string[]>> = {
  H2O: { isobar: ["4kPa", "0.612kPa", "0.1kPa"], isotherm: ["300.0K", "273.2K", "250.0K"] },
  CO2: { isobar: ["1000kPa", "518kPa", "200kPa"], isotherm: ["240.0K", "216.6K", "200.0K"] },
  Custom: {
    isobar: ["90kPa", "50kPa", "30kPa"],
    isotherm: ["340.0K", "300.0K", "280.0K"],
  },
};

describe.each([
  ["H2O", PRESETS.h2o],
  ["CO2", PRESETS.co2],
  ["Custom", CUSTOM],
] as const)("%s", (name, preset) => {
  it.each(MODES)("%s: lists its cuts", (mode) => {
    const state = new Store(preset, mode).state;
    expect(seriesCuts(state).map((v) => cutText(state, v))).toEqual(EXPECTED[name]![mode]);
  });

  it.each(MODES)(
    "%s: one cut above the triple point, one through it and one below, inside the limits",
    (mode) => {
      const state = new Store(preset, mode).state;
      const [above, at, below] = seriesCuts(state);
      const [lo, hi] = state.limits[mode];
      expect(seriesCuts(state)).toHaveLength(3);
      expect(at).toBe(mode === "isobar" ? state.model.pt : state.model.Tt);
      expect(above!).toBeGreaterThan(at!);
      expect(above!).toBeLessThan(hi);
      expect(below!).toBeLessThan(at!);
      expect(below!).toBeGreaterThan(lo);
    },
  );

  it.each(MODES)("%s: each side's cut lies within a quarter of its band of the middle", (mode) => {
    const state = new Store(preset, mode).state;
    const u = (v: number) => toCutAxis(mode, v);
    const [above, at, below] = seriesCuts(state);
    const [lo, hi] = state.limits[mode];
    for (const [v, a, b] of [
      [above!, at!, hi],
      [below!, lo, at!],
    ]) {
      expect(Math.abs(u(v!) - 0.5 * (u(a!) + u(b!)))).toBeLessThanOrEqual(0.25 * (u(b!) - u(a!)));
    }
  });
});

describe("file names", () => {
  it("number the cut and write its value as the number field shows it", () => {
    const store = new Store(PRESETS.h2o, "isobar");
    expect(seriesName(0, store.state, 4)).toBe("01-4kPa");
    expect(seriesName(9, store.state, 0.611654)).toBe("10-0.612kPa");
    store.setPressureUnit("bar");
    expect(seriesName(1, store.state, 4)).toBe("02-0.04bar");
    const isotherm = stateAtCut(new Store(PRESETS.h2o, "isotherm").state, 273.16);
    expect(seriesName(2, isotherm, 273.16)).toBe("03-273.2K");
  });

  it("round isobar cuts in the pressure unit shown", () => {
    const store = new Store(PRESETS.co2, "isobar", "atm");
    expect(seriesCuts(store.state).map((v) => cutText(store.state, v))).toEqual([
      "10atm",
      "5.11atm",
      "2atm",
    ]);
  });
});
