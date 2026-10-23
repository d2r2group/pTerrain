// Lato for all text (SIL Open Font License), bundled so the page loads no font from elsewhere.
import "@fontsource/lato/400.css";
import "@fontsource/lato/400-italic.css";
import "@fontsource/lato/700.css";
import "./style.css";
import { PRESETS } from "./physics/presets";
import {
  createCutInput,
  createExaggerateToggle,
  createMetastableToggle,
  createModeToggle,
  createReadout,
  createSnapButton,
} from "./ui/controls";
import { createLogo } from "./ui/logo";
import { createFooter } from "./ui/modelDetails";
import { createPhaseDiagram } from "./ui/phaseDiagram";
import { createSlicePanel } from "./ui/slicePanel";
import { Store } from "./ui/state";
import { createSubstancePanel } from "./ui/substancePanel";
import { createThemeToggle } from "./ui/theme";
import { storedUnit } from "./ui/units";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("pTerrain: #app element is missing from index.html");

// From top to bottom: the logo and the main row of controls, with the theme button at the far
// right; a bar with the substance menu, the Metastable toggle and Share; then the plots, as wide
// as the bar, with a column beside both on wide screens, or below on narrow ones: the cut input
// with the pressure unit, the exaggerated s-l slope checkbox, the readout (for screen readers
// only) and the substance panel. All four are items of one grid, so that on a narrow phone the
// header's and the bar's buttons can share a row. The footer follows, after <main>.
const header = document.createElement("header");
const mainRow = document.createElement("div");
mainRow.className = "main-row";
mainRow.setAttribute("role", "group");
mainRow.setAttribute("aria-label", "Main controls");
const layout = document.createElement("div");
layout.className = "layout";
// The diagram and the slice panel are stacked with no gap, so the guide lines run straight on.
const plots = document.createElement("div");
plots.className = "plots";
const plotBar = document.createElement("div");
plotBar.className = "plot-bar";
plotBar.setAttribute("role", "group");
plotBar.setAttribute("aria-label", "Substance, Metastable and Share");
const diagram = document.createElement("div");
const slice = document.createElement("div");
plots.append(diagram, slice);
const controls = document.createElement("aside");
controls.className = "controls";
controls.setAttribute("aria-label", "Cut and substance");
layout.append(header, plotBar, plots, controls);
app.replaceChildren(layout);

const store = new Store(PRESETS.h2o, "isobar", storedUnit());
createLogo(header);
header.append(mainRow);
createModeToggle(mainRow, store);
createSnapButton(mainRow, store);
createThemeToggle(header);
createMetastableToggle(plotBar, store);
createCutInput(controls, store);
createReadout(controls, store);
createExaggerateToggle(controls, store);
const substancePanel = createSubstancePanel(controls, plotBar, store);
createPhaseDiagram(diagram, store);
createSlicePanel(slice, store);
createFooter(document.body);

// A share link, at start-up or pasted into an open tab: the fragment is
// imported, then removed, so that a reload does not undo the edits made since.
const openFragment = () => {
  if (location.hash.length <= 1) return;
  const fragment = location.hash;
  history.replaceState(null, "", location.pathname + location.search);
  substancePanel.openLink(fragment);
};
openFragment();
window.addEventListener("hashchange", openFragment);
