// The figure export (plan §8 phase 16 (c)), as ThermoBRIDGE's: the two plots as SVG or PNG images
// in the light theme, built from the page's own SVGs. Three images: both plots together, and each
// plot on its own, redrawn to stand alone; for a series, three at each of its cuts. The plots are
// first drawn as the export shows them, at the plot size chosen in the menu, and drawn back
// afterwards. The diagram's regions are vector paths (regionPaths.ts), not the screen's raster.
// Everything that touches the page runs in one synchronous task, so no frame shows the light
// theme, another cut or the export's size.

import { axisBottom, select } from "d3";
import type { Params, Phase } from "../physics/gibbs";
import { regionAreas } from "../physics/regionAreas";
import { frameTopRight, MARGIN, SLICE_MARGIN, type PlotSize } from "./geometry";
import type { PlotHandle } from "./phaseDiagram";
import { pngSide, withPhys } from "./png";
import { regionPaths } from "./regionPaths";
import type { State } from "./state";
import { axisSpec } from "./units";

export type FigureFormat = "svg" | "png";

/**
 * The plot sizes the Figure menu offers, CSS px, the same for both plots and half as tall as wide,
 * and the one chosen at first.
 */
export const PLOT_SIZES: readonly PlotSize[] = [
  { width: 360, height: 180 },
  { width: 540, height: 270 },
  { width: 720, height: 360 },
];
export const DEFAULT_PLOT_SIZE = PLOT_SIZES[2]!;

/** The two plots, as the figure redraws them. */
export interface FigurePlots {
  diagram: PlotHandle;
  slice: PlotHandle;
}

/** One image of the figure: its name's suffix ("", "-diagram" or "-slice") and its SVG. */
export interface FigureImage {
  suffix: string;
  svg: SVGSVGElement;
}

/** Room around what an image holds, CSS px. */
const PAD = 8;
/** The one font the images name, with a fallback. */
const FONT = "Lato, sans-serif";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Each phase's region color, as the diagram's raster takes it. */
const PHASE_VAR: Record<Phase, string> = {
  s: "--phase-solid",
  l: "--phase-liquid",
  v: "--phase-vapor",
};

/**
 * The properties inlined from the computed style. All are inherited, so an element writes only
 * those that differ from its parent's; `opacity` is not, so it is written when it is not 1.
 */
const INHERITED = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "paint-order",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant-numeric",
  "text-anchor",
  "dominant-baseline",
  "white-space",
  "visibility",
] as const;

/** Presentation attributes (d3's axes set some) that the inlined style replaces. */
const PRESENTATION = [...INHERITED, "opacity", "font-family"];

/**
 * What an image leaves out: the cut's handle (with its ping and focus ring) and hit band, and the
 * hatched strips where the cut meets no boundary, with their pattern. They belong to moving the
 * cut, not to the diagram.
 */
const INTERACTIVE = ".cut-handle, .cut-hit, .reach, .reach-hatch";

