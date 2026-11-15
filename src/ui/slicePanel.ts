// The linked slice panel under the diagram: g(T) along the isobar or
// g(p) along the isotherm, on the diagram's x scale, with the lower envelope solid, the rest
// dashed, the panel shaded under the envelope in the stable phase's color, a band of the stable
// phases along its bottom edge with their letters over it, and a marker and a dotted guide line
// at each crossing. g is drawn as g − g_tp, where g_tp is the value all three share at the triple
// point, so each slope is −s or v and the curves fall with T and rise with p, as in a textbook.
// The g axis follows the cut, at the fitted height or one typed in the window fields.

import {
  area,
  axisLeft,
  axisTop,
  easeCubicOut,
  line,
  scaleLinear,
  scaleLog,
  select,
  timer,
  type Timer,
} from "d3";
import { alongRange, type Crossing, type Cut } from "../physics/crossings";
import { gibbs, type Params } from "../physics/gibbs";
import { alongCut, gAnchor, sliceSegments, type SliceSegment } from "../physics/slice";
import { placeBandLabels, type BandLabel, type BandLabelRun } from "./bandLabels";
import { AXIS_LABELS, setAxisLabel } from "./labels";
import { fixedOffset, frameBottomRight, SLICE_MARGIN, type PlotSize } from "./geometry";
import type { PlotHandle } from "./phaseDiagram";
import { attachPanel, fitSvg, placeYLabel } from "./panel";
import { cutOf, type State, type Store } from "./state";
import { axisSpec, formatPressure, formatTemperature } from "./units";

const MARGIN = SLICE_MARGIN;
/** Height of the band of stable phases along the panel's bottom edge, px. */
const BAND_PX = 4;
/** The band letters' baseline above the band, px, and their width per character before layout. */
const LABEL_LIFT = 3;
const LABEL_PX_PER_CHAR = 7;
/** A jump of the g axis center larger than this, px, glides instead. */
const GLIDE_PX = 4;
/** Length of that glide, ms. */
const GLIDE_MS = 200;

/** What the curves, guides and markers are drawn from, apart from the g axis. */
interface SliceData {
  cut: Cut;
  params: Params;
  found: readonly Crossing[];
  segments: SliceSegment[];
}

/** Slice panels built so far, which number their ids. */
let panelCount = 0;

/**
 * Builds the slice panel inside `container`, keeps it in sync with `store`, and returns its handle
 * (as the diagram's: a draw at a plot size, for the figure export).
 */
