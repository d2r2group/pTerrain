// The p–Terrain logo: one SVG of outlines in `currentColor`, so it follows the theme (style.css
// sets its "errain" in the d2r2 purple) and needs no web fonts. It replaces the text heading and
// keeps "pTerrain" as its name. It is also a button that snaps the cut to the triple point, as its
// tooltip says.

import logo from "../assets/logo.svg?raw";
import type { Store } from "./state";
import { formatPressure, formatTemperature } from "./units";

/**
 * The page heading: the logo, named "pTerrain" for screen readers, and a button that snaps the cut
 * to the triple point.
 */
export function createLogo(container: HTMLElement, store: Store): void {
  const heading = document.createElement("h1");
  heading.className = "logo";
  const button = document.createElement("button");
  button.type = "button";
  button.innerHTML = logo;
  const svg = button.querySelector("svg");
  if (!svg) throw new Error("pTerrain: the logo asset holds no <svg>");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "pTerrain");
  button.addEventListener("click", () => store.snapToTriplePoint());
  heading.append(button);
  container.append(heading);

  // The tooltip is also the button's description for screen readers.
  const sync = () => {
    const { mode, params, pressureUnit } = store.state;
    // A valid window always holds the triple point, so there is always one to snap to.
    button.title =
      mode === "isobar"
        ? `Snap the isobar to the triple point, p_tp = ${formatPressure(params.pt, pressureUnit)}`
        : `Snap the isotherm to the triple point, T_tp = ${formatTemperature(params.Tt)}`;
  };
  sync();
  store.subscribe(sync);
}
