// The p-T phase diagram: stable-phase regions as a bitmap under an SVG with
// the phase names, the boundaries, the triple point, the axes, the draggable horizontal cut
// line, a marker and the upper half of a dotted guide line where the cut meets a boundary
//, the stable transition values in bold under the x axis, and a light hatch
// over the cut values that meet no boundary. Everything is drawn from the
// state's `model`, which has an exaggerated s-l slope while that view is on.

import { axisBottom, axisLeft, easeCubicInOut, line, select, timer } from "d3";
import type { Timer } from "d3";
import { boundary, PAIRS, type Point } from "../physics/boundaries";
import { crossings, type Crossing } from "../physics/crossings";
import { PHASES, triplePoint, type Phase } from "../physics/gibbs";
import { attachCutDrag } from "./cutDrag";
import {
  blendMatrix,
  cutY,
  lerpAffine,
  frameTopRight,
  MARGIN,
  projection,
  RasterCache,
  toScreen,
  type Affine,
  type PlotSize,
} from "./geometry";
import {
  AXIS_LABELS,
  phaseLabels,
  placeNote,
  setAxisLabel,
  spreadApart,
  type Box,
  type PhaseLabel,
} from "./labels";
import { attachPanel, fitSvg, placeYLabel } from "./panel";
import { cutBounds, cutFor, type Mode, type State, type Store } from "./state";
import { PHASE_NAME } from "./substanceFields";
import { onThemeChange } from "./theme";
import { axisSpec, formatPressure, formatTemperature, toUnit } from "./units";

/** Length of the axis-swap animation, ms. */
const SWAP_MS = 700;
/** Height of the hit band around the cut line, CSS px (at least 44). */
const HIT_BAND = 44;
/** Upper limit on the device pixel ratio of the region bitmap; finer gives no visible gain. */
const MAX_DPR = 2;

/** Least space between two bold transition values, CSS px. */
const VALUE_GAP = 6;

/** Spacing of the hatch lines over the cut values out of reach, CSS px. */
const HATCH = 6;

/** The quantity across (x) and up (y) in each mode. */
const AXES: Record<Mode, { x: "T" | "p"; y: "T" | "p" }> = {
  isobar: { x: "T", y: "p" },
  isotherm: { x: "p", y: "T" },
};

// The handle is named after the line it moves, apart from the controls' "pressure" or
// "temperature" slider and number field.
const CUT_LABEL: Record<Mode, string> = {
  isobar: "Isobar line, p*",
  isotherm: "Isotherm line, T*",
};

const PHASE_VAR: Record<Phase, string> = {
  s: "--phase-solid",
  l: "--phase-liquid",
  v: "--phase-vapor",
};

interface Traced {
  pair: string;
  stable: boolean;
  points: Point[];
}

/** A bold transition value under the x axis, at the plot-area x of its crossing. */
interface TransitionValue {
  x: number;
  text: string;
}

