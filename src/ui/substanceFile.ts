// The substance as a file and as a link: the JSON file that Export writes and
// Import reads, its download name, and the short positional fragment of a share link. No DOM here.

import { autoWindow } from "../physics/autoWindow";
import type { Params, PlotWindow } from "../physics/gibbs";
import { PRESETS, type PresetId } from "../physics/presets";
import type { Mode } from "./state";
import { matchPreset, substanceFrom, substanceValues, type FieldKey } from "./substanceFields";

/** A substance as the panel applies it: its name, parameters, window and *auto* box. */
export interface Substance {
  name: string;
  params: Params;
  window: PlotWindow;
  /** Whether the window was applied with *auto* ticked, so that it is `autoWindow(params)`. */
  auto: boolean;
}

/** The view a link opens on: the mode and its cut, p* in kPa or T* in K. */
export interface View {
  mode: Mode;
  cut: number;
}

/** What a parser returns: the value, or the first problem, for a one-line warning. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };

/** The longest name the Name field takes. */
export const NAME_MAX = 40;

/** The name that is applied for `typed`: trimmed and cut to NAME_MAX, *Custom* if empty. */
export function cleanName(typed: string): string {
  return typed.trim().slice(0, NAME_MAX).trim() || "Custom";
}

const FORMAT = "pterrain-substance";
const VERSION = 1;

/** The parameters, then the window edges, in the fields' order: the order of a link's numbers. */
const PARAM_KEYS: readonly FieldKey[] = [
  "Tt",
  "pt",
  "dHfus",
  "dHvap",
  "Ss",
  "Vs",
  "Vl",
  "cps",
  "cpl",
  "cpv",
];
const WINDOW_KEYS: readonly FieldKey[] = ["Tmin", "Tmax", "pmin", "pmax"];

/** For a reader of the file; ignored on import. */
const UNITS = {
  Tt: "K",
  pt: "kPa",
  dHfus: "kJ/mol",
  dHvap: "kJ/mol",
  Ss: "J/(mol·K)",
  Vs: "L/mol",
  Vl: "L/mol",
  cp: "J/(mol·K)",
  Tmin: "K",
  Tmax: "K",
  pmin: "kPa",
  pmax: "kPa",
};

/** The substance file: pretty-printed JSON in the model's units. */
export function toSubstanceFile(
  name: string,
  params: Params,
  window: PlotWindow,
  auto: boolean,
): string {
  const { Tt, pt, dHfus, dHvap, Ss, Vs, Vl, cp } = params;
  const { Tmin, Tmax, pmin, pmax } = window;
  const file = {
    format: FORMAT,
    version: VERSION,
    name,
    params: { Tt, pt, dHfus, dHvap, Ss, Vs, Vl, cp: { s: cp.s, l: cp.l, v: cp.v } },
    window: { Tmin, Tmax, pmin, pmax },
    autoWindow: auto,
    units: UNITS,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** The numbers under `keys` of `object`, or the first one that is missing or not finite. */
function numbers<K extends string>(
  object: unknown,
  path: string,
  keys: readonly K[],
): Parsed<Record<K, number>> {
  if (!isObject(object)) return { ok: false, problem: `${path} is missing` };
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const x = object[key];
    if (typeof x !== "number" || !Number.isFinite(x)) {
      return { ok: false, problem: `${path}.${key} is missing or not a finite number` };
    }
    out[key] = x;
  }
  return { ok: true, value: out };
}

/** The substance in a file's text, or the first problem with it; unknown keys are ignored. */
export function parseSubstanceFile(text: string): Parsed<Substance> {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, problem: "it is not JSON" };
  }
  if (!isObject(file)) return { ok: false, problem: "it is not a JSON object" };
  if (file.format !== FORMAT) return { ok: false, problem: `its format is not "${FORMAT}"` };
  if (file.version !== VERSION) {
    return { ok: false, problem: `version ${JSON.stringify(file.version)} is not supported` };
  }
  if (typeof file.name !== "string") return { ok: false, problem: "its name is not a string" };
  const params = numbers(file.params, "params", [
    "Tt",
    "pt",
    "dHfus",
    "dHvap",
    "Ss",
    "Vs",
    "Vl",
  ] as const);
  if (!params.ok) return params;
  const cp = numbers(isObject(file.params) ? file.params.cp : null, "params.cp", [
    "s",
    "l",
    "v",
  ] as const);
  if (!cp.ok) return cp;
  const window = numbers(file.window, "window", ["Tmin", "Tmax", "pmin", "pmax"] as const);
  if (!window.ok) return window;
  if (typeof file.autoWindow !== "boolean") {
    return { ok: false, problem: "autoWindow is not true or false" };
  }
  return {
    ok: true,
    value: {
      name: cleanName(file.name),
      params: { ...params.value, cp: cp.value },
      window: window.value,
      auto: file.autoWindow,
    },
  };
}

