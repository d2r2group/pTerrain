// The linked slice panel under the diagram: G(T) along the isobar or
// G(p) along the isotherm, on the diagram's x scale, with the lower envelope solid, the rest
// dashed, the panel shaded under the envelope in the stable phase's colour, and a marker and a
// dotted guide line at each crossing. G is drawn relative to the mean of the three, so that the
// small gap between s and l is not lost under the vapour's span and no phase is a flat line.

import { area, axisLeft, axisTop, line, scaleLinear, scaleLog, select } from "d3";
import { alongRange, type Crossing } from "../physics/crossings";
import {
  alongCut,
  gDomain,
  gHalfSpan,
  relativeG,
  sliceSegments,
  type SliceSegment,
} from "../physics/slice";
import { AXIS_LABELS, setAxisLabel } from "./labels";
import { frameBottomRight, SLICE_MARGIN, type PlotSize } from "./geometry";
import { attachPanel, fitSvg, placeYLabel } from "./panel";
import { cutOf, type Store } from "./state";
import { axisSpec, formatPressure, formatTemperature } from "./units";

const MARGIN = SLICE_MARGIN;

/** Builds the slice panel inside `container` and keeps it in sync with `store`. */
export function createSlicePanel(container: HTMLElement, store: Store): void {
  const root = select(container).classed("slice-panel", true);
  const svg = root.append("svg").attr("role", "img");
  const clipId = `slice-clip-${Math.random().toString(36).slice(2)}`;
  const clipRect = svg.append("defs").append("clipPath").attr("id", clipId).append("rect");
  const plot = svg.append("g").attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);
  const frame = plot.append("path").attr("class", "frame");
  const shading = plot.append("g").attr("class", "shading").attr("clip-path", `url(#${clipId})`);
  const curves = plot.append("g").attr("class", "curves").attr("clip-path", `url(#${clipId})`);
  const guides = plot.append("g").attr("class", "guides");
  const markers = plot.append("g").attr("class", "markers");
  const axes = svg.append("g").attr("class", "axes");
  // The x axis is on top, under the diagram's own x-axis label, which names it too.
  const xAxis = axes.append("g").attr("class", "axis x-axis");
  const yAxis = axes.append("g").attr("class", "axis y-axis");
  const yLabel = axes.append<SVGTextElement>("text").attr("class", "axis-label y-label");
  setAxisLabel(yLabel.node() as SVGTextElement, AXIS_LABELS.G());

  let size: PlotSize = { width: 0, height: 0 };
  let half = gHalfSpan(store.state.model, store.state.window);

  // In kPa for the curves; the axis is drawn in the shown unit at the same positions.
  const xScale = () => {
    const cut = cutOf(store.state);
    const [lo, hi] = alongRange(cut, store.state.window);
    return (cut.kind === "isobar" ? scaleLinear() : scaleLog())
      .domain([lo, hi])
      .range([0, size.width]);
  };

  // The G axis follows the cut, so it is redrawn with the curves.
  const drawSlice = () => {
    // The model, which has an exaggerated s-l slope while that view is on.
    const { model: params, window, crossings: found } = store.state;
    const cut = cutOf(store.state);
    const x = xScale();
    const y = scaleLinear()
      .domain(gDomain(cut, params, window, half, found))
      .range([size.height, 0]);
    // No outer ticks, as on the diagram: an end of an axis gets a tick only where it is a major one.
    yAxis.attr("transform", `translate(${MARGIN.left},${MARGIN.top})`).call(
      axisLeft(y)
        .ticks(Math.max(2, Math.floor(size.height / 50)))
        .tickSizeOuter(0),
    );
    placeYLabel(yLabel.node()!, yAxis.node()!, size.height, MARGIN);
    const path = line<[number, number]>(
      ([u]) => x(u),
      ([, G]) => y(G),
    );
    // Metastable runs first, so the envelope is drawn on top of them.
    const segments = sliceSegments(cut, params, window, { found }).sort(
      (s, t) => Number(s.stable) - Number(t.stable),
    );
    // Under the envelope, down to the bottom edge, in the stable phase's colour.
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
    curves
      .selectAll<SVGPathElement, SliceSegment>("path")
      .data(segments)
      .join("path")
      .attr("class", (d) => `curve ${d.stable ? "stable" : "metastable"}`)
      .attr("data-phase", (d) => d.phase)
      .attr("d", (d) => path(d.points));

    const px = (c: Crossing) => x(alongCut(cut, c));
    const py = (c: Crossing) => y(relativeG(c.phases[0], c.T, c.p, params));
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
        ? `g(T) along the isobar at ${formatPressure(cut.p, store.state.pressureUnit)}`
        : `g(p) along the isotherm at ${formatTemperature(cut.T)}`,
    );
  };

  const drawAll = () => {
    fitSvg(svg.node() as SVGSVGElement, size, MARGIN);
    clipRect.attr("width", size.width).attr("height", size.height);
    frame.attr("d", frameBottomRight(size));
    const { mode, window, pressureUnit } = store.state;
    const x = axisSpec(
      mode === "isobar" ? "T" : "p",
      window,
      pressureUnit,
      [0, size.width],
      Math.floor(size.width / 80),
    );
    xAxis
      .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`)
      .call(axisTop(x.scale).tickValues(x.ticks).tickFormat(x.format).tickSizeOuter(0));
    drawSlice();
  };

  store.subscribe((state, prev) => {
    if (state.model !== prev.model || state.window !== prev.window) {
      half = gHalfSpan(state.model, state.window);
      drawAll();
    } else if (state.mode !== prev.mode || state.pressureUnit !== prev.pressureUnit) {
      drawAll();
    } else if (state.cuts !== prev.cuts) {
      drawSlice();
    }
  });

  attachPanel(container, store, (next) => {
    size = next;
    drawAll();
  });
}
