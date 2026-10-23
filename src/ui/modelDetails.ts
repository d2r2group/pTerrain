// The footer and the Model Details overlay: links to the group's site and the source, and a
// button that opens a modal <dialog> with a condensed account of the model. The math is
// written in TeX in tagged templates, tex (inline) and display, which scripts/renderMath.mjs
// renders to SVG beforehand (src/assets/math.json), so the page loads no math library or font.
// The substance table is built from presets.ts, so its numbers cannot drift from the model.

import MATH from "../assets/math.json";
import { PRESETS, type PresetId } from "../physics/presets";
import { GLOBE, icon } from "./icons";
import { createRepoLink } from "./repoLink";
import { FIELD_GROUPS, substanceValues, type FieldKey } from "./substanceFields";

/** A formula as rendered by scripts/renderMath.mjs; `npm run math` adds new ones. */
function rendered(mode: "tex" | "display", strings: TemplateStringsArray): string {
  const svg = (MATH.math as Record<string, string>)[`${mode}:${strings.raw[0]}`];
  if (svg === undefined) throw new Error(`pTerrain: run \`npm run math\` for ${strings.raw[0]}`);
  return svg;
}

/** Inline math, in TeX. No interpolation: the renderer reads the template from this file. */
function tex(strings: TemplateStringsArray): string {
  return rendered("tex", strings);
}

/** Display math, in TeX, on a line of its own. */
function display(strings: TemplateStringsArray): string {
  return `<div class="equation">${rendered("display", strings)}</div>`;
}

/** The inputs of the model; the window edges are left out of the table. */
type InputKey = Exclude<FieldKey, "Tmin" | "Tmax" | "pmin" | "pmax">;

/** Each input as the overlay writes it. */
const SYMBOL: Record<InputKey, string> = {
  Tt: tex`T_\mathrm{t}`,
  pt: tex`p_\mathrm{t}`,
  dHfus: tex`\Delta h_\mathrm{fus}`,
  dHvap: tex`\Delta h_\mathrm{vap}`,
  Ss: tex`s_\mathrm{s}`,
  Vs: tex`v_\mathrm{s}`,
  Vl: tex`v_\mathrm{l}`,
  cps: tex`c_{p,\mathrm{s}}`,
  cpl: tex`c_{p,\mathrm{l}}`,
  cpv: tex`c_{p,\mathrm{v}}`,
};

const NIST = "NIST";
const SPAN_WAGNER = "NIST (Span–Wagner)";
const IAPWS = "IAPWS R10-06";

/** Where each preset input comes from. */
const SOURCES: Record<PresetId, Record<InputKey, string>> = {
  h2o: {
    Tt: NIST,
    pt: NIST,
    dHfus: IAPWS,
    dHvap: NIST,
    Ss: `${tex`s_\mathrm{l} - \Delta h_\mathrm{fus}/T_\mathrm{t}`} (CODATA, NIST)`,
    Vs: IAPWS,
    Vl: NIST,
    cps: IAPWS,
    cpl: NIST,
    cpv: NIST,
  },
  co2: {
    Tt: SPAN_WAGNER,
    pt: SPAN_WAGNER,
    dHfus: tex`T_\mathrm{t}\,(s_\mathrm{l} - s_\mathrm{s})`,
    dHvap: NIST,
    Ss: "Giauque &amp; Egan (1937)",
    Vs: "Clapeyron, Span–Wagner melting curve",
    Vl: NIST,
    cps: "Giauque &amp; Egan, extrapolated",
    cpl: NIST,
    cpv: NIST,
  },
};

const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

/** The H₂O and CO₂ inputs as an HTML table, one row per input, with their sources. */
export function substanceTable(): string {
  const values = Object.fromEntries(
    PRESET_IDS.map((id) => [id, substanceValues(PRESETS[id].params, PRESETS[id].window)]),
  ) as Record<PresetId, Record<FieldKey, number>>;
  const head = PRESET_IDS.map((id) => `<th scope="col">${PRESETS[id].name}</th>`).join("");
  const rows = FIELD_GROUPS.flatMap(({ fields }) =>
    fields.flatMap(([key, , unit]) => {
      if (!(key in SYMBOL)) return [];
      const input = key as InputKey;
      const cells = PRESET_IDS.map(
        (id) =>
          `<td><span class="value" data-preset="${id}" data-key="${key}">${values[id][key]}</span>` +
          `<span class="source">${SOURCES[id][input]}</span></td>`,
      ).join("");
      return `<tr><th scope="row">${SYMBOL[input]} <span class="unit">(${unit})</span></th>${cells}</tr>`;
    }),
  );
  return (
    '<div class="table-scroll"><table class="substance-table">' +
    `<thead><tr><th scope="col">Input</th>${head}</tr></thead>` +
    `<tbody>${rows.join("")}</tbody></table></div>`
  );
}

