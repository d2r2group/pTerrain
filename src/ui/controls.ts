// The controls. The main row beside the logo: the axis toggle, the
// triple-point snap and the metastable toggle. Beside or below the plots: the cut slider and
// number field with the pressure unit, the exaggerated s-l slope checkbox and the readout for
// screen readers. The substance panel is in substancePanel.ts.

import { EYE, EYE_OFF, icon, TRIPLE_POINT } from "./icons";
import { fromCutAxis, toCutAxis, type Mode, type Store } from "./state";
import { PHASE_NAME, readoutRows } from "./substanceFields";
import {
  formatPressure,
  formatTemperature,
  formatValue,
  fromUnit,
  PRESSURE_UNITS,
  storeUnit,
  toUnit,
} from "./units";

/** The axis toggle's halves: an italic p or T on screen, for the modes "constant p" and "constant T". */
const MODES: readonly { mode: Mode; symbol: string; label: string; title: string }[] = [
  {
    mode: "isobar",
    symbol: "p",
    label: "constant p",
    title: "Switch to constant p: cut along an isobar and plot g against T",
  },
  {
    mode: "isotherm",
    symbol: "T",
    label: "constant T",
    title: "Switch to constant T: cut along an isotherm and plot g against p",
  },
];

/** The cut variable of each mode, for labels: p* on an isobar, T* (in K) on an isotherm. */
const CUT_VAR: Record<Mode, { symbol: string; name: string }> = {
  isobar: { symbol: "p*", name: "Isobar pressure" },
  isotherm: { symbol: "T*", name: "Isotherm temperature" },
};

/**
 * The axis toggle: one full-size button that switches between constant p and constant
 * T, wherever it is clicked. It shows both halves, *p | T*, with the current mode's filled, and
 * like the theme button is named after the mode it switches to; the halves are hidden from
 * screen readers.
 */
export function createModeToggle(container: HTMLElement, store: Store): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mode-toggle";
  const halves = MODES.map(({ mode, symbol }) => {
    const half = document.createElement("span");
    half.setAttribute("aria-hidden", "true");
    half.dataset.mode = mode;
    const text = document.createElement("i");
    text.textContent = symbol;
    half.append(text);
    return half;
  });
  button.append(...halves);
  button.addEventListener("click", () => store.toggleMode());
  container.append(button);

  const sync = () => {
    const next = MODES.find(({ mode }) => mode !== store.state.mode)!;
    button.setAttribute("aria-label", next.label);
    button.title = next.title;
    for (const half of halves)
      half.classList.toggle("current", half.dataset.mode === store.state.mode);
  };
  sync();
  store.subscribe(sync);
}

/**
 * The slider and number field that set the cut precisely or from the keyboard, and
 * the pressure unit toggle beside their label. The slider moves evenly along the axis, so in
 * log p for an isobar; the number field takes the value in the shown unit.
 */
