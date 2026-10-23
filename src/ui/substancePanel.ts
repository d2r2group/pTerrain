// The substance panel: the preset menu and the parameter fields with their Apply
// button, name and automatic window, Import, Export and Share, and the warning that lists the
// failed validity checks.

import { autoWindow } from "../physics/autoWindow";
import type { Params, PlotWindow } from "../physics/gibbs";
import { CUSTOM, PRESETS, type PresetId } from "../physics/presets";
import { validate, type ValidityCheck, type ValidityIssue } from "../physics/validity";
import { CHECK, DOWNLOAD, icon, SHARE, UPLOAD } from "./icons";
import type { Store } from "./state";
import {
  cleanName,
  fileName,
  NAME_MAX,
  parseLink,
  parseSubstanceFile,
  toLink,
  toSubstanceFile,
  type Substance,
} from "./substanceFile";
import {
  FIELD_GROUPS,
  matchPreset,
  substanceFrom,
  substanceValues,
  type FieldKey,
} from "./substanceFields";
import { fromUnit, toUnit } from "./units";

/** The fields that hold a pressure: stored in kPa, shown and typed in the chosen unit. */
const PRESSURE_FIELDS: ReadonlySet<FieldKey> = new Set(["pt", "pmin", "pmax"]);

/** The window edges, which the *auto* box fills from the other parameters. */
const WINDOW_FIELDS: ReadonlySet<FieldKey> = new Set(["Tmin", "Tmax", "pmin", "pmax"]);
const NO_FIELDS: ReadonlySet<FieldKey> = new Set();

/** The fields that a failed check points at; empty where no single field is to blame. */
const CHECK_FIELDS: Record<ValidityCheck, readonly FieldKey[]> = {
  finite: [],
  triplePoint: ["Tt", "pt"],
  dHfus: ["dHfus"],
  dHvap: ["dHvap"],
  volume: ["Vs", "Vl"],
  Tmin: ["Tmin"],
  pmin: ["pmin"],
  window: ["Tmax", "pmax"],
  tripleInWindow: ["Tmin", "Tmax", "pmin", "pmax"],
  entropy: [],
  vapourDensity: [],
  singleCrossing: [],
  sublimationEdge: ["Tmin", "pmin"],
  vaporisationEdge: ["Tmax", "pmax"],
};

/** A field value for display, without the rounding noise of a unit conversion. */
function fieldText(x: number): string {
  return String(Number(x.toPrecision(12)));
}

/** How long Share reads *Copied* after copying the link. */
const COPIED_MS = 2000;

/** Gives `button` an icon and a text label; the label alone names it, the icon is hidden. */
function setLabel(button: HTMLButtonElement, body: string, text: string): void {
  const label = document.createElement("span");
  label.textContent = text;
  button.innerHTML = icon(body, 16);
  button.append(label);
}

/** What the panel offers `main.ts`: opening a share link's fragment. */
export interface SubstancePanel {
  /** Imports the fragment's substance and sets its view, or warns about it. */
  openLink(fragment: string): void;
}

/**
 * The preset menu and the parameter panel. Choosing Custom loads
 * the schematic substance `CUSTOM` as a starting point for edits. The menu applies at once and
 * discards unapplied edits; the fields apply only through the Apply button (or Enter), which is
 * enabled while they or the *auto* box differ from what is applied. Apply runs `validate`: if it
 * fails, the fields keep what was typed, a warning lists the failed checks, and the
 * plots keep the last valid substance. While *auto* is ticked the window fields are disabled and
 * show the applied window, and Apply replaces the window with `autoWindow`. Pressures are shown in
 * the chosen unit, but a field that is not edited keeps its exact kPa value, so a unit change does
 * not turn a preset into Custom through rounding. The *Name* field is an edit like the others;
 * Export, Share and Import write and read the applied substance as a file or a
 * link, and an import is applied as Apply would be, with the cuts reset.
 */
