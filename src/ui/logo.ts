// The p–Terrain logo: one SVG of outlines in `currentColor`, so it follows the theme
// and needs no web fonts. It replaces the text heading and keeps "pTerrain" as its name.

import logo from "../assets/logo.svg?raw";

/** The page heading: the logo, named "pTerrain" for screen readers. */
export function createLogo(container: HTMLElement): void {
  const heading = document.createElement("h1");
  heading.className = "logo";
  heading.innerHTML = logo;
  const svg = heading.querySelector("svg");
  if (!svg) throw new Error("pTerrain: the logo asset holds no <svg>");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "pTerrain");
  container.append(heading);
}
