// The info button right of the p | T toggle, and the About overlay it opens: what the app does,
// then each control as it looks on the page, beside what it does. The controls are copied from
// the page each time the overlay opens, so they show its current state, and removed when it
// closes. The copies are inert, so they can be neither clicked nor focused, and screen readers
// get their names instead.

import { HANDLE_GRIP, icon, INFO, MOON, SUN } from "./icons";
import { createOverlay } from "./overlay";

/**
 * A control to explain: where it is on the page, and the class it needs around it to be styled
 * as there.
 */
interface Key {
  selector: string;
  context: string;
  name: string;
  text: string;
}

const SECTIONS: readonly { heading: string; keys: readonly Key[] }[] = [
  {
    heading: "Above the plots",
    keys: [
      {
        selector: ".main-row .mode-toggle",
        context: "main-row",
        name: "p | T",
        text:
          "Switches between cutting along an isobar (<i>g</i> against <i>T</i>) and an isotherm " +
          "(<i>g</i> against <i>p</i>). The filled half is in use.",
      },
      {
        selector: "header .theme-toggle",
        context: "",
        name: "Theme",
        text: "Switches between the light and dark theme.",
      },
      {
        selector: ".plot-bar .preset",
        context: "plot-bar",
        name: "Substance menu",
        text: "Chooses H₂O or CO₂, from reference data, or Custom, a schematic substance to edit.",
      },
      {
        selector: ".plot-bar .metastable-toggle",
        context: "plot-bar",
        name: "Metastable",
        text: "Shows or hides the dashed metastable extensions of the boundaries and <i>g</i> curves.",
      },
      {
        selector: ".plot-bar .share",
        context: "plot-bar",
        name: "Share",
        text:
          "Copies a link (on a phone, opens the share menu) that restores this view and the " +
          "substance, a custom one with its name and every parameter.",
      },
    ],
  },
  {
    heading: "Beside the plots, or below them on a phone",
    keys: [
      {
        selector: ".cut-input .unit-toggle",
        context: "",
        name: "kPa | bar | atm",
        text: "Shows pressures in kPa, bar or atm.",
      },
      {
        selector: ".controls .exaggerate",
        context: "",
        name: "Exaggerate s-l slope",
        text:
          "Enlarges Δ<i>v</i><sub>fus</sub> until a nearly vertical solid–liquid line, as for " +
          "water, visibly leans. The plots become schematic.",
      },
      {
        selector: ".parameters summary",
        context: "parameters",
        name: "Parameters",
        text: "Shows or hides the substance's parameters and the plot window, to edit them.",
      },
      {
        selector: ".parameters .apply",
        context: "parameters",
        name: "Apply",
        text:
          "Checks the edited parameters and redraws the plots (or press Enter); a failed check " +
          "is listed and nothing changes. With <i>auto</i> ticked, the window is fitted.",
      },
      {
        selector: ".parameters .file-actions",
        context: "parameters",
        name: "Import and Export",
        text: "Saves the applied substance as a JSON file, or loads one.",
      },
    ],
  },
  {
    heading: "At the bottom",
    keys: [
      {
        selector: ".model-details-button",
        context: "",
        name: "Model Details",
        text: "Opens how the model works: its equations, substance data and limits.",
      },
    ],
  },
];

/** The overlay's body: the summary, then one list of controls for each part of the page. */
export function aboutHtml(): string {
  const sections = SECTIONS.map(
    ({ heading, keys }) =>
      `<section><h3>${heading}</h3><dl>` +
      keys
        .map(
          ({ selector, context, name, text }) =>
            `<dt><span class="visually-hidden">${name}</span>` +
            `<div class="about-key" data-selector="${selector}" data-context="${context}"` +
            ' inert aria-hidden="true"></div></dt>' +
            `<dd>${text}</dd>`,
        )
        .join("") +
      "</dl></section>",
  ).join("");
  return `
<p>pTerrain draws the pressure–temperature phase diagram of a pure substance from a molar Gibbs
free energy <i>g</i>(<i>T</i>, <i>p</i>) for its solid, liquid and vapor. Below it, the slice
plots each phase's <i>g</i> along a cut, an isobar or an isotherm: the lowest <i>g</i> is
stable, so where two curves cross, the cut crosses a phase boundary.</p>
<ul>
  <li>Drag the <svg class="about-handle" viewBox="-12 -12 24 24" aria-hidden="true"><circle
    r="11"/><path d="${HANDLE_GRIP}"/></svg><span class="visually-hidden">circle with up and down
    arrows</span> in the upper plot to change the cut shown in the lower plot.</li>
  <li>Use water or CO₂, or edit your own substance.</li>
  <li>Show metastable extensions, or exaggerate a steep solid–liquid line.</li>
  <li>Save a substance as a file, or share a link to it.</li>
</ul>
${sections}`;
}

/**
 * Fills each key with a copy of its control on the page, without the ids, tooltips and disabled
 * states of the original, so that it looks as the control does in use.
 */
function fillKeys(body: HTMLElement): void {
  for (const key of body.querySelectorAll<HTMLElement>(".about-key")) {
    const control = document.querySelector(key.dataset.selector!);
    if (!control) throw new Error(`pTerrain: the About overlay found no ${key.dataset.selector}`);
    const copy = control.cloneNode(true) as Element;
    const originals = [control, ...control.querySelectorAll("*")];
    [copy, ...copy.querySelectorAll("*")].forEach((el, k) => {
      for (const attribute of ["id", "for", "title", "disabled"]) el.removeAttribute(attribute);
      // A clone keeps the markup's choice, not the one made since.
      const original = originals[k];
      if (el instanceof HTMLSelectElement) el.value = (original as HTMLSelectElement).value;
      if (el instanceof HTMLInputElement) el.checked = (original as HTMLInputElement).checked;
    });
    copy.querySelectorAll('input[type="file"]').forEach((el) => el.remove());
    key.replaceChildren(copy);
    // The theme button shows one symbol at a time; its key shows both, moon / sun.
    if (copy.classList.contains("theme-toggle")) {
      const other = copy.cloneNode() as Element;
      copy.innerHTML = icon(MOON);
      other.innerHTML = icon(SUN);
      const slash = document.createElement("span");
      slash.className = "about-slash";
      slash.textContent = "/";
      key.append(slash, other);
    }
    if (key.dataset.context) key.classList.add(key.dataset.context);
  }
}

/** Empties the keys again, so that the page holds each control and its classes only once. */
function emptyKeys(body: HTMLElement): void {
  for (const key of body.querySelectorAll<HTMLElement>(".about-key")) {
    key.replaceChildren();
    key.className = "about-key";
  }
}

/** The info button, appended to `row`, and the About overlay, appended to `container`. */
export function createAbout(row: HTMLElement, container: HTMLElement): void {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "info-button";
  button.innerHTML = icon(INFO, 22);
  button.setAttribute("aria-label", "About");
  button.title = "What pTerrain does, and what each of its buttons is for";
  row.append(button);
  const dialog = createOverlay(container, button, "about", "About pTerrain", aboutHtml(), fillKeys);
  dialog.addEventListener("close", () => emptyKeys(dialog));
}