export function createSlicePanel(container: HTMLElement, store: Store): PlotHandle {
  const root = select(container).classed("slice-panel", true);
  const svg = root.append("svg").attr("role", "img");
  // Numbered, not random, so that a figure export's SVG text is the same on every device.
  const clipId = `slice-clip-${++panelCount}`;
  const clipRect = svg.append("defs").append("clipPath").attr("id", clipId).append("rect");
  const plot = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  const frame = plot.append("path").attr("class", "frame");
  const shading = plot.append("g").attr("class", "shading").attr("clip-path", `url(#${clipId})`);
  // Along the bottom edge, the stable phase's color over its range, also where its curve is off
  // the panel.
  const band = plot.append("g").attr("class", "stable-band");
  const curves = plot.append("g").attr("class", "curves").attr("clip-path", `url(#${clipId})`);
  const guides = plot.append("g").attr("class", "guides");
  // Each stable phase's letter over its run of the band; the readout already names the phases.
  const bandLabels = plot.append("g").attr("class", "band-labels").attr("aria-hidden", "true");
  const markers = plot.append("g").attr("class", "markers");
  const axes = svg.append("g").attr("class", "axes");
  // The x axis is on top, under the diagram's own x-axis label, which names it too.
  const xAxis = axes.append("g").attr("class", "axis x-axis");
  const yAxis = axes.append("g").attr("class", "axis y-axis");
  const yLabel = axes.append<SVGTextElement>("text").attr("class", "axis-label y-label");
  setAxisLabel(yLabel.node() as SVGTextElement, AXIS_LABELS.G());

  /** The plot size the container last gave, and the one the panel last drew at. */
  let observed: PlotSize = { width: 0, height: 0 };
  let size: PlotSize = observed;
  /** The state last drawn: the store's, or an export's. */
  let drawn: Readonly<State> = store.state;
  /** Whether the last draw was a figure export's, which fixes the axes' offset. */
  let exporting = false;
  /** Half the g axis's height, kJ/mol: the typed g range's, or the fitted one's (`gHalfSpan`). */
  const halfOf = ({ gRange, gFit }: Readonly<State>) => (gRange ?? gFit) / 2;
  let half = halfOf(drawn);
  let data: SliceData | null = null;
  /** The g axis center as drawn, kJ/mol; it lags the cut's `gCenter` while a glide runs. */
  let shown = 0;
  /** What that center is taken from on the current cut (`gAnchor`). */
  let anchor = "";
  let glide: { timer: Timer; from: number; to: number } | null = null;

  // In kPa for the curves; the axis is drawn in the shown unit at the same positions.
  const xScale = () => {
    const cut = cutOf(drawn);
    const [lo, hi] = alongRange(cut, drawn.window);
    return (cut.kind === "isobar" ? scaleLinear() : scaleLog())
      .domain([lo, hi])
      .range([0, size.width]);
  };

  /** Draws the slice with the g axis centered on `center`, kJ/mol. */
  const render = (center: number) => {
    if (!data) return;
    const { cut, params, found, segments } = data;
    const x = xScale();
    const y = scaleLinear()
      .domain([center - half, center + half])
      .range([size.height, 0]);
    // No outer ticks, as on the diagram: an end of an axis gets a tick only where it is a major one.
    yAxis.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`).call(
      fixedOffset(axisLeft(y), exporting)
        .ticks(Math.max(2, Math.floor(size.height / 50)))
        .tickSizeOuter(0),
    );
    placeYLabel(yLabel.node()!, yAxis.node()!, size.height, MARGIN);
    const path = line<[number, number]>(
      ([u]) => x(u),
      ([, G]) => y(G),
    );
    // Under the envelope, down to the bottom edge, in the stable phase's color.
    const fill = area<[number, number]>(
      ([u]) => x(u),
      size.height,
      ([, G]) => y(G),
    );
    shading
      .selectAll<SVGPathElement, SliceSegment>("path")
      .data(segments.filter((s) => s.stable))
      .join("path")
      .attr("class", "shade")
      .attr("data-phase", (d) => d.phase)
      .attr("d", (d) => fill(d.points));
    band
      .selectAll<SVGRectElement, SliceSegment>("rect")
      .data(segments.filter((s) => s.stable))
      .join("rect")
      .attr("data-phase", (d) => d.phase)
      .attr("x", (d) => x(d.points[0]![0]))
      .attr("width", (d) => x(d.points.at(-1)![0]) - x(d.points[0]![0]))
      .attr("y", size.height - BAND_PX)
      .attr("height", BAND_PX);
    curves
      .selectAll<SVGPathElement, SliceSegment>("path")
      .data(segments)
      .join("path")
      .attr("class", (d) => `curve ${d.stable ? "stable" : "metastable"}`)
      .attr("data-phase", (d) => d.phase)
      .attr("d", (d) => path(d.points));

    drawBandLabels(
      segments
        .filter((s) => s.stable)
        .map((s) => ({
          name: s.phase,
          phase: s.phase,
          x0: x(s.points[0]![0]),
          x1: x(s.points.at(-1)![0]),
        })),
    );

    const px = (c: Crossing) => x(alongCut(cut, c));
    const py = (c: Crossing) => y(gibbs(c.phases[0], c.T, c.p, params));
    // A metastable crossing of a cut in one phase only can lie off the panel (see gHalfSpan): its
    // guide then stops at the panel's edge, and its marker is hidden rather than drawn outside.
    const onPanel = (c: Crossing) => py(c) >= 0 && py(c) <= size.height;
    const guideEnd = (c: Crossing) => Math.max(0, Math.min(size.height, py(c)));
    // From the top of the panel, which meets the guide coming down from the diagram above.
    guides
      .selectAll<SVGLineElement, Crossing>("line")
      .data(found)
      .join("line")
      .attr("class", (c) => `guide ${c.stable ? "stable" : "metastable"}`)
      .attr("x1", px)
      .attr("x2", px)
      .attr("y1", -MARGIN.top)
      .attr("y2", guideEnd);
    markers
      .selectAll<SVGCircleElement, Crossing>("circle")
      .data(found)
      .join("circle")
      .attr("class", (c) => `crossing-marker ${c.stable ? "stable" : "metastable"}`)
      .attr("data-pair", (c) => c.phases.join("-"))
      .attr("r", 3.5)
      .attr("cx", px)
      .attr("cy", py)
      .attr("visibility", (c) => (onPanel(c) ? null : "hidden"));

    svg.attr(
      "aria-label",
      cut.kind === "isobar"
        ? `g(T) along the isobar at ${formatPressure(cut.p, drawn.pressureUnit)}`
        : `g(p) along the isotherm at ${formatTemperature(cut.T)}`,
    );
  };

  /** The runs' letters, measured in place with a probe and placed by `placeBandLabels`. */
  const drawBandLabels = (runs: readonly Omit<BandLabelRun, "width">[]) => {
    const probe = bandLabels.append("text").attr("class", "band-label");
    const node = probe.node() as SVGTextElement;
    const measured = runs.map((r) => {
      node.textContent = r.name;
      return { ...r, width: node.getComputedTextLength() || LABEL_PX_PER_CHAR * r.name.length };
    });
    probe.remove();
    bandLabels
      .selectAll<SVGTextElement, BandLabel>("text")
      .data(placeBandLabels(measured, size.width))
      .join("text")
      .attr("class", "band-label")
      .attr("data-phase", (d) => d.phase)
      .attr("x", (d) => d.x)
      .attr("y", size.height - BAND_PX - LABEL_LIFT)
      .text((d) => d.name);
  };

  const stopGlide = () => {
    glide?.timer.stop();
    glide = null;
  };

  /** Eases the drawn center from where it is to `to`, kJ/mol, over GLIDE_MS. */
  const startGlide = (to: number) => {
    stopGlide();
    const run = {
      from: shown,
      to,
      timer: timer((elapsed) => {
        const t = easeCubicOut(Math.min(1, elapsed / GLIDE_MS));
        shown = run.from + t * (run.to - run.from);
        render(shown);
        if (elapsed >= GLIDE_MS) stopGlide();
      }),
    };
    glide = run;
  };

  /**
   * Redraws the slice for the current cut. The g axis follows the cut, centered on its `gCenter`.
   * That center moves continuously while it is taken from the same crossing, however fast the cut
   * moves, and the axis then follows at once. It jumps where it changes crossing, as where the
   * highest stable crossing leaves the window: with `smooth` (a moved cut), such a jump of more
   * than GLIDE_PX eases over GLIDE_MS instead, and a glide under way follows the center as it
   * moves on. Without `smooth` (a new model, window, mode, unit or size), or when the system asks
   * for reduced motion, the axis jumps.
   */
  const drawSlice = (smooth = false) => {
    // The model, which has an exaggerated s-l slope while that view is on.
    const { model: params, window, crossings: found } = drawn;
    const cut = cutOf(drawn);
    // Metastable runs first, so the envelope is drawn on top of them.
    const segments = sliceSegments(cut, params, window, { found }).sort(
      (s, t) => Number(s.stable) - Number(t.stable),
    );
    const first = data === null;
    data = { cut, params, found, segments };
    const { g: target, by } = gAnchor(cut, params, window, found);
    const switched = by !== anchor;
    anchor = by;
    const px = (dg: number) => (Math.abs(dg) * size.height) / (2 * half);
    if (!smooth || first || prefersReducedMotion()) {
      stopGlide();
      shown = target;
    } else if (switched && px(target - shown) > GLIDE_PX) {
      startGlide(target);
    } else if (glide) {
      glide.to = target;
    } else {
      shown = target;
    }
    render(shown);
  };

  const drawAll = () => {
    fitSvg(svg.node() as SVGSVGElement, size, MARGIN);
    clipRect.attr("width", size.width).attr("height", size.height);
    frame.attr("d", frameBottomRight(size));
    const { mode, window, pressureUnit } = drawn;
    const x = axisSpec(
      mode === "isobar" ? "T" : "p",
      window,
      pressureUnit,
      [0, size.width],
      Math.floor(size.width / 80),
    );
    xAxis
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`)
      .call(
        fixedOffset(axisTop(x.scale), exporting)
          .tickValues(x.ticks)
          .tickFormat(x.format)
          .tickSizeOuter(0),
      );
    drawSlice();
  };

  store.subscribe((state, prev) => {
    drawn = state;
    if (
      state.model !== prev.model ||
      state.window !== prev.window ||
      state.gRange !== prev.gRange
    ) {
      half = halfOf(state);
      drawAll();
    } else if (state.mode !== prev.mode || state.pressureUnit !== prev.pressureUnit) {
      drawAll();
    } else if (state.cuts !== prev.cuts) {
      drawSlice(true);
    }
  });

  attachPanel(container, store, (next) => {
    observed = size = next;
    exporting = false;
    drawAll();
  });

  return {
    svg: svg.node() as SVGSVGElement,
    draw(state, at) {
      exporting = at !== undefined;
      size = at ?? observed;
      drawn = state;
      half = halfOf(state);
      drawAll();
    },
  };
}

function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}