/**
 * The download name: the name reduced to letters, digits, `-` and `_` (after NFKD, so *H₂O* gives
 * `H2O.json`, and with spaces as `_`), or `substance.json` if nothing is left.
 */
export function fileName(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "");
  return `${base || "substance"}.json`;
}

/** A number in a link: its shortest exact form, with a leading `0.` cut to `.`. */
function linkNumber(x: number): string {
  return String(x).replace(/^(-?)0\./, "$1.");
}

/** A decimal number as `String` writes it, or as typed, with or without the leading 0. */
const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/** The cut in a link: 4 significant figures. */
function linkCut(x: number): string {
  return linkNumber(Number(x.toPrecision(4)));
}

const MODE_LETTER: Record<Mode, string> = { isobar: "p", isotherm: "T" };

/**
 * The fragment of a share link, with its `#`: a preset's id when parameters, window and name are
 * the preset's, otherwise `1,<name>,<10 parameters>[,<4 window edges>]`, the window left out when
 * it is automatic; then `;<p|T>,<cut>` for the view.
 */
export function toLink(substance: Substance, view?: View): string {
  const { name, params, window, auto } = substance;
  const id = matchPreset(params, window);
  let text: string;
  if (id && PRESETS[id].name === name) {
    text = id;
  } else {
    const values = substanceValues(params, window);
    const keys = auto ? PARAM_KEYS : [...PARAM_KEYS, ...WINDOW_KEYS];
    text = [
      String(VERSION),
      encodeURIComponent(name),
      ...keys.map((k) => linkNumber(values[k])),
    ].join(",");
  }
  if (view) text += `;${MODE_LETTER[view.mode]},${linkCut(view.cut)}`;
  return `#${text}`;
}

function linkValue(text: string, label: string): Parsed<number> {
  const x = Number(text);
  if (!NUMBER.test(text) || !Number.isFinite(x)) {
    return { ok: false, problem: `${label} is not a finite number` };
  }
  return { ok: true, value: x };
}

/** The substance and view in a link's fragment (with or without its `#`), or the first problem. */
export function parseLink(fragment: string): Parsed<{ substance: Substance; view?: View }> {
  const text = fragment.replace(/^#/, "");
  if (text === "") return { ok: false, problem: "it is empty" };
  const parts = text.split(";");
  if (parts.length > 2) return { ok: false, problem: "it has more than one ;" };
  const [head, tail] = parts as [string, string | undefined];

  let view: View | undefined;
  if (tail !== undefined) {
    const items = tail.split(",");
    if (items.length !== 2) return { ok: false, problem: "its view is not <p|T>,<cut>" };
    const [letter, cutText] = items as [string, string];
    const mode = letter === "p" ? "isobar" : letter === "T" ? "isotherm" : null;
    if (!mode) return { ok: false, problem: `unknown mode "${letter}"` };
    const cut = linkValue(cutText, "the cut");
    if (!cut.ok) return cut;
    view = { mode, cut: cut.value };
  }

  const items = head.split(",");
  const [first, ...rest] = items as [string, ...string[]];
  if (first !== String(VERSION)) {
    if (Object.hasOwn(PRESETS, first)) {
      if (rest.length > 0) return { ok: false, problem: `the preset id ${first} takes no numbers` };
      const preset = PRESETS[first as PresetId];
      const substance = { name: preset.name, params: preset.params, window: preset.window };
      return { ok: true, value: { substance: { ...substance, auto: true }, view } };
    }
    return {
      ok: false,
      problem: /^\d+$/.test(first)
        ? `version ${first} is not supported`
        : `unknown substance "${first}"`,
    };
  }
  const [nameText = "", ...numberTexts] = rest;
  const count = numberTexts.length;
  if (count !== PARAM_KEYS.length && count !== PARAM_KEYS.length + WINDOW_KEYS.length) {
    return { ok: false, problem: `it has ${count} numbers, not 10 or 14` };
  }
  let name: string;
  try {
    name = decodeURIComponent(nameText);
  } catch {
    return { ok: false, problem: "its name is not encoded right" };
  }
  const keys = [...PARAM_KEYS, ...WINDOW_KEYS].slice(0, count);
  const values = {} as Record<FieldKey, number>;
  for (const [k, key] of keys.entries()) {
    const x = linkValue(numberTexts[k] as string, key);
    if (!x.ok) return x;
    values[key] = x.value;
  }
  const auto = count === PARAM_KEYS.length;
  // Without the window edges `substanceFrom` leaves the window unset; the automatic one replaces it.
  const { params, window } = substanceFrom(values);
  return {
    ok: true,
    value: {
      substance: {
        name: cleanName(name),
        params,
        window: auto ? autoWindow(params) : window,
        auto,
      },
      view,
    },
  };
}
