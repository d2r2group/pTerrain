// App state: the substance, the window, the mode, one cut position per mode, whether the
// metastable branches are shown, the pressure unit and whether the s-l slope is exaggerated
//, with the model that the plots draw and where the current cut crosses it.

import { crossings, cutLimits, type Crossing, type Cut } from "../physics/crossings";
import { exaggerated, type Exaggerated } from "../physics/exaggerate";
import type { Params, PlotWindow } from "../physics/gibbs";
import type { Preset } from "../physics/presets";
import type { PressureUnit } from "./units";

/** Constant p mode (the cut is an isobar, T across) or constant T mode (an isotherm, p across). */
export type Mode = Cut["kind"];

export interface State {
  params: Params;
  window: PlotWindow;
  mode: Mode;
  /** The last cut position of each mode: p* in kPa for the isobar, T* in K for the isotherm. */
  cuts: Record<Mode, number>;
  /**
   * The range each mode's cut can take: the cuts that meet a stable boundary of `model` inside the
   * window. The whole window for isobars; for isotherms, from where the s-v
   * line meets p_min to where the l-v line meets p_max.
   */
  limits: Record<Mode, [number, number]>;
  /** Whether the dashed metastable curves, extensions and their guides are drawn. */
  showMetastable: boolean;
  /** The unit pressures are shown and typed in; every pressure in the state stays in kPa. */
  pressureUnit: PressureUnit;
  /** Whether the plots use the model with an exaggerated s-l slope. */
  exaggerateSl: boolean;
  /**
   * What every plot and the readout draw: `params`, or while `exaggerateSl` is on, the model
   * with the exaggerated s-l slope. The parameter fields keep `params`.
   */
  model: Params;
  /** The exaggeration factor for this substance and window (1 where there is nothing to do). */
  exaggeration: number;
  /**
   * Every crossing of the current cut (`cutOf`) with `model` in the window, sorted along it: found
   * once here for the diagram, the slice panel and the readout.
   */
  crossings: readonly Crossing[];
}

/** The fields of `State` that the store derives from the others. */
type Derived = "model" | "exaggeration" | "limits" | "crossings";

export type Listener = (state: Readonly<State>, prev: Readonly<State>) => void;

/**
 * The range a cut of this mode spans on the diagram: the window's p range for an isobar, T for an
 * isotherm. The cut itself is held to the state's narrower `limits`.
 */
export function cutBounds(mode: Mode, window: PlotWindow): [number, number] {
  return mode === "isobar" ? [window.pmin, window.pmax] : [window.Tmin, window.Tmax];
}

/**
 * A cut value where the cut's axis is linear: log₁₀ p* for an isobar, since the p axis is
 * logarithmic, and T* itself for an isotherm.
 */
export function toCutAxis(mode: Mode, value: number): number {
  return mode === "isobar" ? Math.log10(value) : value;
}

/** The inverse of `toCutAxis`. */
export function fromCutAxis(mode: Mode, u: number): number {
  return mode === "isobar" ? 10 ** u : u;
}

/**
 * Starting cuts: an isobar halfway between p_tp and p_max on the log axis, which crosses s-l and
 * l-v, and an isotherm a twentieth of the T range below T_tp. Both are clamped into `limits`.
 */
export function defaultCuts(
  params: Params,
  window: PlotWindow,
  limits: Record<Mode, [number, number]> = cutLimits(params, window),
): Record<Mode, number> {
  return {
    isobar: clamp(Math.sqrt(params.pt * window.pmax), limits.isobar),
    isotherm: clamp(params.Tt - 0.05 * (window.Tmax - window.Tmin), limits.isotherm),
  };
}

/** The cut of `mode` at its remembered position, as the physics core takes it. */
export function cutFor(mode: Mode, cuts: Readonly<Record<Mode, number>>): Cut {
  return mode === "isobar"
    ? { kind: "isobar", p: cuts.isobar }
    : { kind: "isotherm", T: cuts.isotherm };
}

/** The current cut as the physics core takes it. */
export function cutOf(state: Readonly<State>): Cut {
  return cutFor(state.mode, state.cuts);
}

function clamp(x: number, [lo, hi]: [number, number]): number {
  return Math.min(hi, Math.max(lo, x));
}

/** A minimal observable store. Every change replaces the state object, so listeners can diff. */
export class Store {
  #state: State;
  #listeners = new Set<Listener>();

