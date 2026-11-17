// The cuts of a figure series (*3 unique cuts*): from the top of the diagram down, one cut above
// the triple point, one through it and one below it, the textbook's three isobars or isotherms
// (P₁–P₃ or T₁–T₃, the middle one through the triple point o). No DOM here.

import { cutBounds, fromCutAxis, toCutAxis, type State } from "./state";
import { formatValue, fromUnit, toUnit } from "./units";

/**
 * The series' three cuts for the state's mode, from the top of the diagram down: the middle of the
 * band between the triple point and each of the mode's limits (in log p for isobars), rounded to a
 * nice value inside the band (in the pressure unit shown), and the triple point's value between
 * them. A side with no room between the triple point and its limit gets no cut.
 */
export function seriesCuts(state: Readonly<State>): number[] {
  const { mode, model, window, limits } = state;
  const u = (v: number) => toCutAxis(mode, v);
  const [a, b] = cutBounds(mode, window);
  const tp = mode === "isobar" ? model.pt : model.Tt;
  const [lo, hi] = limits[mode];
  const cuts = [tp];
  for (const [from, to] of [
    [lo, tp],
    [tp, hi],
  ] as const) {
    if (u(to) - u(from) <= 1e-9 * (u(b) - u(a))) continue;
    cuts.push(niceInside(state, fromCutAxis(mode, 0.5 * (u(from) + u(to))), from, to));
  }
  return cuts.sort((x, y) => y - x);
}

/**
 * `middle` rounded to the fewest significant figures, in the unit the cut is shown in, that keep it
 * strictly inside (lo, hi) and within a quarter of the band of the middle, on the cut's axis.
 */
function niceInside(state: Readonly<State>, middle: number, lo: number, hi: number): number {
  const { mode, pressureUnit } = state;
  const isobar = mode === "isobar";
  const u = (v: number) => toCutAxis(mode, v);
  const shown = isobar ? toUnit(middle, pressureUnit) : middle;
  const reach = 0.25 * (u(hi) - u(lo));
  for (let digits = 1; digits <= 15; digits++) {
    const typed = Number(shown.toPrecision(digits));
    const v = isobar ? fromUnit(typed, pressureUnit) : typed;
    if (v > lo && v < hi && Math.abs(u(v) - u(middle)) <= reach) return v;
  }
  return middle;
}

/** A cut value as the cut's number field shows it: 3 figures in the pressure unit, or K to 0.1. */
export function cutText(state: Readonly<State>, value: number): string {
  return state.mode === "isobar"
    ? `${formatValue(toUnit(value, state.pressureUnit))}${state.pressureUnit}`
    : `${value.toFixed(1)}K`;
}

/**
 * A cut's part of a file name: its two-digit place in the series and its value with the unit, `.`
 * kept and any other character a file name cannot hold replaced by `-`.
 */
export function seriesName(index: number, state: Readonly<State>, value: number): string {
  const text = cutText(state, value).replace(/[^A-Za-z0-9._]/g, "-");
  return `${String(index + 1).padStart(2, "0")}-${text}`;
}
