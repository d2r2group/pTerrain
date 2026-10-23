// The GitHub button between the logo and the main row: a link to the source.

import { GITHUB, icon } from "./icons";

/** Where the source lives. */
export const REPO_URL = "https://github.com/d2r2group/pTerrain";

/** An icon-only link to the repository, opening in a new tab. */
export function createRepoLink(container: HTMLElement): void {
  const link = document.createElement("a");
  link.className = "repo-link icon-button";
  link.href = REPO_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "Source on GitHub");
  link.title = "Source on GitHub";
  link.innerHTML = icon(GITHUB);
  container.append(link);
}
