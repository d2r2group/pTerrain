// What the phase diagram and the slice panel share: the metastable toggle's class, the plot size
// that follows the container, and the SVG sized to the plot area and its margins.

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
