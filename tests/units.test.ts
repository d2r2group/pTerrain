import { describe, expect, it } from "vitest";
import { logspace } from "../src/physics/roots";
import { PRESETS } from "../src/physics/presets";
import { Store } from "../src/ui/state";
import {
  axisSpec,
  formatPressure,
  fromUnit,
  logTicks,
  PRESSURE_UNITS,
  storedUnit,
  storeUnit,
  toUnit,
  UNIT_KEY,
} from "../src/ui/units";

/** An in-memory `Storage` stand-in. */
function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

/** A storage that throws on every access, as a browser with blocked site data does. */
const blocked = {
  getItem(): string {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem(): void {
    throw new DOMException("blocked", "SecurityError");
  },
};

/** Whether v is 1, 2 or 5 times a power of ten (or a round value of a linear axis). */
const isRound = (v: number) => {
  const mantissa = v / 10 ** Math.floor(Math.log10(v) + 1e-9);
  return [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9);
};

describe("pressure units", () => {
  it("converts kPa to bar and atm and back", () => {
    expect(toUnit(100, "bar")).toBe(1);
    expect(toUnit(101.325, "atm")).toBe(1);
    expect(fromUnit(2, "bar")).toBe(200);
    for (const unit of PRESSURE_UNITS) {
      for (const kPa of [0.611654, 101.325, 517.964, 6000]) {
        expect(fromUnit(toUnit(kPa, unit), unit)).toBeCloseTo(kPa, 12);
      }
    }
  });

  it("formats a pressure in the unit to three significant figures", () => {
    expect(formatPressure(0.611654, "kPa")).toBe("0.612 kPa");
    expect(formatPressure(517.964, "bar")).toBe("5.18 bar");
    expect(formatPressure(101.325, "atm")).toBe("1 atm");
  });

  it("remembers the unit, and falls back to kPa when storage is empty, invalid or blocked", () => {
    const storage = memoryStorage();
    expect(storedUnit(storage)).toBe("kPa");
    storeUnit("atm", storage);
    expect(storage.items.get(UNIT_KEY)).toBe("atm");
    expect(storedUnit(storage)).toBe("atm");
    storage.setItem(UNIT_KEY, "psi");
    expect(storedUnit(storage)).toBe("kPa");
    expect(() => storeUnit("bar", blocked)).not.toThrow();
    expect(storedUnit(blocked)).toBe("kPa");
    expect(storedUnit(null)).toBe("kPa");
  });

  it("the store changes only the unit, never a pressure, and notifies on a change only", () => {
    const store = new Store(PRESETS.h2o);
    const before = store.state;
    let calls = 0;
    store.subscribe(() => calls++);
    store.setPressureUnit("kPa");
    store.setPressureUnit("bar");
    expect(calls).toBe(1);
    expect(store.state.pressureUnit).toBe("bar");
    expect(store.state.cuts).toBe(before.cuts);
    expect(store.state.params).toBe(before.params);
    expect(store.state.window).toBe(before.window);
  });
});

describe("log axis", () => {
  it("ticks land on round values of each unit", () => {
    for (const { window } of Object.values(PRESETS)) {
      for (const unit of PRESSURE_UNITS) {
        const lo = toUnit(window.pmin, unit);
        const hi = toUnit(window.pmax, unit);
        for (const count of [3, 6, 10]) {
          const ticks = logTicks(lo, hi, count);
          expect(ticks.length).toBeGreaterThanOrEqual(2);
          expect(ticks.length).toBeLessThanOrEqual(count);
          for (const t of ticks) {
            expect(t).toBeGreaterThanOrEqual(lo);
            expect(t).toBeLessThanOrEqual(hi);
            expect(isRound(t)).toBe(true);
          }
        }
      }
    }
    // H₂O's window in atm: 1, 2, 5 × 10ᵏ atm, not the round kPa values 0.987 atm and so on.
    expect(logTicks(toUnit(0.1, "atm"), toUnit(250, "atm"), 12)).toEqual([
      0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2,
    ]);
    expect(logTicks(0.1, 250, 5)).toEqual([0.1, 1, 10, 100]);
    // Many decades and few ticks: every other decade.
    expect(logTicks(1e-3, 1e4, 4)).toEqual([1e-3, 0.1, 10, 1000]);
    // One decade inside and few ticks: every other 1-2-5 value.
    expect(logTicks(20, 500, 3)).toEqual([20, 100, 500]);
    expect(logTicks(20, 500, 4)).toEqual([20, 100, 500]);
  });

  it("a range within one decade gets the round values of a linear axis", () => {
    expect(logTicks(120, 180, 4)).toEqual([120, 140, 160, 180]);
  });

  it("puts a pressure at the same px in every unit", () => {
    const { window } = PRESETS.co2;
    for (const p of [window.pmin, 517.964, 2000, window.pmax]) {
      const px = PRESSURE_UNITS.map((unit) =>
        axisSpec("p", window, unit, [0, 640], 8).scale(toUnit(p, unit)),
      );
      for (const x of px) expect(x).toBeCloseTo(px[0] as number, 9);
    }
    // The T axis stays linear.
    const T = axisSpec("T", window, "atm", [0, 100], 5).scale;
    expect(T(0.5 * (window.Tmin + window.Tmax))).toBeCloseTo(50, 12);
  });

  it("logspace steps evenly in log and ends exactly on its bounds", () => {
    const xs = logspace(0.1, 1000, 5);
    expect([...xs].map((x) => Number(x.toPrecision(12)))).toEqual([0.1, 1, 10, 100, 1000]);
    expect(xs[0]).toBe(0.1);
    expect(xs[4]).toBe(1000);
  });
});