export function createSubstancePanel(container: HTMLElement, store: Store): SubstancePanel {
  const root = document.createElement("section");
  root.className = "substance";
  root.setAttribute("aria-label", "Substance");

  const presetLabel = document.createElement("label");
  presetLabel.className = "preset";
  const select = document.createElement("select");
  const ids = Object.keys(PRESETS) as PresetId[];
  for (const id of ids) select.append(new Option(PRESETS[id].name, id));
  // Custom starts from a schematic substance, and is also what the menu shows after an edit.
  // While it is selected, the Custom option reads the applied name.
  const customOption = new Option(CUSTOM.name, "custom");
  select.append(customOption);
  presetLabel.append("Substance ", select);

  const details = document.createElement("details");
  details.className = "parameters";
  const summary = document.createElement("summary");
  summary.textContent = "Parameters";
  const form = document.createElement("form");
  form.noValidate = true;
  const inputs = {} as Record<FieldKey, HTMLInputElement>;
  const unitLabels = new Map<FieldKey, HTMLSpanElement>();
  const ariaNames = new Map<FieldKey, string>();
  const auto = document.createElement("input");
  auto.type = "checkbox";
  auto.checked = true;
  auto.setAttribute("aria-label", "Automatic window");
  const apply = document.createElement("button");
  apply.type = "submit";
  apply.className = "apply";
  apply.textContent = "Apply";
  apply.disabled = true;
  // Import, Export and Share side by side under Apply, together as wide as it.
  const actions = document.createElement("div");
  actions.className = "file-actions";
  const actionButton = (body: string, text: string, title: string) => {
    const button = document.createElement("button");
    button.type = "button";
    setLabel(button, body, text);
    button.title = title;
    actions.append(button);
    return button;
  };
  const importButton = actionButton(UPLOAD, "Import", "Load a substance from a JSON file");
  const exportButton = actionButton(
    DOWNLOAD,
    "Export",
    "Save the applied substance as a JSON file",
  );
  const shareButton = actionButton(
    SHARE,
    "Share",
    "Share a link to the applied substance and this view",
  );
  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = ".json,application/json";
  picker.hidden = true;
  actions.append(picker);
  // Apply, the buttons and the name each take a row of their own above the Triple point fieldset.
  const nameLabel = document.createElement("label");
  nameLabel.className = "name-row";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.name = "name";
  nameInput.maxLength = NAME_MAX;
  nameInput.autocomplete = "off";
  nameInput.setAttribute("aria-label", "Substance name");
  const nameText = document.createElement("span");
  nameText.className = "field-name";
  nameText.textContent = "Name";
  nameLabel.append(nameText, nameInput);
  form.append(apply, actions, nameLabel);
  for (const { legend, fields } of FIELD_GROUPS) {
    const set = document.createElement("fieldset");
    const title = document.createElement("legend");
    title.textContent = legend;
    set.append(title);
    const isWindow = fields.every(([key]) => WINDOW_FIELDS.has(key));
    if (isWindow) {
      const autoLabel = document.createElement("label");
      autoLabel.className = "auto";
      autoLabel.title = "Fit the window to the other parameters on Apply";
      autoLabel.append(auto, "auto");
      title.append(" ", autoLabel);
    }
    for (const [key, html, unit] of fields) {
      const label = document.createElement("label");
      const name = document.createElement("span");
      name.className = "field-name";
      name.innerHTML = html;
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.inputMode = "decimal";
      input.name = key;
      // The visible label runs the subscript into the name and the unit ("TtK"), so it is spelled out.
      ariaNames.set(key, `${legend}: ${name.textContent}`);
      input.setAttribute("aria-label", `${legend}: ${name.textContent} (${unit})`);
      const units = document.createElement("span");
      units.className = "field-unit";
      units.textContent = unit;
      label.append(name, input, units);
      set.append(label);
      inputs[key] = input;
      unitLabels.set(key, units);
    }
    form.append(set);
  }
  details.append(summary, form);

  const warning = document.createElement("div");
  warning.className = "validation";
  warning.setAttribute("role", "alert");
  root.append(presetLabel, details, warning);
  container.append(root);

  const keys = Object.keys(inputs) as FieldKey[];

  /** Marks the fields to blame and lists the issues; the `exempt` fields are never blamed. */
  const showIssues = (
    issues: readonly ValidityIssue[],
    values: Record<FieldKey, number>,
    exempt = NO_FIELDS,
  ) => {
    const blamed = new Set<FieldKey>(issues.flatMap(({ check }) => CHECK_FIELDS[check]));
    for (const key of keys) {
      const bad = !exempt.has(key) && (blamed.has(key) || !Number.isFinite(values[key]));
      inputs[key].toggleAttribute("aria-invalid", bad);
    }
    if (issues.length === 0) {
      warning.replaceChildren();
      return;
    }
    const intro = document.createElement("p");
    intro.textContent = "These parameters are not applied, so the plots show the last valid ones:";
    const list = document.createElement("ul");
    list.append(
      ...issues.map(({ check, message }) => {
        const item = document.createElement("li");
        item.dataset.check = check;
        item.textContent = message;
        return item;
      }),
    );
    warning.replaceChildren(intro, list);
  };

  /** The unit the pressure fields show; it lags the store's while a unit change is converted. */
  let unit = store.state.pressureUnit;
  /** What each field was last filled with, and the exact value (in kPa) that text stands for. */
  const filled = new Map<FieldKey, { text: string; value: number }>();
  const show = (key: FieldKey, value: number) => {
    const text = fieldText(PRESSURE_FIELDS.has(key) ? toUnit(value, unit) : value);
    inputs[key].value = text;
    filled.set(key, { text, value });
  };

  /**
   * A field's value, in kPa for a pressure; the exact filled value while it is not edited. A
   * typed pressure is rounded to 12 figures, so that 0.3 bar is 30 kPa and not 30.000000000000004.
   */
  const valueOf = (key: FieldKey) => {
    const last = filled.get(key);
    if (last && inputs[key].value === last.text) return last.value;
    const typed = inputs[key].valueAsNumber;
    return PRESSURE_FIELDS.has(key) ? Number(fromUnit(typed, unit).toPrecision(12)) : typed;
  };

  const showUnits = () => {
    for (const key of PRESSURE_FIELDS) {
      (unitLabels.get(key) as HTMLSpanElement).textContent = unit;
      inputs[key].setAttribute("aria-label", `${ariaNames.get(key)} (${unit})`);
    }
  };

  /** The applied name: the panel's own state, like `appliedAuto`, not the store's. */
  const startId = matchPreset(store.state.params, store.state.window);
  let appliedName = startId ? PRESETS[startId].name : CUSTOM.name;

  /**
   * Selects `id` in the menu, the matching preset or Custom; the Custom option reads the applied
   * name while the applied substance is custom, and *Custom* otherwise.
   */
  const showMenu = (id: PresetId | "custom") => {
    select.value = id;
    const { params, window } = store.state;
    customOption.text = matchPreset(params, window) === null ? appliedName : CUSTOM.name;
  };

  const fill = (params: Params, window: PlotWindow, name: string) => {
    const values = substanceValues(params, window);
    for (const key of keys) show(key, values[key]);
    nameInput.value = name;
    select.value = matchPreset(params, window) ?? "custom";
    showIssues([], values);
  };

  const read = () =>
    Object.fromEntries(keys.map((key) => [key, valueOf(key)])) as Record<FieldKey, number>;

  /** Whether the window was last applied with *auto* ticked; the box itself may differ. */
  let appliedAuto = auto.checked;

  /**
   * Enables Apply while the fields or the *auto* box differ from what is applied. Once they match
   * it again, a warning from a failed Apply no longer holds, and the menu names the applied
   * substance.
   */
  const syncApply = () => {
    const values = read();
    const { params, window } = store.state;
    const now = substanceValues(params, window);
    apply.disabled =
      auto.checked === appliedAuto &&
      nameInput.value === appliedName &&
      keys.every((key) => values[key] === now[key]);
    if (apply.disabled) {
      showIssues([], values);
      showMenu(matchPreset(params, window) ?? "custom");
    }
  };

  /** Sets *auto*, which disables the window fields, and refills them with the applied window. */
  const setAuto = (on: boolean) => {
    auto.checked = on;
    const values = substanceValues(store.state.params, store.state.window);
    for (const key of WINDOW_FIELDS) {
      inputs[key].disabled = on;
      inputs[key].removeAttribute("aria-invalid");
      show(key, values[key]);
    }
  };

  select.addEventListener("change", () => {
    const preset = select.value === "custom" ? CUSTOM : PRESETS[select.value as PresetId];
    if (!preset) return;
    appliedName = preset.name;
    fill(preset.params, preset.window, preset.name);
    store.setSubstance(preset.params, preset.window, { resetCuts: true });
    setAuto(appliedAuto);
    syncApply();
  });

  auto.addEventListener("change", () => {
    setAuto(auto.checked);
    syncApply();
  });
  form.addEventListener("input", syncApply);

  /**
   * Applies the fields, the name and the box, as Apply does; with `resetCuts` (an import) both
   * cuts go to their defaults, as for a menu choice. Returns whether they passed `validate`.
   */
  const applyFields = (resetCuts: boolean) => {
    const values = read();
    const { params, window: typed } = substanceFrom(values);
    const window = auto.checked ? autoWindow(params) : typed;
    const issues = validate(params, window);
    const ok = issues.length === 0;
    if (ok) {
      appliedAuto = auto.checked;
      appliedName = cleanName(nameInput.value);
      nameInput.value = appliedName;
      store.setSubstance(params, window, { resetCuts });
      if (auto.checked) setAuto(true);
    }
    showMenu(ok ? (matchPreset(params, window) ?? "custom") : "custom");
    // An automatic window that fails is the rule's doing, not a window field's.
    showIssues(issues, values, auto.checked ? WINDOW_FIELDS : NO_FIELDS);
    syncApply();
    return ok;
  };

  // Apply, or Enter in a field, applies the fields instead of reloading the page.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    applyFields(false);
  });

  /** Fills the name, every field and the box with `substance`, and applies them with the cuts reset. */
  const importSubstance = ({ name, params, window, auto: on }: Substance) => {
    nameInput.value = name;
    const values = substanceValues(params, window);
    for (const key of keys) show(key, values[key]);
    auto.checked = on;
    for (const key of WINDOW_FIELDS) inputs[key].disabled = on;
    return applyFields(true);
  };

  /** A one-line warning, for a file or link that cannot be read; it changes nothing else. */
  const warn = (text: string) => {
    const line = document.createElement("p");
    line.textContent = text;
    warning.replaceChildren(line);
  };

  /** The applied substance, which Export and Share write: not unapplied edits. */
  const applied = (): Substance => ({
    name: appliedName,
    params: store.state.params,
    window: store.state.window,
    auto: appliedAuto,
  });

  importButton.addEventListener("click", () => picker.click());
  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    // Cleared, so that choosing the same file again imports it again.
    picker.value = "";
    if (!file) return;
    const parsed = parseSubstanceFile(await file.text());
    if (parsed.ok) importSubstance(parsed.value);
    else warn(`Not a pTerrain substance file: ${parsed.problem}.`);
  });

  exportButton.addEventListener("click", () => {
    const { name, params, window, auto: on } = applied();
    const blob = new Blob([toSubstanceFile(name, params, window, on)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(name);
    document.body.append(link);
    link.click();
    link.remove();
    // Revoked later, since some browsers start the download only after the click returns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  });

  /** Shows the link in a read-only, selected field, for when it can be neither shared nor copied. */
  const showLink = (url: string) => {
    const line = document.createElement("p");
    line.textContent = "Copy this link:";
    const field = document.createElement("input");
    field.type = "text";
    field.readOnly = true;
    field.value = url;
    field.className = "share-link";
    field.setAttribute("aria-label", "Share link");
    warning.replaceChildren(line, field);
    field.focus();
    field.select();
  };

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      showLink(url);
      return;
    }
    setLabel(shareButton, CHECK, "Copied");
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => setLabel(shareButton, SHARE, "Share"), COPIED_MS);
  };

  // On a phone (a coarse pointer) the share sheet; elsewhere, or without it, the clipboard.
  shareButton.addEventListener("click", async () => {
    const substance = applied();
    const { mode, cuts } = store.state;
    const url = location.href.replace(/#.*$/, "") + toLink(substance, { mode, cut: cuts[mode] });
    const phone = matchMedia("(pointer: coarse)").matches;
    if (phone && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: substance.name, url });
        return;
      } catch (err) {
        // Closing the share sheet is not a failure.
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    await copy(url);
  });

  // A unit change converts the pressure fields, typed but unapplied ones included, and changes
  // nothing in the store.
  store.subscribe((state) => {
    if (state.pressureUnit === unit) return;
    const values = new Map([...PRESSURE_FIELDS].map((key) => [key, valueOf(key)]));
    unit = state.pressureUnit;
    for (const [key, value] of values) if (Number.isFinite(value)) show(key, value);
    showUnits();
  });

  showUnits();
  fill(store.state.params, store.state.window, appliedName);
  setAuto(auto.checked);

  return {
    openLink(fragment: string) {
      const parsed = parseLink(fragment);
      if (!parsed.ok) {
        warn(`Not a pTerrain link: ${parsed.problem}.`);
        return;
      }
      const { substance, view } = parsed.value;
      if (!importSubstance(substance) || !view) return;
      // A cut outside the new limits is clamped, as a typed one would be.
      store.setMode(view.mode);
      store.setCut(view.cut);
    },
  };
}