/** A computed `url(...)` reference, which may carry the page's address, as `url(#id)`. */
function localUrl(value: string): string {
  return value.replace(/url\((["']?)[^)#]*#([^)"']+)\1\)/g, "url(#$2)");
}

/**
 * Inlines the computed style of every element under `root` (in the page, so the page's CSS
 * applies), drops the elements that are not displayed, and strips the classes, ids (but those of
 * what `<defs>` holds), roles, ARIA and data attributes, tab stops and `<title>` tooltips. An
 * element in `whole` (and `root`) writes every property, so that it can be moved under another
 * parent.
 */
function inlineStyles(root: SVGElement, whole: ReadonlySet<Element> = new Set()): void {
  const styles = new Map<Element, CSSStyleDeclaration>();
  const all = [root, ...root.querySelectorAll("*")];
  for (const el of all) styles.set(el, getComputedStyle(el));
  const written = new Map<Element, string>();
  for (const el of all) {
    const cs = styles.get(el)!;
    const inDefs = el.closest("defs") !== null;
    if (!inDefs && cs.display === "none") continue;
    const parent = el === root || whole.has(el) ? null : styles.get(el.parentElement!);
    const parts: string[] = [];
    for (const prop of INHERITED) {
      const value = localUrl(cs.getPropertyValue(prop));
      if (value && (!parent || parent.getPropertyValue(prop) !== cs.getPropertyValue(prop))) {
        parts.push(`${prop}:${value}`);
      }
    }
    if (cs.opacity !== "1") parts.push(`opacity:${cs.opacity}`);
    if (el === root || whole.has(el)) parts.push(`font-family:${FONT}`);
    written.set(el, parts.join(";"));
  }
  for (const el of all) {
    if (!el.isConnected || !root.contains(el)) continue;
    const style = written.get(el);
    if (style === undefined || el.tagName.toLowerCase() === "title") {
      el.remove();
      continue;
    }
    for (const name of [...el.getAttributeNames()]) {
      const keepId = name === "id" && el.closest("defs") !== null;
      if (
        (name === "id" && !keepId) ||
        name === "class" ||
        name === "role" ||
        name === "tabindex" ||
        name === "style" ||
        name.startsWith("aria-") ||
        name.startsWith("data-") ||
        PRESENTATION.includes(name)
      ) {
        el.removeAttribute(name);
      }
    }
    if (style) el.setAttribute("style", style);
  }
}

/** Where a clone waits in the page: out of sight, and out of the flow, so the page keeps its layout. */
const ASIDE = "position:absolute;left:-100000px;top:0";

/** A clone of `live` beside it in the page, out of sight, with the controls removed. */
function cloneBeside(live: SVGSVGElement): SVGSVGElement {
  const clone = live.cloneNode(true) as SVGSVGElement;
  for (const el of clone.querySelectorAll(INTERACTIVE)) el.remove();
  clone.style.cssText = ASIDE;
  clone.setAttribute("aria-hidden", "true");
  live.after(clone);
  return clone;
}

/** `inlineStyles` on a clone from `cloneBeside`, which stays out of the page's flow. */
function inlineClone(clone: SVGSVGElement, whole?: ReadonlySet<Element>): void {
  inlineStyles(clone, whole);
  clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};${ASIDE}`);
}

/** The smallest box that holds both, or `b` alone where `a` is empty. */
function union(a: DOMRect | null, b: DOMRect): DOMRect {
  if (!a || a.width * a.height === 0) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return new DOMRect(x, y, Math.max(a.right, b.right) - x, Math.max(a.bottom, b.bottom) - y);
}

/**
 * The box of what `svg` shows, in its own user units. `getBBox` ignores clipping, and the slice
 * panel's curves run far past its g axis under their clip, so a clipped element counts only as
 * far as its clip's box, mapped into the SVG's units.
 */
function shownBox(svg: SVGSVGElement): DOMRect {
  const clipped = [...svg.querySelectorAll<SVGGraphicsElement>("[clip-path]")];
  const styles = clipped.map((el) => el.getAttribute("style"));
  for (const el of clipped) el.style.display = "none";
  // `getBBox` gives an SVGRect, which has no right or bottom in every browser.
  const { x, y, width, height } = svg.getBBox();
  let box: DOMRect | null = new DOMRect(x, y, width, height);
  clipped.forEach((el, k) => {
    const style = styles[k];
    if (style === null || style === undefined) el.removeAttribute("style");
    else el.setAttribute("style", style);
  });
  const toSvg = svg.getScreenCTM()?.inverse();
  for (const el of clipped) {
    const id = /url\(["']?#([^"')]+)/.exec(el.getAttribute("clip-path") ?? "")?.[1];
    const shape = id && svg.querySelector<SVGGraphicsElement>(`[id="${CSS.escape(id)}"] > *`);
    const at = el.getScreenCTM();
    if (!shape || !at || !toSvg) continue;
    const own = el.getBBox();
    const clip = shape.getBBox();
    const x0 = Math.max(own.x, clip.x);
    const y0 = Math.max(own.y, clip.y);
    const x1 = Math.min(own.x + own.width, clip.x + clip.width);
    const y1 = Math.min(own.y + own.height, clip.y + clip.height);
    if (x1 <= x0 || y1 <= y0) continue;
    const m = toSvg.multiply(at);
    const [a, b] = [
      new DOMPoint(x0, y0).matrixTransform(m),
      new DOMPoint(x1, y1).matrixTransform(m),
    ];
    box = union(
      box,
      new DOMRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)),
    );
  }
  return box;
}

/** The box of what `svg` shows (`shownBox`), padded by PAD. */
function paddedBox(svg: SVGSVGElement): DOMRect {
  const b = shownBox(svg);
  return new DOMRect(b.x - PAD, b.y - PAD, b.width + 2 * PAD, b.height + 2 * PAD);
}

/** Sizes `svg` to `box`, its own user units being CSS px. */
function fitTo(svg: SVGSVGElement, box: DOMRect): void {
  svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
  svg.setAttribute("width", String(Math.ceil(box.width)));
  svg.setAttribute("height", String(Math.ceil(box.height)));
  svg.removeAttribute("style");
}

/** The diagram's regions as one path per phase, in plot-area px (regionPaths.ts). */
type RegionPaths = { phase: Phase; d: string }[];

/**
 * Puts the diagram's regions at the bottom of `clone`: a group at the plot area's corner, at the
 * region opacity, with one path per phase in its color. Its fills and opacity are the page's
 * custom properties, set through `style`, which `inlineClone` then resolves in the light theme.
 */
function prependRegions(clone: SVGSVGElement, paths: RegionPaths): void {
  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  group.style.opacity = "var(--region-opacity)";
  for (const { phase, d } of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.style.fill = `var(${PHASE_VAR[phase]})`;
    path.style.stroke = "none";
    group.append(path);
  }
  clone.prepend(group);
}

/** The bottom of an element's box in its parent's units: its translate plus its box's bottom. */
function bottomOf(el: SVGGraphicsElement): number {
  const b = el.getBBox();
  const m = /translate\(\s*[-\d.e]+[ ,]+([-\d.e]+)\s*\)/.exec(el.getAttribute("transform") ?? "");
  return (m ? Number(m[1]) : 0) + b.y + b.height;
}

/**
 * Draws the ticked x axis with its numbers into `axis`, at plot-area height `y`: the slice panel's
 * ticks and numbers (`axisSpec`), with d3's axis offset 0.
 */
function drawXAxis(axis: SVGGElement, state: Readonly<State>, size: PlotSize, y: number): void {
  const x = axisSpec(
    state.mode === "isobar" ? "T" : "p",
    state.window,
    state.pressureUnit,
    [0, size.width],
    Math.floor(size.width / 80),
  );
  select(axis)
    .attr("transform", `translate(${MARGIN.left},${y})`)
    .call(axisBottom(x.scale).offset(0).tickValues(x.ticks).tickFormat(x.format).tickSizeOuter(0));
}

/** The x-axis label's baseline gap under what is above it, CSS px. */
const LABEL_GAP = 15;

/**
 * The three images of what the plots now show, for `state`: both plots together (the diagram's
 * top at y 0, the slice panel's at `offset`), the diagram alone and the slice panel alone, with
 * the region paths `regions` under the diagram. The clones wait in the page until `pieces` are
 * removed.
 */
function capture(
  plots: FigurePlots,
  state: Readonly<State>,
  size: PlotSize,
  offset: number,
  regions: RegionPaths,
  pieces: SVGSVGElement[],
): FigureImage[] {
  const { diagram, slice } = plots;
  // Both plots together.
  const fullDiagram = cloneBeside(diagram.svg);
  const fullSlice = cloneBeside(slice.svg);
  pieces.push(fullDiagram, fullSlice);
  prependRegions(fullDiagram, regions);
  // What the slice panel alone takes from the diagram, styled to stand under any parent.
  const values = fullDiagram.querySelector(".transition-values")!;
  const xLabel = fullDiagram.querySelector(".x-label")!;
  inlineClone(fullDiagram, new Set([values, xLabel]));
  inlineClone(fullSlice);

  // The diagram alone: no guide lines or bold values, and the x axis with its numbers.
  const lone = cloneBeside(diagram.svg);
  pieces.push(lone);
  prependRegions(lone, regions);
  for (const el of lone.querySelectorAll(".guides, .transition-values")) el.remove();
  const loneAxis = lone.querySelector<SVGGElement>(".x-axis")!;
  drawXAxis(loneAxis, state, size, MARGIN.top + size.height);
  const lowest = bottomOf(loneAxis) + LABEL_GAP;
  const loneLabel = lone.querySelector(".x-label")!;
  if (Number(loneLabel.getAttribute("y")) < lowest) loneLabel.setAttribute("y", String(lowest));
  inlineClone(lone);

  // The slice panel alone: no guide lines, and the x axis at the bottom with its numbers, the bold
  // values under them and the x-axis label under those; the frame closes along the top.
  const loneSlice = cloneBeside(slice.svg);
  pieces.push(loneSlice);
  for (const el of loneSlice.querySelectorAll(".guides")) el.remove();
  const sliceAxis = loneSlice.querySelector<SVGGElement>(".x-axis")!;
  drawXAxis(sliceAxis, state, size, SLICE_MARGIN.top + size.height);
  loneSlice.querySelector(".frame")?.setAttribute("d", frameTopRight(size));
  inlineClone(loneSlice);
  const axes = loneSlice.querySelector<SVGGElement>(":scope > g:last-of-type") ?? loneSlice;
  let below = bottomOf(sliceAxis);
  // The values' ticks are left out: under the numbers they would point at nothing.
  const bold = values.cloneNode(true) as SVGGElement;
  for (const tick of bold.querySelectorAll("line")) tick.remove();
  axes.append(bold);
  bold.setAttribute("transform", `translate(${SLICE_MARGIN.left},${below - 4})`);
  if (bold.getBBox().height > 0) below = bottomOf(bold);
  const label = xLabel.cloneNode(true) as SVGTextElement;
  axes.append(label);
  label.setAttribute("y", String(below + LABEL_GAP));

  // The boxes are measured while the clones are in the page.
  const boxes = new Map([fullDiagram, fullSlice, lone, loneSlice].map((p) => [p, paddedBox(p)]));
  const whole = document.createElementNS(SVG_NS, "svg");
  const dBox = boxes.get(fullDiagram)!;
  const sBox = boxes.get(fullSlice)!;
  const top = Math.min(dBox.y, offset + sBox.y);
  const left = Math.min(dBox.x, sBox.x);
  const bottom = Math.max(dBox.bottom, offset + sBox.bottom);
  const right = Math.max(dBox.right, sBox.right);
  for (const [piece, y] of [
    [fullDiagram, 0],
    [fullSlice, offset],
  ] as const) {
    piece.removeAttribute("style");
    piece.setAttribute("x", "0");
    piece.setAttribute("y", String(y));
    piece.setAttribute("overflow", "visible");
    whole.append(piece);
  }
  fitTo(whole, new DOMRect(left, top, right - left, bottom - top));
  whole.setAttribute("style", `font-family:${FONT}`);
  fitTo(lone, boxes.get(lone)!);
  lone.setAttribute("style", `font-family:${FONT}`);
  fitTo(loneSlice, boxes.get(loneSlice)!);
  loneSlice.setAttribute("style", `font-family:${FONT}`);
  return [
    { suffix: "", svg: whole },
    { suffix: "-diagram", svg: lone },
    { suffix: "-slice", svg: loneSlice },
  ];
}

/**
 * The three images of the figure for each of `views`, in the light theme, at the plot size `size`.
 * The views are states of one substance in one mode: the store's own, or those at the cuts of a
 * series. Each is drawn into the plots at `size` for the export, and `current` is drawn back
 * afterwards at the plots' own size.
 */
export function buildFigures(
  plots: FigurePlots,
  views: readonly Readonly<State>[],
  current: Readonly<State>,
  size: PlotSize,
): FigureImage[][] {
  const { diagram, slice } = plots;
  const html = document.documentElement;
  const theme = html.getAttribute("data-theme");
  const pieces: SVGSVGElement[] = [];
  try {
    html.removeAttribute("data-theme");
    // The two plots are stacked with no gap (main.ts), so the slice panel starts under the
    // diagram's SVG, computed rather than read from the page.
    const offset = MARGIN.top + size.height + MARGIN.bottom;
    // The views share one model and window, and so their regions.
    const { model, window, mode } = views[0] ?? current;
    const regions = regionPaths(regionAreas(model, window), mode, window, size);
    return views.map((view) => {
      diagram.draw(view, size);
      slice.draw(view, size);
      return capture(plots, view, size, offset, regions, pieces);
    });
  } finally {
    for (const p of pieces) if (p.isConnected) p.remove();
    if (theme === null) html.removeAttribute("data-theme");
    else html.setAttribute("data-theme", theme);
    // After the theme is back, so that the bitmap is painted in the page's colors.
    diagram.draw(current);
    slice.draw(current);
  }
}

/** A comment's text: XML comments may not hold `--`. */
const commentText = (text: string) => ` ${text.replace(/-{2,}/g, (m) => m.split("").join(" "))} `;

/** The substance's inputs for an image's comment, in the units the parameter panel takes. */
export function describeParams(p: Params): string {
  return [
    `T_tp = ${p.Tt} K`,
    `p_tp = ${p.pt} kPa`,
    `Δh_fus = ${p.dHfus} kJ/mol`,
    `Δh_vap = ${p.dHvap} kJ/mol`,
    `s_s = ${p.Ss} J/(mol K)`,
    `v_s = ${p.Vs} L/mol`,
    `v_l = ${p.Vl} L/mol`,
    `c_p = ${p.cp.s}, ${p.cp.l}, ${p.cp.v} J/(mol K) (s, l, v)`,
  ].join(", ");
}

/** Gives `svg` its `<title>` and a comment with the app, the substance, the link and the date. */
export function addMetadata(
  svg: SVGSVGElement,
  name: string,
  params: Params,
  link: string,
  date = new Date(),
): void {
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = name;
  const note = document.createComment(
    commentText(
      `pTerrain figure of ${name}. ${describeParams(params)}. Link: ${link}. ` +
        `Exported ${date.toISOString().slice(0, 10)}.`,
    ),
  );
  svg.prepend(title, note);
}

/** `svg` as an SVG file's text. */
export function svgText(svg: SVGSVGElement): string {
  svg.setAttribute("xmlns", SVG_NS);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}\n`;
}

/**
 * `svg` drawn at `dpi` (`dpi / 96` px per CSS px, so that it prints at the SVG's size) over the
 * light background, as PNG bytes whose `pHYs` chunk records the DPI. The SVG drawn embeds Lato; the
 * one passed in is left as it is.
 */
export async function pngOf(
  svg: SVGSVGElement,
  dpi: number,
  background = "#ffffff",
): Promise<Uint8Array> {
  const { FONT_FACES } = await import("./figureFonts");
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const style = document.createElementNS(SVG_NS, "style");
  style.textContent = FONT_FACES;
  copy.prepend(style);
  const width = Number(copy.getAttribute("width"));
  const height = Number(copy.getAttribute("height"));
  const url = URL.createObjectURL(new Blob([svgText(copy)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = pngSide(width, dpi);
    canvas.height = pngSide(height, dpi);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas for the PNG");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/png"));
    if (!blob) throw new Error("the PNG could not be encoded");
    return withPhys(new Uint8Array(await blob.arrayBuffer()), dpi);
  } finally {
    URL.revokeObjectURL(url);
  }
}
