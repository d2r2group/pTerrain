// The Export figure(s) button on its own row above the Parameters panel (plan §8 phase 16 (c)), as
// ThermoBRIDGE's export row: it saves the plots as SVG or PNG images in one ZIP with the
// substance's JSON file. Outside the panel's `<details>`, so it works with the panel closed. Its
// menu holds the cuts (the current cut, or all unique cuts: the three of `seriesCuts`, from the
// top of the diagram down), the plot size and the PNG's DPI; a DPI too large for the figure is
// lowered, and a note under Export figure(s) says so. The choices are kept while the page is open.

import { seriesCuts, seriesName } from "./cutSeries";
import {
  addMetadata,
  buildFigures,
  DEFAULT_PLOT_SIZE,
  PLOT_SIZES,
  pngOf,
  svgText,
  type FigureFormat,
  type FigurePlots,
} from "./figure";
import type { PlotSize } from "./geometry";
import { DOWNLOAD, icon, PICTURE } from "./icons";
import { DEFAULT_DPI, DPIS, fittingDpi } from "./png";
import { stateAtCut, type State, type Store } from "./state";
import { formatShort, toUnit } from "./units";
import { fileName, toLink, toSubstanceFile, type Substance } from "./substanceFile";
import { download } from "./substancePanel";
import { zip, type ZipEntry } from "./zip";

