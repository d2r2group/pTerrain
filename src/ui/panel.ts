// What the phase diagram and the slice panel share: the metastable toggle's class, the plot size
// that follows the container, the SVG sized to the plot area and its margins, and the y-axis label
// beside the tick labels.

import { plotHeight, plotWidth, type PlotSize } from "./geometry";
import type { Store } from "./state";

/**
 * Keeps `container` in sync with the metastable toggle and its plot size with its width. The
 * toggle only sets a class that hides elements, so nothing is recomputed.
 * `onResize` gets the new plot size whenever it changes, the first layout included.
 */
export function attachPanel(
  container: HTMLElement,
  store: Store,
  onResize: (size: PlotSize) => void,
): void {
  const showMetastable = () =>
    container.classList.toggle("hide-metastable", !store.state.showMetastable);
  showMetastable();
  store.subscribe(showMetastable);

  let size: PlotSize = { width: 0, height: 0 };
  new ResizeObserver(([entry]) => {
    if (!entry) return;
    const width = plotWidth(entry.contentRect.width);
    const height = plotHeight(width);
    if (width === size.width && height === size.height) return;
    size = { width, height };
    onResize(size);
  }).observe(container);
}

/** Sizes `svg` to a plot area of `size` inside `margin`. */
export function fitSvg(
  svg: SVGSVGElement,
  size: PlotSize,
  margin: { top: number; right: number; bottom: number; left: number },
): void {
  svg.setAttribute("width", String(size.width + margin.left + margin.right));
  svg.setAttribute("height", String(size.height + margin.top + margin.bottom));
}

/** The space between the y-axis label and the widest tick label, in CSS px. */
const Y_LABEL_GAP = 4;

/** Each panel's y-axis label, with its axis and where to center it, as last placed. */
const yLabels = new Map<
  SVGTextElement,
  { yAxis: SVGGElement; height: number; margin: { top: number; left: number } }
>();

/**
 * Puts the rotated y-axis `label` halfway down a plot area `height` px tall, and every panel's
 * label on one vertical line, Y_LABEL_GAP px left of the widest tick label of any of their axes.
 * Each panel calls it after redrawing `yAxis`, so the line follows both panels' ticks. d3 ends
 * each tick label 9 px left of the axis: a 6 px tick and 3 px of padding. With the widest labels
 * the axis labels reach past the SVG's left edge, into the page's padding.
 */
export function placeYLabel(
  label: SVGTextElement,
  yAxis: SVGGElement,
  height: number,
  margin: { top: number; left: number },
): void {
  yLabels.set(label, { yAxis, height, margin });
  const entries = [...yLabels];
  const widest = Math.max(
    0,
    ...entries.flatMap(([, { yAxis }]) =>
      [...yAxis.querySelectorAll<SVGTextElement>(".tick text")].map((t) => t.getBBox().width),
    ),
  );
  // Before the rotation, a label's bottom edge is the side that faces the tick labels.
  const reach = Math.max(
    ...entries.map(([el]) => {
      const { y, height: h } = el.getBBox();
      return y + h;
    }),
  );
  for (const [el, { height, margin }] of entries) {
    const x = margin.left - 9 - widest - Y_LABEL_GAP - reach;
    el.setAttribute("transform", `translate(${x},${margin.top + height / 2}) rotate(-90)`);
  }
}