  /** The exaggerated model of the current substance and window, found once for each. */
  #exaggerated: Exaggerated;

  constructor(preset: Preset, mode: Mode = "isobar", pressureUnit: PressureUnit = "kPa") {
    this.#exaggerated = exaggerated(preset.params, preset.window);
    const limits = cutLimits(preset.params, preset.window);
    const cuts = defaultCuts(preset.params, preset.window, limits);
    this.#state = {
      params: preset.params,
      window: preset.window,
      mode,
      cuts,
      limits,
      showMetastable: true,
      pressureUnit,
      exaggerateSl: false,
      model: preset.params,
      exaggeration: this.#exaggerated.factor,
      crossings: crossings(cutFor(mode, cuts), preset.params, preset.window),
    };
  }

  get state(): Readonly<State> {
    return this.#state;
  }

  /** Calls `listener` after every change; returns a function that unsubscribes it. */
  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setMode(mode: Mode): void {
    if (mode !== this.#state.mode) this.#update({ mode });
  }

  toggleMode(): void {
    this.setMode(this.#state.mode === "isobar" ? "isotherm" : "isobar");
  }

  /** Moves the current mode's cut to `value`, clamped into its limits; the other mode keeps its own. */
  setCut(value: number): void {
    const { mode, limits, cuts } = this.#state;
    if (!Number.isFinite(value)) return;
    const next = clamp(value, limits[mode]);
    if (next !== cuts[mode]) this.#update({ cuts: { ...cuts, [mode]: next } });
  }

  /**
   * Replaces the substance and the window, which must pass `validate`. With `resetCuts` both cuts
   * go to `defaultCuts` (a new preset); otherwise each keeps its value, clamped into its new
   * limits.
   */
  setSubstance(params: Params, window: PlotWindow, { resetCuts = false } = {}): void {
    this.#update({ params, window }, resetCuts);
  }

  /** Moves the current mode's cut through the triple point: p* = p_tp or T* = T_tp. */
  snapToTriplePoint(): void {
    const { mode, params } = this.#state;
    this.setCut(mode === "isobar" ? params.pt : params.Tt);
  }

  setShowMetastable(show: boolean): void {
    if (show !== this.#state.showMetastable) this.#update({ showMetastable: show });
  }

  /** Changes only how pressures are shown and typed; no pressure in the state changes. */
  setPressureUnit(unit: PressureUnit): void {
    if (unit !== this.#state.pressureUnit) this.#update({ pressureUnit: unit });
  }

  setExaggerateSl(on: boolean): void {
    if (on !== this.#state.exaggerateSl) this.#update({ exaggerateSl: on });
  }

  /**
   * Applies `patch` and derives the rest. When the model changes, so do the limits, and both cuts
   * are clamped into them, or with `resetCuts` set to `defaultCuts`. The crossings follow the
   * model, the window, the mode and the cuts.
   */
  #update(patch: Partial<Omit<State, Derived>>, resetCuts = false): void {
    const prev = this.#state;
    const next = { ...prev, ...patch };
    if (next.params !== prev.params || next.window !== prev.window) {
      this.#exaggerated = exaggerated(next.params, next.window);
    }
    if (
      next.params !== prev.params ||
      next.window !== prev.window ||
      next.exaggerateSl !== prev.exaggerateSl
    ) {
      next.model = next.exaggerateSl ? this.#exaggerated.params : next.params;
      next.exaggeration = this.#exaggerated.factor;
    }
    if (resetCuts || next.model !== prev.model || next.window !== prev.window) {
      const limits = cutLimits(next.model, next.window);
      const { cuts } = next;
      const clamped = resetCuts
        ? defaultCuts(next.params, next.window, limits)
        : {
            isobar: clamp(cuts.isobar, limits.isobar),
            isotherm: clamp(cuts.isotherm, limits.isotherm),
          };
      next.limits = limits;
      // Kept as the same object when no cut moves, so listeners see only the model change.
      next.cuts =
        clamped.isobar === cuts.isobar && clamped.isotherm === cuts.isotherm ? cuts : clamped;
    }
    if (
      next.model !== prev.model ||
      next.window !== prev.window ||
      next.mode !== prev.mode ||
      next.cuts !== prev.cuts
    ) {
      next.crossings = crossings(cutOf(next), next.model, next.window);
    }
    this.#state = next;
    for (const listener of this.#listeners) listener(this.#state, prev);
  }
}
