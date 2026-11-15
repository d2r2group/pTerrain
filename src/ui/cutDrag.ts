// Moving the diagram's cut line: dragging it by its band or its handle,
// and stepping it from the keyboard while the handle has focus.

import { tickStep } from "d3";
import type { Params, PlotWindow } from "../physics/gibbs";
import { cutValueAt, cutY, MARGIN, type PlotSize } from "./geometry";
import { cutBounds, fromCutAxis, toCutAxis, type Mode, type Store } from "./state";

/** How near the triple point's value, in CSS px on screen, a dragged cut is pulled onto it. */
export const CUT_MAGNET_PX = 2;

/**
 * The cut `value` of a drag, pulled onto the triple point's value (p_tp for an isobar, T_tp for an
 * isotherm) when its line lies within `radius` px of it on screen, measured through `cutY` so that
 * it holds on the log p axis. Otherwise `value` unchanged.
 */
export function snapCut(
  mode: Mode,
  value: number,
  params: Params,
  window: PlotWindow,
  size: PlotSize,
  radius: number = CUT_MAGNET_PX,
): number {
  const target = mode === "isobar" ? params.pt : params.Tt;
  const dy = cutY(mode, value, window, size) - cutY(mode, target, window, size);
  return Math.abs(dy) <= radius ? target : value;
}

/** What the diagram currently draws, which lags the store's mode while the swap animates. */
export interface CutView {
  mode(): Mode;
  size(): PlotSize;
  swapping(): boolean;
}

/**
 * The cut after pressing `key` on the handle, or null for a key that does not move it: arrows
 * step the cut, Page Up/Down take ten steps, Home/End go to the cut's `limits`. The steps are
 * even on the axis, so in log p for an isobar, and a hundredth of the window.
 */
export function cutAfterKey(
  key: string,
  mode: Mode,
  value: number,
  window: PlotWindow,
  limits: readonly [number, number],
): number | null {
  const [lo, hi] = limits;
  const [a, b] = cutBounds(mode, window);
  const step = tickStep(toCutAxis(mode, a), toCutAxis(mode, b), 100);
  const u = toCutAxis(mode, value);
  const by = (n: number) => fromCutAxis(mode, u + n * step);
  const next: Record<string, number> = {
    ArrowUp: by(1),
    ArrowRight: by(1),
    ArrowDown: by(-1),
    ArrowLeft: by(-1),
    PageUp: by(10),
    PageDown: by(-10),
    Home: lo,
    End: hi,
  };
  return Object.hasOwn(next, key) ? (next[key] as number) : null;
}

/**
 * Lets the cut be dragged by `targets` inside `svg` and stepped from the keyboard on `handle`.
 * Pointer capture keeps the drag going when the finger leaves the band, and the grab offset keeps
 * the line from jumping to the pointer when it is grabbed off-center. Neither starts during a
 * swap. A drag is pulled onto the triple point's value by `snapCut`; the keys step exactly.
 * `svg` has the class `cut-dragging` during a drag. `endDrag` ends a drag in progress and
 * releases its pointer: on a mode change.
 */
export function attachCutDrag(
  svg: SVGSVGElement,
  targets: readonly SVGElement[],
  handle: SVGGElement,
  store: Store,
  view: CutView,
): { endDrag(): void } {
  const plotY = (event: PointerEvent) =>
    event.clientY - svg.getBoundingClientRect().top - MARGIN.top;
  let drag: { pointerId: number; offset: number } | null = null;
  const onDown = (event: PointerEvent) => {
    if (view.swapping() || drag) return;
    const { window, cuts } = store.state;
    const mode = view.mode();
    drag = {
      pointerId: event.pointerId,
      offset: cutY(mode, cuts[mode], window, view.size()) - plotY(event),
    };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("cut-dragging");
    event.preventDefault();
    handle.focus({ preventScroll: true });
  };
  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== drag?.pointerId) return;
    const y = plotY(event) + drag.offset;
    const { model, window } = store.state;
    const mode = view.mode();
    const size = view.size();
    store.setCut(snapCut(mode, cutValueAt(mode, y, window, size), model, window, size));
  };
  const onUp = (event: PointerEvent) => {
    if (event.pointerId !== drag?.pointerId) return;
    drag = null;
    svg.classList.remove("cut-dragging");
  };
  for (const target of targets) target.addEventListener("pointerdown", onDown);
  svg.addEventListener("pointermove", onMove);
  svg.addEventListener("pointerup", onUp);
  svg.addEventListener("pointercancel", onUp);
  svg.addEventListener("lostpointercapture", onUp);

  handle.addEventListener("keydown", (event) => {
    if (view.swapping()) return;
    const { window, cuts, limits } = store.state;
    const mode = view.mode();
    const next = cutAfterKey(event.key, mode, cuts[mode], window, limits[mode]);
    if (next === null) return;
    event.preventDefault();
    store.setCut(next);
  });

  return {
    endDrag() {
      if (!drag) return;
      const { pointerId } = drag;
      drag = null;
      svg.classList.remove("cut-dragging");
      if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId);
    },
  };
}