/**
 * The overlay's body, in order: 1 Gibbs energies, 2 What follows from
 * them, 3 Compared with integrating Clausius–Clapeyron, 4 Substance data, 5 Limits, 6 Numerics,
 * and a note on how it was made.
 */
export function modelDetailsHtml(): string {
  return `
<section>
  <h3>Gibbs energies</h3>
  <p>Each phase ${tex`i`} has a closed-form molar Gibbs energy referenced to the triple point
  ${tex`(T_\mathrm{t}, p_\mathrm{t})`}, where all three are 0. The solid and the liquid are
  incompressible, the vapour is an ideal gas, and every phase has a constant heat capacity:</p>
  ${display`\begin{aligned} g_i(T, p) &= -s_i\,(T - T_\mathrm{t}) - c_{p,i} \left[ T \ln\frac{T}{T_\mathrm{t}} - (T - T_\mathrm{t}) \right] \\ &\quad {}+ v_i\,(p - p_\mathrm{t}) \qquad (i \in \{\mathrm{s}, \mathrm{l}\}) \\ g_\mathrm{v}(T, p) &= -s_\mathrm{v}\,(T - T_\mathrm{t}) - c_{p,\mathrm{v}} \left[ T \ln\frac{T}{T_\mathrm{t}} - (T - T_\mathrm{t}) \right] \\ &\quad {}+ RT \ln\frac{p}{p_\mathrm{t}}. \end{aligned}`}
  <p>Here ${tex`s_i`} is the molar entropy at the triple point, ${tex`v_i`} the molar volume and
  ${tex`c_{p,i}`} the heat capacity. The inputs are ${SYMBOL.Tt}, ${SYMBOL.pt},
  ${SYMBOL.dHfus}, ${SYMBOL.dHvap}, ${SYMBOL.Ss}, ${SYMBOL.Vs}, ${SYMBOL.Vl} and the three
  ${tex`c_p`}; the other entropies follow from</p>
  ${display`s_\mathrm{l} = s_\mathrm{s} + \frac{\Delta h_\mathrm{fus}}{T_\mathrm{t}}, \qquad s_\mathrm{v} = s_\mathrm{l} + \frac{\Delta h_\mathrm{vap}}{T_\mathrm{t}}.`}
  <p>${SYMBOL.Ss} moves no boundary, but it sets the overall slope of the ${tex`g(T)`}
  curves.</p>
</section>
<section>
  <h3>What follows from them</h3>
  ${display`\left(\frac{\partial g}{\partial T}\right)_p = -s, \qquad \left(\frac{\partial g}{\partial p}\right)_T = v.`}
  <p>So every ${tex`g(T)`} curve falls with ${tex`T`}, the vapour's fastest, with curvature
  ${tex`-c_p/T`}. Along an isotherm the solid and the liquid are straight lines in
  ${tex`g(p)`}, and the vapour rises as ${tex`RT \ln p`}. The stable phase is the one with the
  lowest ${tex`g`}, and the phase boundaries are the lines where two of them are equal,
  ${tex`g_i = g_j`}. Their slope is given by Clausius–Clapeyron,</p>
  ${display`\frac{\mathrm{d}p}{\mathrm{d}T} = \frac{\Delta s}{\Delta v},`}
  <p>so the solid–liquid line slopes back when ${tex`v_\mathrm{s} > v_\mathrm{l}`}, as for
  water.</p>
</section>
<section>
  <h3>Compared with integrating Clausius–Clapeyron</h3>
  <p>A common route builds the diagram boundary by boundary. Each coexistence line is an
  integration of Clausius–Clapeyron, ${tex`\mathrm{d}p/\mathrm{d}T = \Delta h/(T\,\Delta v)`},
  under its own approximations, the triple point is where two lines cross, and the
  solid–vapour line takes ${tex`\Delta h_\mathrm{sub} = \Delta h_\mathrm{fus} + \Delta h_\mathrm{vap}`}.
  With an ideal-gas vapour, ${tex`v_\mathrm{l}`} neglected and a constant
  ${SYMBOL.dHvap}, the liquid–vapour line through a known point
  ${tex`(T_0, p_0)`}, such as the normal boiling point, is</p>
  ${display`\ln\frac{p}{p_0} = -\frac{\Delta h_\mathrm{vap}}{R}\left(\frac{1}{T} - \frac{1}{T_0}\right).`}
  <p>This app starts one step earlier, from a molar ${tex`g`} for each phase. The boundaries
  are where two of them are equal, so Clausius–Clapeyron, the triple point and
  ${tex`\Delta h_\mathrm{sub} = \Delta h_\mathrm{fus} + \Delta h_\mathrm{vap}`} follow from the
  model rather than being imposed: all three lines meet at one point, and their metastable
  extensions come with them. The slice panel needs this approach: the
  boundary-by-boundary one knows only where ${tex`\Delta g = 0`}, not the ${tex`g`} of each
  phase.</p>
  <p>The approximations are made once for each phase (incompressible solid and liquid, an
  ideal-gas vapour, constant ${tex`c_p`}) rather than for each transition. So ${tex`\Delta h`}
  changes with ${tex`T`} through the phases' ${tex`c_p`}, and ${tex`v_\mathrm{l}`} is kept.
  The liquid–vapour line, for example, is</p>
  ${display`\begin{aligned} \ln\frac{p}{p_\mathrm{t}} &= -\frac{\Delta h_\mathrm{vap}}{R}\left(\frac{1}{T} - \frac{1}{T_\mathrm{t}}\right) \\ &\quad {}+ \frac{\Delta c_p}{R}\left(\ln\frac{T}{T_\mathrm{t}} + \frac{T_\mathrm{t}}{T} - 1\right) + \frac{v_\mathrm{l}\,(p - p_\mathrm{t})}{RT}, \end{aligned}`}
  <p>with ${tex`\Delta c_p = c_{p,\mathrm{v}} - c_{p,\mathrm{l}}`}, and it reduces to the
  integrated form when ${tex`\Delta c_p = 0`} and ${tex`v_\mathrm{l}`} is neglected. The
  solid–liquid line differs in the same way: integrating Clapeyron with a constant
  ${SYMBOL.dHfus} gives
  ${tex`p - p_0 = (\Delta h_\mathrm{fus}/\Delta v_\mathrm{fus}) \ln(T/T_0)`}, while the model
  with ${tex`\Delta c_p = 0`} holds ${tex`\Delta s_\mathrm{fus}`} constant and gives a line
  straight in ${tex`T`}; the two agree near the triple point. The inputs are therefore
  properties of each phase rather than differences across each transition: ${SYMBOL.Ss} and
  the separate ${SYMBOL.Vs} and ${SYMBOL.Vl} move no boundary, but they set the slopes of the
  ${tex`g`} curves in the slice.</p>
</section>
<section>
  <h3>Substance data</h3>
  <p>Every input is taken at the triple point (retrieved in October 2026). The fluid data are
  from the NIST Chemistry WebBook (IAPWS-95 for water, Span–Wagner for CO₂) with the CODATA
  standard entropies, ice from IAPWS R10-06 and solid CO₂ from Giauque &amp; Egan (1937).</p>
  ${substanceTable()}
</section>
<section>
  <h3>Limits</h3>
  <ul>
    <li>There is no critical point, so the liquid–vapour line is accurate only well below
    ${tex`T_\mathrm{c}`}. Water stays within 0.5 K of the reference data. For CO₂ the line falls
    6 % low at 233 K and 29 % low at 293 K (${tex`T_\mathrm{c} = 304\,\mathrm{K}`}), so its
    window stops at 275 K.</li>
    <li>${tex`v`} and ${tex`c_p`} are constant for each phase.</li>
    <li>An edited substance is applied only if it passes these checks:
      <ul>
        <li>${SYMBOL.Tt}, ${SYMBOL.pt}, ${SYMBOL.dHfus}, ${SYMBOL.dHvap}, ${SYMBOL.Vs},
        ${SYMBOL.Vl}, ${tex`T_\mathrm{min}`} and ${tex`p_\mathrm{min}`} are positive, and the
        window has ${tex`T_\mathrm{max} > T_\mathrm{min}`} and
        ${tex`p_\mathrm{max} > p_\mathrm{min}`} and holds the triple point.</li>
        <li>Every entropy stays positive over the window.</li>
        <li>The vapour is at least three times less dense than the solid and the liquid:
        ${tex`3 v\, p_\mathrm{max} < R T_\mathrm{min}`}.</li>
        <li>Each pair of ${tex`g`} curves crosses at most once along every isobar and
        isotherm.</li>
        <li>The solid–vapour line leaves the window through ${tex`p_\mathrm{min}`} and the
        liquid–vapour line through ${tex`p_\mathrm{max}`}, not through the ${tex`T`}
        edges.</li>
      </ul>
    </li>
  </ul>
</section>
<section>
  <h3>Numerics</h3>
  <p>The boundaries are traced by bracketing and bisection: the solid–vapour and liquid–vapour
  lines for ${tex`p`} at each ${tex`T`}, the steep solid–liquid line for ${tex`T`} at each
  ${tex`p`}. The crossings along a cut are found by bisection to ${tex`10^{-9}`} relative and
  marked stable or metastable by whether the third ${tex`g`} is higher there. The slice plots
  ${tex`g - \bar{g}`}, the mean of the three ${tex`g`} subtracted from each, which keeps every
  crossing and which phase is lowest while keeping the small solid–liquid gap visible. The
  ${tex`p`} axis is logarithmic, which the real substances need: on a linear one, water's
  triple point would sit in the bottom fraction of a percent.</p>
</section>
<p class="disclaimer">Claude Opus 5.5 (Anthropic) was used in developing this app, in close
iteration under the author's supervision.</p>`;
}