/** The share link of `state` for `substance`: the substance, the mode and the cut. */
function linkOf(substance: Substance, state: Readonly<State>): string {
  const view = { mode: state.mode, cut: state.cuts[state.mode] };
  return location.href.replace(/#.*$/, "") + toLink(substance, view);
}

/** What the Export figure(s) menu chose: a series or not, the plot size and the PNG's DPI. */
export interface FigureOptions {
  series?: boolean;
  size?: PlotSize;
  dpi?: number;
}

/**
 * Saves the figure of `state` for the applied `substance`: `<base>.zip` with the three images in
 * `format` and `<base>.json`, at the plot size `size`. With `series`, `<base>-series.zip` with the
 * three images at each cut of `seriesCuts`, named by their kind first and then the cut,
 * `<base>-<both|diagram|slice>-<nn>-<value><unit>`, each carrying the link to its own cut. A PNG
 * is drawn at `dpi`, or, when the largest image would pass MAX_PNG_PIXELS at it, every image at
 * the largest DPI that fits (`fittingDpi`). Returns the DPI the PNGs were drawn at.
 */
export async function exportFigure(
  store: Store,
  substance: Substance,
  plots: FigurePlots,
  format: FigureFormat,
  { series = false, size = DEFAULT_PLOT_SIZE, dpi = DEFAULT_DPI }: FigureOptions = {},
): Promise<{ dpi: number }> {
  // Text is measured in Lato, not a fallback font, so that the export is the same everywhere.
  await document.fonts?.ready;
  const state = store.state;
  const base = fileName(substance.name).replace(/\.json$/, "");
  const values = series ? seriesCuts(state) : [state.cuts[state.mode]];
  const views = series ? values.map((v) => stateAtCut(state, v)) : [state];
  const figures = buildFigures(plots, views, state, size);
  const used =
    format === "png"
      ? fittingDpi(
          figures.flat().map(({ svg }) => ({
            width: Number(svg.getAttribute("width")),
            height: Number(svg.getAttribute("height")),
          })),
          dpi,
        )
      : dpi;
  const entries: ZipEntry[] = [];
  // By kind, then by cut.
  for (const kind of figures[0]?.keys() ?? []) {
    for (const [k, images] of figures.entries()) {
      const view = views[k]!;
      const { suffix, svg } = images[kind]!;
      addMetadata(svg, substance.name, substance.params, linkOf(substance, view));
      // The whole figure, which has no suffix of its own, is "both" in a series.
      const stem = series
        ? `${base}${suffix || "-both"}-${seriesName(k, view, values[k]!)}`
        : base + suffix;
      entries.push({
        name: `${stem}.${format}`,
        data: format === "svg" ? svgText(svg) : await pngOf(svg, used),
      });
    }
  }
  entries.push({ name: `${base}.json`, data: toSubstanceFile(substance) });
  const bytes = zip(entries);
  download(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
    `${series ? `${base}-series` : base}.zip`,
  );
  return { dpi: used };
}

const FORMATS: readonly { format: FigureFormat; text: string; title: string }[] = [
  {
    format: "svg",
    text: "SVG",
    title: "Vector images at the size chosen above, with the text as text",
  },
  { format: "png", text: "PNG", title: "Images at the size and resolution chosen above" },
];

/** What the note under Export figure(s) says when the DPI was lowered from `chosen` to `used`. */
export const loweredDpiText = (used: number, chosen: number) =>
  `Saved at ${used} DPI: ${chosen} DPI is more than this browser can draw for a figure this size.`;

/**
 * The current cut's value as the menu writes it after *Current cut*, short enough for a phone:
 * "273 K", "0.612 kPa", "6.1e-4 bar".
 */
export function cutValueText(state: Readonly<State>): string {
  const value = state.cuts[state.mode];
  return state.mode === "isobar"
    ? `${formatShort(toUnit(value, state.pressureUnit))} ${state.pressureUnit}`
    : `${formatShort(value)} K`;
}

/** A plot size as the menu writes it. */
const sizeText = ({ width, height }: PlotSize) => `${width} × ${height}`;

/**
 * Appends the row to `container`: Export figure(s) with its menu (the cuts, the plot sizes, the
 * DPIs, then the formats) and the note under it. `plots` and `applied` give the plots and the
 * applied substance at the time of an export, since they are built after the row. The returned
 * `setSwapping` disables Export figure(s) while the axes swap.
 */
export function createFigureMenu(
  container: HTMLElement,
  store: Store,
  plots: () => FigurePlots,
  applied: () => Substance,
): { setSwapping(swapping: boolean): void } {
  const row = document.createElement("div");
  row.className = "figure-row";
  const box = document.createElement("div");
  box.className = "figure-box";
  const figure = document.createElement("button");
  figure.type = "button";
  figure.className = "figure";
  figure.innerHTML = icon(PICTURE, 16);
  const text = document.createElement("span");
  text.textContent = "Export figure(s)…";
  figure.append(text);
  figure.title = "Save the plots as SVG or PNG images, with the substance's JSON file";
  figure.setAttribute("aria-haspopup", "menu");
  figure.setAttribute("aria-expanded", "false");
  const menu = document.createElement("div");
  menu.className = "figure-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Figure format");
  menu.hidden = true;
  /**
   * A group of `menuitemradio`s named `label`, exactly one checked, `first` at first; choosing one
   * keeps the menu open. `chosen` gives the index of the checked one.
   */
  const radioGroup = (cls: string, label: string, texts: readonly string[], first: number) => {
    const group = document.createElement("div");
    group.className = `choice ${cls}`;
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", label);
    const radios = texts.map((t, k) => {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(k === first));
      item.textContent = t;
      item.tabIndex = -1;
      item.addEventListener("click", () => {
        for (const r of radios) r.setAttribute("aria-checked", String(r === item));
      });
      group.append(item);
      return item;
    });
    menu.append(group);
    return {
      radios,
      chosen: () => radios.findIndex((r) => r.getAttribute("aria-checked") === "true"),
    };
  };
  // The current cut, the default, saves the one; all unique cuts saves a series (`seriesCuts`).
  const cuts = radioGroup("cuts", "Cuts", ["Current cut", "All unique cuts"], 0);
  const [currentCut, allCuts] = cuts.radios;
  currentCut!.title = "Save the images at the current cut";
  // Its value in brackets, kept with the cut, the mode and the unit.
  const cutValue = document.createElement("span");
  cutValue.className = "cut-value";
  currentCut!.append(cutValue);
  const showCut = (state: Readonly<State>) => {
    cutValue.textContent = `(${cutValueText(state)})`;
  };
  showCut(store.state);
  store.subscribe(showCut);
  allCuts!.title =
    "Save the images at each distinct cut, from the top of the diagram down: one in each band " +
    "of the same phases, and one through the triple point";
  const sizes = radioGroup(
    "plot-size",
    "Plot size",
    PLOT_SIZES.map(sizeText),
    PLOT_SIZES.indexOf(DEFAULT_PLOT_SIZE),
  );
  const dpis = radioGroup(
    "dpi",
    "PNG resolution",
    DPIS.map((d) => `${d} DPI`),
    DPIS.indexOf(DEFAULT_DPI as (typeof DPIS)[number]),
  );

  const formats = FORMATS.map(({ format, text: label, title }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.dataset.format = format;
    item.innerHTML = icon(DOWNLOAD, 16);
    const span = document.createElement("span");
    span.textContent = label;
    item.append(span);
    item.title = title;
    item.tabIndex = -1;
    menu.append(item);
    return item;
  });
  const items = [...cuts.radios, ...sizes.radios, ...dpis.radios, ...formats];
  // Under Export figure(s), after an export whose DPI was lowered: visible, and announced.
  const note = document.createElement("p");
  note.className = "figure-note";
  note.setAttribute("role", "status");
  box.append(figure, menu, note);
  row.append(box);
  container.append(row);

  const close = (refocus: boolean) => {
    if (menu.hidden) return;
    menu.hidden = true;
    figure.setAttribute("aria-expanded", "false");
    if (refocus) figure.focus();
  };
  const hideNote = () => {
    note.textContent = "";
  };
  const open = () => {
    hideNote();
    menu.hidden = false;
    figure.setAttribute("aria-expanded", "true");
    items[0]!.focus();
  };

  figure.addEventListener("click", () => (menu.hidden ? open() : close(false)));
  figure.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" && menu.hidden) {
      event.preventDefault();
      open();
    } else if (event.key === "Escape" && note.textContent) {
      event.preventDefault();
      hideNote();
    }
  });
  menu.addEventListener("keydown", (event) => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined) {
      event.preventDefault();
      items[(at + step + items.length) % items.length]!.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]!.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  });
  for (const item of formats) {
    item.addEventListener("click", () => {
      close(true);
      hideNote();
      if (figure.disabled) return;
      const options = {
        series: cuts.chosen() === 1,
        size: PLOT_SIZES[sizes.chosen()]!,
        dpi: DPIS[dpis.chosen()]!,
      };
      exportFigure(store, applied(), plots(), item.dataset.format as FigureFormat, options)
        .then(({ dpi }) => {
          // Not over the menu, should it have been opened again meanwhile.
          if (dpi !== options.dpi && menu.hidden) {
            note.textContent = loweredDpiText(dpi, options.dpi);
          }
        })
        .catch((err: unknown) => console.error("pTerrain:", err));
    });
  }
  // A press or focus outside the button and its menu closes it, and the note.
  const outside = (event: Event) => {
    if (box.contains(event.target as Node)) return;
    close(false);
    hideNote();
  };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("focusin", outside);

  return {
    // While the axes swap, the plots are between two modes: there is nothing to export.
    setSwapping(swapping) {
      figure.disabled = swapping;
      if (swapping) close(false);
    },
  };
}