export function createCutInput(container: HTMLElement, store: Store): void {
  const root = document.createElement("div");
  root.className = "cut-input";
  const head = document.createElement("div");
  head.className = "cut-head";
  const label = document.createElement("label");
  const range = document.createElement("input");
  range.type = "range";
  range.step = "any";
  const number = document.createElement("input");
  number.type = "number";
  number.step = "any";
  number.inputMode = "decimal";
  range.id = uniqueId("cut-range");
  label.htmlFor = range.id;
  head.append(label);
  root.append(head, range, number);
  container.append(root);
  createUnitToggle(head, store);

  /** The cut in the shown unit (K for an isotherm), and back to kPa or K. */
  const shown = (v: number) => {
    const { mode, pressureUnit } = store.state;
    return mode === "isobar" ? toUnit(v, pressureUnit) : v;
  };
  const stored = (v: number) => {
    const { mode, pressureUnit } = store.state;
    return mode === "isobar" ? fromUnit(v, pressureUnit) : v;
  };
  const format = (v: number) =>
    store.state.mode === "isobar" ? formatValue(shown(v)) : v.toFixed(1);

  range.addEventListener("input", () => {
    const { mode, limits } = store.state;
    const [lo, hi] = limits[mode];
    const u = range.valueAsNumber;
    // The ends are the cut's limits exactly, not their round trip through log p.
    const atEnd = u <= Number(range.min) ? lo : u >= Number(range.max) ? hi : null;
    store.setCut(atEnd ?? fromCutAxis(mode, u));
  });
  // A value that is not a number leaves the cut where it was and shows it again; one outside the
  // limits shows where it was clamped to. Otherwise the field keeps what was typed, not its
  // 3-figure rounding.
  number.addEventListener("change", () => {
    const raw = number.value;
    const typed = stored(number.valueAsNumber);
    store.setCut(typed);
    const { mode, cuts } = store.state;
    number.value = cuts[mode] === typed ? raw : format(cuts[mode]);
  });

  const sync = () => {
    const { mode, limits, cuts, pressureUnit } = store.state;
    const [lo, hi] = limits[mode];
    const { symbol, name } = CUT_VAR[mode];
    const unit = mode === "isobar" ? pressureUnit : "K";
    label.textContent = `${symbol} (${unit})`;
    range.setAttribute("aria-label", `${name} ${symbol} (${unit})`);
    number.setAttribute("aria-label", `${name} ${symbol} (${unit}), typed value`);
    range.min = String(toCutAxis(mode, lo));
    range.max = String(toCutAxis(mode, hi));
    range.value = String(toCutAxis(mode, cuts[mode]));
    range.setAttribute(
      "aria-valuetext",
      mode === "isobar" ? formatPressure(cuts[mode], pressureUnit) : formatTemperature(cuts[mode]),
    );
    number.min = String(shown(lo));
    number.max = String(shown(hi));
    if (document.activeElement !== number) number.value = format(cuts[mode]);
  };
  sync();
  store.subscribe(sync);
}

/**
 * The pressure unit toggle, kPa | bar | atm, in the cut input's label row. It
 * only relabels: every pressure stays in kPa in the store. The choice is remembered.
 */
export function createUnitToggle(container: HTMLElement, store: Store): void {
  const group = document.createElement("div");
  group.className = "unit-toggle";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", "Pressure unit");
  const buttons = PRESSURE_UNITS.map((unit) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = unit;
    button.dataset.unit = unit;
    button.title = `Show pressures in ${unit}`;
    button.addEventListener("click", () => {
      store.setPressureUnit(unit);
      storeUnit(unit);
    });
    return button;
  });
  group.append(...buttons);
  container.append(group);

  const sync = () => {
    for (const button of buttons) {
      button.setAttribute("aria-pressed", String(button.dataset.unit === store.state.pressureUnit));
    }
  };
  sync();
  store.subscribe(sync);
}

/**
 * The checkbox above the substance menu that switches the plots to the model with an exaggerated
 * s-l slope, unticked at first. While ticked it names the factor; where the line
 * already leans far enough (factor 1) there is nothing to exaggerate, and it is disabled unless
 * already ticked.
 */
export function createExaggerateToggle(container: HTMLElement, store: Store): void {
  const label = document.createElement("label");
  label.className = "exaggerate";
  const box = document.createElement("input");
  box.type = "checkbox";
  const text = document.createElement("span");
  text.textContent = "Exaggerate s-l slope";
  const factor = document.createElement("span");
  factor.className = "factor";
  label.append(box, text, factor);
  container.append(label);
  box.addEventListener("change", () => store.setExaggerateSl(box.checked));

  const sync = () => {
    const { exaggerateSl, exaggeration: k } = store.state;
    box.checked = exaggerateSl;
    box.disabled = k === 1 && !exaggerateSl;
    factor.textContent = exaggerateSl && k > 1 ? `(Δv_fus ${formatFactor(k)}, schematic)` : "";
    label.title =
      k === 1
        ? "The s-l line already leans visibly here"
        : "Enlarge Δv_fus so that the s-l line visibly leans; the s-v and l-v lines stay, and the slice follows";
  };
  sync();
  store.subscribe(sync);
}