/**
 * The footer after the plots and their controls: a link to d2r2group.com, with a globe, one to
 * the source on GitHub, the Model Details button, which opens the overlay, and the copyright
 * line. Esc, the × button and a click on the backdrop close it, and focus returns to the button.
 */
export function createFooter(container: HTMLElement): void {
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  const link = document.createElement("a");
  link.href = "https://d2r2group.com";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.innerHTML = `${icon(GLOBE, 14)}d2r2group.com`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "model-details-button";
  // g(T, p) as a small formula left of the label; hidden from screen readers, so the name stays
  // "Model Details".
  button.innerHTML = `<span class="button-math" aria-hidden="true">${tex`g(T, p)`}</span>Model Details`;
  button.setAttribute("aria-haspopup", "dialog");
  // The glyphs that every formula references, drawn once, outside the dialog, so that the
  // button's formula has them while the dialog is closed.
  const glyphs = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  glyphs.classList.add("math-glyphs");
  glyphs.setAttribute("aria-hidden", "true");
  glyphs.innerHTML = MATH.defs;
  const copyright = document.createElement("span");
  copyright.className = "copyright";
  copyright.textContent = "2026 © Peter Schindler";
  footer.append(link, createRepoLink(), button, copyright, glyphs);

  const dialog = document.createElement("dialog");
  dialog.className = "model-details";
  dialog.setAttribute("aria-labelledby", "model-details-title");
  dialog.innerHTML =
    '<div class="dialog-head"><h2 id="model-details-title">Model details</h2>' +
    '<button type="button" class="dialog-close" aria-label="Close">×</button></div>' +
    `<div class="dialog-body">${modelDetailsHtml()}</div>`;
  const close = dialog.querySelector<HTMLButtonElement>(".dialog-close")!;

  button.addEventListener("click", () => dialog.showModal());
  close.addEventListener("click", () => dialog.close());
  // The dialog has no padding of its own, so a click on it rather than on its contents is a
  // click on the backdrop. The press must start there too: a text selection dragged out of the
  // body also ends in a click on the dialog.
  let pressedBackdrop = false;
  dialog.addEventListener("pointerdown", (event) => (pressedBackdrop = event.target === dialog));
  dialog.addEventListener("click", (event) => {
    if (pressedBackdrop && event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => button.focus());

  container.append(footer, dialog);
}