/** Builds the diagram inside `container` and keeps it in sync with `store`. */
export function createPhaseDiagram(container: HTMLElement, store: Store): void {
  const root = select(container).classed("phase-diagram", true);
  const canvas = root.append("canvas").attr("class", "regions").attr("aria-hidden", "true");
  const svg = root
    .append("svg")
    .attr("role", "img")
    .attr("aria-label", "p-T phase diagram with a horizontal cut");
  const hatchId = `reach-hatch-${Math.random().toString(36).slice(2)}`;
  svg
    .append("defs")
    .append("pattern")
    .attr("id", hatchId)
    .attr("class", "reach-hatch")
    .attr("patternUnits", "userSpaceOnUse")
    .attr("width", HATCH)
    .attr("height", HATCH)
    .attr("patternTransform", "rotate(45)")
    .append("line")
    .attr("y2", HATCH);
  const plot = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  // Over the regions and under everything else: the strips the cut cannot reach.
  const reach = plot.append("g").attr("class", "reach").attr("aria-hidden", "true");
  const axes = svg.append("g").attr("class", "axes");
  const xAxis = axes.append("g").attr("class", "axis x-axis");
  const yAxis = axes.append("g").attr("class", "axis y-axis");
  const xLabel = axes.append<SVGTextElement>("text").attr("class", "axis-label x-label");
  const yLabel = axes.append<SVGTextElement>("text").attr("class", "axis-label y-label");
  // Over the x axis, so that their background patches hide the guide lines beneath them.
  const values = axes.append("g").attr("class", "transition-values").attr("aria-hidden", "true");
  const frame = plot.append("path").attr("class", "frame");
  const labelLayer = plot.append("g").attr("class", "phase-labels").attr("aria-hidden", "true");
  const labelText = labelLayer
    .selectAll<SVGTextElement, Phase>("text")
    .data(PHASES)
    .join("text")
    .attr("class", "phase-label")
    .attr("data-phase", (phase) => phase)
    .text((phase) => PHASE_NAME[phase]);
  const boundaries = plot.append("g").attr("class", "boundaries");
  // Beside the top end of the s-l line while its slope is exaggerated.
  const exagNote = plot
    .append("text")
    .attr("class", "exaggerated-note")
    .attr("aria-hidden", "true")
    .attr("text-anchor", "end")
    .text("slope exaggerated");
  const triple = plot.append("circle").attr("class", "triple-point").attr("r", 4);
  // Guide lines run from the cut down to the bottom of the SVG, where the slice panel's go on.
  const guides = plot.append("g").attr("class", "guides");

  const cut = plot.append("g").attr("class", "cut");
  const cutLine = cut.append("line").attr("class", "cut-line");
  const cutHit = cut.append("line").attr("class", "cut-hit").attr("stroke-width", HIT_BAND);
  const handle = cut
    .append("g")
    .attr("class", "cut-handle")
    .attr("role", "slider")
    .attr("tabindex", 0)
    .attr("aria-orientation", "vertical");
  // A finger-sized invisible target around the visible knob.
  handle
    .append("circle")
    .attr("class", "cut-handle-target")
    .attr("r", HIT_BAND / 2);
  handle.append("circle").attr("class", "cut-handle-knob").attr("r", 11);
  const markers = plot.append("g").attr("class", "markers");

  let size: PlotSize = { width: 0, height: 0 };
  let traced: Traced[] = [];
  /** Each mode's label points, and what they were placed for, so a cut drag reuses them. */
  let labels: Record<Mode, PhaseLabel[]> = { isobar: [], isotherm: [] };
  let labelsFor: { state: Readonly<State> | null; size: PlotSize } = { state: null, size };
  /** The mode currently drawn; it lags `store.state.mode` while the swap animates. */
  let shown: Mode = store.state.mode;
  let swap: { timer: Timer; to: Mode } | null = null;
  /**
   * Each mode's stable-phase grid; the colors are applied on every paint, so a theme change keeps
   * them.
   */
  const rasters = new RasterCache();

  const trace = ({ model, window }: Readonly<State>) => {
    traced = PAIRS.flatMap(([i, j]) =>
      boundary(i, j, model, window).map((seg) => ({ pair: `${i}-${j}`, ...seg })),
    );
  };

  /** Whether the s-l slope is drawn exaggerated, which the note marks. */
  const exaggerating = ({ exaggerateSl, exaggeration }: Readonly<State>) =>
    exaggerateSl && exaggeration > 1;

  /** Paints the shown mode's regions, from `rasters` where it holds that mode's grid. */
  const paintRegions = () => {
    const { model, window } = store.state;
    const dpr = Math.min(MAX_DPR, globalThis.devicePixelRatio || 1);
    const cols = Math.max(1, Math.round(size.width * dpr));
    const rows = Math.max(1, Math.round(size.height * dpr));
    const el = canvas.node() as HTMLCanvasElement;
    el.width = cols;
    el.height = rows;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const phases = rasters.get(model, window, shown, cols, rows);
    const style = getComputedStyle(container);
    const alpha = Math.round(255 * Number(style.getPropertyValue("--region-opacity") || 0.3));
    // Each phase's RGBA bytes as one 32-bit word, in the platform's byte order.
    const palette = new Uint8ClampedArray(4 * PHASES.length);
    PHASES.forEach((phase, k) => {
      palette.set([...parseHex(style.getPropertyValue(PHASE_VAR[phase])), alpha], 4 * k);
    });
    const words = new Uint32Array(palette.buffer);
    const image = ctx.createImageData(cols, rows);
    const pixels = new Uint32Array(image.data.buffer);
    for (let k = 0; k < phases.length; k++) pixels[k] = words[phases[k] as number] as number;
    ctx.putImageData(image, 0, 0);
  };

  /**
   * Hatches the strips of the diagram above and below the cut's limits, where a cut would meet no
   * boundary: in constant T mode, the isotherms under the s-v line's foot and over the l-v line's
   * top end. The cut stops at their edges.
   */
  const drawReach = () => {
    const { window, limits } = store.state;
    const [lo, hi] = limits[shown];
    const [a, b] = cutBounds(shown, window);
    const strips: { side: string; y0: number; y1: number }[] = [];
    if (hi < b) strips.push({ side: "high", y0: 0, y1: cutY(shown, hi, window, size) });
    if (lo > a) strips.push({ side: "low", y0: cutY(shown, lo, window, size), y1: size.height });
    reach
      .selectAll<SVGRectElement, (typeof strips)[number]>("rect")
      .data(strips)
      .join("rect")
      .attr("class", "out-of-reach")
      .attr("data-side", (d) => d.side)
      .attr("fill", `url(#${hatchId})`)
      .attr("x", 0)
      .attr("width", size.width)
      .attr("y", (d) => d.y0)
      .attr("height", (d) => Math.max(0, d.y1 - d.y0));
  };

  /** Draws the boundaries and the triple point through the map from (T, p) to plot pixels. */
  const drawCurves = (m: Affine) => {
    const path = line<Point>(
      (q) => toScreen(m, q.T, q.p)[0],
      (q) => toScreen(m, q.T, q.p)[1],
    );
    boundaries
      .selectAll<SVGPathElement, Traced>("path")
      .data(traced)
      .join("path")
      .attr("class", (d) => `boundary ${d.stable ? "stable" : "metastable"}`)
      .attr("data-pair", (d) => d.pair)
      .attr("d", (d) => path(d.points));
    const tp = triplePoint(store.state.params);
    const [x, y] = toScreen(m, tp.T, tp.p);
    triple.attr("cx", x).attr("cy", y);
  };

  /** The "slope exaggerated" note beside the drawn s-l line's far end, clear of the phase names. */
  const drawNote = () => {
    const spot = exaggerating(store.state) ? noteSpot() : null;
    if (!spot) {
      exagNote.attr("visibility", "hidden");
      return;
    }
    exagNote
      .attr("visibility", null)
      .attr("text-anchor", spot.anchor)
      .attr("x", spot.x)
      .attr("y", spot.y);
  };

  /** Where the note goes for the shown mode, or null without a stable s-l line. */
  const noteSpot = () => {
    const m = projection(shown, store.state.window, size);
    const sl = traced
      .filter((d) => d.pair === "s-l" && d.stable)
      .flatMap((d) => d.points)
      .sort((a, b) => a.p - b.p)
      .map((q) => toScreen(m, q.T, q.p));
    if (sl.length === 0) return null;
    const node = exagNote.node() as SVGTextElement;
    // Before layout the text has no length yet, so it is estimated.
    const width = node.getComputedTextLength() || 7 * (node.textContent ?? "").length;
    const names = labelText
      .nodes()
      .filter((el) => el.getAttribute("visibility") !== "hidden")
      .map((el): Box => {
        const n = el.getBBox();
        return [n.x, n.y, n.x + n.width, n.y + n.height];
      });
    return placeNote(sl, shown, size, width, names);
  };

  /**
   * Places each phase's name for both modes. It depends on the substance, the
   * window and the plot size only, so it is redone when one of them changes, not on a cut drag.
   */
  const placeLabels = () => {
    const state = store.state;
    const prev = labelsFor.state;
    if (
      prev &&
      prev.model === state.model &&
      prev.window === state.window &&
      labelsFor.size === size
    ) {
      return;
    }
    const widths = new Map<Phase, number>();
    labelText.each(function (phase) {
      // Before layout (or without fonts) the text has no length yet, so it is estimated.
      const measured = this.getComputedTextLength();
      widths.set(phase, measured > 0 ? measured : 8 * PHASE_NAME[phase].length);
    });
    const half = (phase: Phase) => 0.5 * (widths.get(phase) as number);
    labels = {
      isobar: phaseLabels(state.model, state.window, "isobar", size, half),
      isotherm: phaseLabels(state.model, state.window, "isotherm", size, half),
    };
    labelsFor = { state, size };
  };

  /**
   * Draws the phase names t of the way from their points in `from` to their points in `to`, so
   * that during the swap each one moves on a straight line between the two, as the bitmap does.
   * A phase labeled in one mode only keeps that mode's point.
   */
  const drawLabels = (from: Mode, to: Mode, t: number) => {
    const { window } = store.state;
    const p0 = projection(from, window, size);
    const p1 = projection(to, window, size);
    const at = (mode: Mode, phase: Phase) => labels[mode].find((l) => l.phase === phase);
    labelText.each(function (phase) {
      const a = at(from, phase) ?? at(to, phase);
      const b = at(to, phase) ?? a;
      const text = select(this);
      if (!a || !b) {
        text.attr("visibility", "hidden");
        return;
      }
      const [x0, y0] = toScreen(p0, a.T, a.p);
      const [x1, y1] = toScreen(p1, b.T, b.p);
      text
        .attr("visibility", null)
        .attr("x", x0 + t * (x1 - x0))
        .attr("y", y0 + t * (y1 - y0));
    });
  };

  const drawAxes = () => {
    const { window, pressureUnit: unit } = store.state;
    const { x: across, y: up } = AXES[shown];
    const x = axisSpec(across, window, unit, [0, size.width], Math.floor(size.width / 80));
    const y = axisSpec(up, window, unit, [size.height, 0], Math.floor(size.height / 50));
    for (const g of [xAxis, values]) {
      g.attr("transform", `translate(${MARGIN.left},${MARGIN.top + size.height})`);
    }
    // Tick marks only: the slice panel's top axis right under this one carries the numbers, so
    // the row under the diagram is left to the bold transition values. No outer ticks on either
    // axis: an end of the window gets a tick only where it is a major one.
    xAxis.call(
      axisBottom(x.scale)
        .tickValues(x.ticks)
        .tickFormat(() => "")
        .tickSizeOuter(0),
    );
    yAxis
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`)
      .call(axisLeft(y.scale).tickValues(y.ticks).tickFormat(y.format).tickSizeOuter(0));
    xLabel
      .attr("x", MARGIN.left + size.width / 2)
      .attr("y", MARGIN.top + size.height + MARGIN.bottom - 6);
    setAxisLabel(xLabel.node() as SVGTextElement, AXIS_LABELS[across](unit));
    setAxisLabel(yLabel.node() as SVGTextElement, AXIS_LABELS[up](unit));
    placeYLabel(yLabel.node()!, yAxis.node()!, size.height, MARGIN);
  };

  const drawCut = () => {
    const { window, cuts, pressureUnit } = store.state;
    const value = cuts[shown];
    const y = cutY(shown, value, window, size);
    for (const l of [cutLine, cutHit]) {
      l.attr("x1", 0).attr("x2", size.width).attr("y1", y).attr("y2", y);
    }
    // The values are in the shown unit, as the slider's are.
    const isobar = shown === "isobar";
    const shownValue = (v: number) => (isobar ? toUnit(v, pressureUnit) : v);
    const [lo, hi] = store.state.limits[shown];
    handle
      .attr("transform", `translate(${size.width},${y})`)
      .attr("aria-label", `${CUT_LABEL[shown]} (${isobar ? pressureUnit : "K"})`)
      .attr("aria-valuemin", shownValue(lo))
      .attr("aria-valuemax", shownValue(hi))
      .attr("aria-valuenow", shownValue(value))
      .attr(
        "aria-valuetext",
        isobar ? formatPressure(value, pressureUnit) : formatTemperature(value),
      );
    drawGuides();
  };

  /** A marker where the cut meets each boundary, and a guide line from it down to the slice. */
  const drawGuides = () => {
    const state = store.state;
    const { model, window, cuts } = state;
    // The store's crossings are the current mode's, which is the shown one outside a swap.
    const found =
      shown === state.mode ? state.crossings : crossings(cutFor(shown, cuts), model, window);
    const m = projection(shown, window, size);
    const xy = (c: Crossing) => toScreen(m, c.T, c.p);
    const kind = (c: Crossing) => (c.stable ? "stable" : "metastable");
    guides
      .selectAll<SVGLineElement, Crossing>("line")
      .data(found)
      .join("line")
      .attr("class", (c) => `guide ${kind(c)}`)
      .attr("x1", (c) => xy(c)[0])
      .attr("x2", (c) => xy(c)[0])
      .attr("y1", (c) => xy(c)[1])
      .attr("y2", size.height + MARGIN.bottom);
    markers
      .selectAll<SVGCircleElement, Crossing>("circle")
      .data(found)
      .join("circle")
      .attr("class", (c) => `crossing-marker ${kind(c)}`)
      .attr("data-pair", (c) => c.phases.join("-"))
      .attr("r", 3.5)
      .attr("cx", (c) => xy(c)[0])
      .attr("cy", (c) => xy(c)[1]);
    drawValues(found, (c) => xy(c)[0]);
  };

  /**
   * The stable transition values in bold under the x axis, centered on their guide lines, with a
   * tick mark at the true x. The axis has no tick labels of its own. Values that
   * would overlap are pushed apart. Crossings that coincide, as at the triple point, get one
   * value.
   */
  const drawValues = (found: readonly Crossing[], xOf: (c: Crossing) => number) => {
    const { pressureUnit } = store.state;
    const items: TransitionValue[] = [];
    for (const c of found) {
      if (!c.stable) continue;
      const x = xOf(c);
      const text = shown === "isobar" ? formatTemperature(c.T) : formatPressure(c.p, pressureUnit);
      if (!items.some((v) => v.text === text && Math.abs(v.x - x) < 1)) items.push({ x, text });
    }
    values
      .selectAll<SVGLineElement, TransitionValue>("line")
      .data(items)
      .join("line")
      .attr("class", "transition-tick")
      .attr("x1", (v) => v.x)
      .attr("x2", (v) => v.x)
      .attr("y2", 6);
    // Each value sits on a patch of the background, which hides the guide line beneath it.
    const groups = values
      .selectAll<SVGGElement, TransitionValue>("g.transition-value")
      .data(items)
      .join((enter) => {
        const g = enter.append("g").attr("class", "transition-value");
        g.append("rect");
        g.append("text").attr("y", 9).attr("dy", "0.71em");
        return g;
      });
    const texts = groups.select<SVGTextElement>("text").text((v) => v.text);
    const widths = texts.nodes().map((el) => el.getComputedTextLength());
    const placed = spreadApart(
      items.map((v) => v.x),
      widths,
      VALUE_GAP,
      [-MARGIN.left, size.width + MARGIN.right],
    );
    groups.attr("transform", (_, k) => `translate(${placed[k] as number},0)`);
    groups
      .select("rect")
      .attr("x", (_, k) => -0.5 * (widths[k] as number) - 2)
      .attr("width", (_, k) => (widths[k] as number) + 4)
      .attr("y", 7)
      .attr("height", 14);
  };

  const drawAll = () => {
    fitSvg(svg.node() as SVGSVGElement, size, MARGIN);
    canvas
      .style("left", `${MARGIN.left}px`)
      .style("top", `${MARGIN.top}px`)
      .style("width", `${size.width}px`)
      .style("height", `${size.height}px`)
      .style("transform", null);
    frame.attr("d", frameTopRight(size));
    paintRegions();
    drawReach();
    drawCurves(projection(shown, store.state.window, size));
    placeLabels();
    drawLabels(shown, shown, 0);
    drawNote();
    drawAxes();
    drawCut();
  };

  /** Stops a running swap at its final mode, without drawing it; true if one was running. */
  const stopSwap = () => {
    if (!swap) return false;
    swap.timer.stop();
    shown = swap.to;
    swap = null;
    root.classed("swapping", false);
    return true;
  };

  /** Ends a running swap at its final frame. */
  const finishSwap = () => {
    if (stopSwap()) drawAll();
  };

  /**
   * Swaps the axes: every point moves on a straight line from its (T, p) position to its (p, T)
   * position. The axes and the cut fade out meanwhile, since they change
   * meaning. Skipped when the system asks for reduced motion.
   */
  const startSwap = (to: Mode) => {
    finishSwap();
    if (to === shown) return;
    // Before the first layout there is nothing to animate (and the maps would be singular).
    if (prefersReducedMotion() || size.width === 0) {
      shown = to;
      drawAll();
      return;
    }
    const from = shown;
    const { window } = store.state;
    const p0 = projection(from, window, size);
    const p1 = projection(to, window, size);
    const el = canvas.node() as HTMLCanvasElement;
    root.classed("swapping", true);
    swap = {
      to,
      timer: timer((elapsed) => {
        const t = easeCubicInOut(Math.min(1, elapsed / SWAP_MS));
        el.style.transform = `matrix(${blendMatrix(from, to, t, window, size).join(",")})`;
        drawCurves(lerpAffine(p0, p1, t));
        drawLabels(from, to, t);
        if (elapsed >= SWAP_MS) finishSwap();
      }),
    };
  };

  const { endDrag } = attachCutDrag(
    svg.node() as SVGSVGElement,
    [cutHit.node() as SVGLineElement, handle.node() as SVGGElement],
    handle.node() as SVGGElement,
    store,
    { mode: () => shown, size: () => size, swapping: () => swap !== null },
  );

  store.subscribe((state, prev) => {
    if (state.mode !== prev.mode) endDrag();
    if (state.model !== prev.model || state.window !== prev.window) {
      // A running swap stops without a frame of its own: one redraw shows the new state.
      trace(state);
      stopSwap();
      shown = state.mode;
      drawAll();
    } else if (state.mode !== prev.mode) {
      startSwap(state.mode);
    } else if (state.cuts !== prev.cuts && !swap) {
      drawCut();
    } else if (state.pressureUnit !== prev.pressureUnit && !swap) {
      // Only the labels change: no point of the diagram moves.
      drawAxes();
      drawCut();
    }
  });

  attachPanel(container, store, (next) => {
    stopSwap();
    size = next;
    drawAll();
  });

  // The region colors come from CSS, so a theme change repaints the bitmap.
  onThemeChange(() => {
    if (size.width > 0) paintRegions();
  });

  // The names, the bold values and both panels' y-axis labels are placed from measured text, so
  // once Lato has loaded (it swaps in for a fallback font) they are measured and placed again.
  void document.fonts?.ready.then(() => {
    if (size.width === 0) return;
    labelsFor = { state: null, size };
    // A running swap redraws everything when it ends.
    if (!swap) drawAll();
  });

  trace(store.state);
}

function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `#rrggbb` to [r, g, b] in 0–255. */
function parseHex(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`pTerrain: expected a #rrggbb color, got "${hex}"`);
  return [parseInt(m[1] as string, 16), parseInt(m[2] as string, 16), parseInt(m[3] as string, 16)];
}