/**
 * The triple-point button of the main row, three boundary lines meeting at a point, which snaps
 * the cut to the triple point.
 */
export function createSnapButton(container: HTMLElement, store: Store): void {
  const snap = document.createElement("button");
  snap.type = "button";
  snap.className = "snap icon-button";
  snap.innerHTML = icon(TRIPLE_POINT, 24);
  snap.setAttribute("aria-label", "Snap to triple point");
  snap.addEventListener("click", () => store.snapToTriplePoint());
  container.append(snap);

  const sync = () => {
    const { mode, params, pressureUnit } = store.state;
    // A valid window always holds the triple point, so there is always one to snap to.
    snap.title =
      mode === "isobar"
        ? `Snap the isobar to the triple point, p_t = ${formatPressure(params.pt, pressureUnit)}`
        : `Snap the isotherm to the triple point, T_t = ${formatTemperature(params.Tt)}`;
  };
  sync();
  store.subscribe(sync);
}

/**
 * The Metastable toggle button, which shows or hides the metastable branches,
 * with an open eye while they are shown and a closed one while they are hidden.
 */
export function createMetastableToggle(container: HTMLElement, store: Store): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "metastable-toggle";
  const eye = document.createElement("span");
  eye.className = "eye";
  // The label is hidden on a phone, where the eye alone fits the header's one row, so the name
  // is set on the button too.
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = "Metastable";
  button.append(eye, label);
  button.setAttribute("aria-label", label.textContent);
  button.addEventListener("click", () => store.setShowMetastable(!store.state.showMetastable));
  container.append(button);

  const sync = () => {
    const shown = store.state.showMetastable;
    button.setAttribute("aria-pressed", String(shown));
    button.title = `${shown ? "Hide" : "Show"} the dashed metastable branches and their guide lines`;
    eye.innerHTML = icon(shown ? EYE : EYE_OFF);
  };
  sync();
  store.subscribe(sync);
}

/**
 * The transitions along the cut, for screen readers only: on screen the bold
 * values under the diagram's x axis show them, and those are `aria-hidden`. Each row names its
 * two phases. Metastable crossings follow the metastable toggle, as in the plots.
 */
export function createReadout(container: HTMLElement, store: Store): void {
  const root = document.createElement("section");
  root.className = "readout visually-hidden";
  root.setAttribute("aria-label", "Readout");
  const list = document.createElement("ul");
  list.className = "transitions";
  const empty = document.createElement("p");
  empty.className = "no-transitions";
  empty.textContent = "No crossings in the window.";
  root.append(list, empty);
  container.append(root);

  const sync = () => {
    const state = store.state;
    const rows = readoutRows(state);
    list.replaceChildren(
      ...rows.map((row) => {
        const item = document.createElement("li");
        item.className = row.stable ? "stable" : "metastable";
        item.dataset.pair = row.phases.join("-");
        const names = row.phases.map((phase) => PHASE_NAME[phase]).join("–");
        // The s-l crossing of the exaggerated model is not the real one.
        const exaggerated =
          state.exaggerateSl && state.exaggeration > 1 && row.phases.join("-") === "s-l";
        item.textContent = `${names}${row.stable ? "" : ", metastable"}${exaggerated ? ", slope exaggerated" : ""}: ${row.text}`;
        return item;
      }),
    );
    const shown = rows.filter((row) => row.stable || state.showMetastable).length;
    empty.hidden = shown > 0;
    root.classList.toggle("hide-metastable", !state.showMetastable);
  };
  sync();
  store.subscribe(sync);
}

/** An exaggeration factor for display, to two significant figures: "×27", "×6,400". */
export function formatFactor(factor: number): string {
  return `×${Number(factor.toPrecision(2)).toLocaleString("en-US")}`;
}

let nextId = 0;
function uniqueId(prefix: string): string {
  return `${prefix}-${++nextId}`;
}
