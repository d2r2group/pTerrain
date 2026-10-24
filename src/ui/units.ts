// The pressure unit and the axis scales. The store keeps every pressure in kPa,
// since V (p − p_tp) in L/mol × kPa is J/mol; the unit is applied only where a pressure is shown
// or typed, through the conversions here. The p axis is logarithmic.

import {
  scaleLinear,
  scaleLog,
  type NumberValue,
  type ScaleLinear,
  type ScaleLogarithmic,
} from "d3";
import type { PlotWindow } from "../physics/gibbs";
import { safeLocalStorage } from "./theme";

export type PressureUnit = "kPa" | "bar" | "atm";
export const PRESSURE_UNITS: readonly PressureUnit[] = ["kPa", "bar", "atm"];

const KPA_PER: Record<PressureUnit, number> = { kPa: 1, bar: 100, atm: 101.325 };

/** A pressure in kPa, in `unit`. */
export function toUnit(kPa: number, unit: PressureUnit): number {
  return kPa / KPA_PER[unit];
}

/** A pressure in `unit`, in kPa. */
export function fromUnit(value: number, unit: PressureUnit): number {
  return value * KPA_PER[unit];
}

/** The `localStorage` key of the chosen unit. */
export const UNIT_KEY = "pterrain-pressure-unit";

/** The stored unit, or kPa when none is stored or storage is blocked. */
export function storedUnit(
  storage: Pick<Storage, "getItem"> | null = safeLocalStorage(),
): PressureUnit {
  try {
    const unit = storage?.getItem(UNIT_KEY);
    return PRESSURE_UNITS.find((u) => u === unit) ?? "kPa";
  } catch {
    return "kPa";
  }
}

/** Remembers the unit; a blocked storage only means it is forgotten on reload. */
export function storeUnit(
  unit: PressureUnit,
  storage: Pick<Storage, "setItem"> | null = safeLocalStorage(),
): void {
  try {
    storage?.setItem(UNIT_KEY, unit);
  } catch {
    // Nothing to do: the unit still switches, it just does not remember.
  }
}

/** A number to three significant figures, without trailing zeros: 0.612, 518, 5180. */
export function formatValue(x: number): string {
  return String(Number(x.toPrecision(3)));
}

/** A pressure given in kPa, shown in `unit` to three significant figures: "0.612 kPa". */
export function formatPressure(kPa: number, unit: PressureUnit): string {
  return `${formatValue(toUnit(kPa, unit))} ${unit}`;
}

/** A temperature to one decimal: "273.2 K". */
export function formatTemperature(T: number): string {
  return `${T.toFixed(1)} K`;
}

/**
 * Round tick values of a log axis from lo to hi (both > 0): 1, 2 and 5 times the powers of ten,
 * or the powers of ten alone (every n-th, if need be) when that gives more than `count`. Where
 * that keeps fewer than two, every n-th of the 1-2-5 values; a range that holds fewer than two of
 * those gets the round values of a linear axis instead.
 */
export function logTicks(lo: number, hi: number, count: number): number[] {
  const within = (v: number) => v >= lo * (1 - 1e-12) && v <= hi * (1 + 1e-12);
  const steps = (mantissas: readonly number[]) => {
    const out: number[] = [];
    for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++) {
      for (const m of mantissas) {
        const v = Number((m * 10 ** k).toPrecision(12));
        if (within(v)) out.push(v);
      }
    }
    return out;
  };
  const fine = steps([1, 2, 5]);
  if (fine.length < 2) return scaleLinear().domain([lo, hi]).ticks(count);
  if (fine.length <= count) return fine;
  const thin = (values: number[]) => {
    const stride = Math.ceil(values.length / Math.max(2, count));
    return values.filter((_, k) => k % stride === 0);
  };
  const decades = steps([1]);
  return decades.length >= 2 ? thin(decades) : thin(fine);
}

/** A tick label: the round value without trailing zeros. */
function formatTick(v: NumberValue): string {
  return String(Number(Number(v).toPrecision(6)));
}

/** One axis of the plots, in the shown unit, with its tick values and labels. */
export interface AxisSpec {
  scale: ScaleLinear<number, number> | ScaleLogarithmic<number, number>;
  ticks: number[];
  format: (v: NumberValue) => string;
}

/**
 * The T or p axis of the window over `range` px, with about `count` (at least 2) ticks: linear in
 * T, logarithmic in p and in `unit`, so that its ticks land on round values of that unit (1, 2,
 * 5, 10 atm, not 0.987). The unit changes the ticks only: a pressure lands at the same px in
 * every unit.
 */
export function axisSpec(
  quantity: "T" | "p",
  window: PlotWindow,
  unit: PressureUnit,
  range: [number, number],
  count: number,
): AxisSpec {
  count = Math.max(2, count);
  if (quantity === "T") {
    const scale = scaleLinear().domain([window.Tmin, window.Tmax]).range(range);
    return { scale, ticks: scale.ticks(count), format: scale.tickFormat(count) };
  }
  const lo = toUnit(window.pmin, unit);
  const hi = toUnit(window.pmax, unit);
  const scale = scaleLog().domain([lo, hi]).range(range);
  return { scale, ticks: logTicks(lo, hi, count), format: formatTick };
}
