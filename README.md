<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo-light.svg" alt="pTerrain" width="320" />
  </picture>
</h1>

An interactive $p$-$T$ phase diagram of a one-component system, with the molar
Gibbs free energy of solid, liquid and vapor along one cut plotted underneath, for
teaching MATL7355.

**Open it at <https://d2r2group.github.io/pTerrain/>.**

The cut is an isobar or an isotherm across the diagram. The panel below plots
$g$ of all three phases along it, on the same x axis: the stable phase (lowest
$g$) is drawn as a full line and shaded in its region's color, the metastable
ones dashed. Dotted lines join each crossing of two $g$ curves to the boundary
above it, and the stable transitions are written in bold under the diagram.

## Using it

- **$p$ | $T$** swaps the axes: an isobar with $g(T)$, or an isotherm with $g(p)$.
- **ⓘ**, beside it, opens a short overview of the app and of every button.
- **Move the cut** by dragging its line, with the slider or number field, or
  with the keyboard on its handle. Hatched strips are where the cut meets no
  boundary.
- **kPa | bar | atm** sets the pressure unit everywhere; clicking the **logo**
  moves the cut through $(T_\mathrm{tp}, p_\mathrm{tp})$.
- **Metastable** shows or hides the metastable extensions and curves.
- **Exaggerate s-l slope** enlarges $\Delta v_\mathrm{fus}$ so that the almost
  vertical solid–liquid line visibly leans (back for water, forward for CO₂). It
  changes the model, so the slice and values follow; the s-v and l-v lines stay
  put.
- **Substance** picks CO₂ (the default), H₂O or **Custom**, which opens
  **Parameters**; that edits every input and the plot window (fitted
  automatically while **auto** is ticked). Edits take effect on **Apply**, and
  only if they pass the validity checks.
- **Export** / **Import** save and load a substance as JSON; **Share** makes a
  link that opens the same substance and cut (e.g. `#h2o;T,250`).
- **Model Details**, in the footer, shows the model's equations, the substance
  data and their sources, the limits and the numerics.

## Model

Each phase has a closed-form molar $g$ referenced to the triple point: the solid
and liquid are incompressible, the vapor is an ideal gas, and every $c_p$ is
constant, so there is no critical point. Boundaries are found where two $g$ are
equal, so Clapeyron, the triple point and
$\Delta h_\mathrm{sub} = \Delta h_\mathrm{fus} + \Delta h_\mathrm{vap}$ follow
rather than being imposed. The slice plots $g - g_\mathrm{tp}$, where $g_\mathrm{tp}$ is
the value all three phases share at the triple point, with slopes
$\partial g/\partial T = -s$ along an isobar and $\partial g/\partial p = v$
along an isotherm, and its axis follows the cut. The $p$ axis is logarithmic.

The presets use real data at the triple point (retrieved October 2026):

| Input | CO₂ | H₂O |
|---|---|---|
| $T_\mathrm{tp}$ | 216.592 K | 273.16 K |
| $p_\mathrm{tp}$ | 517.964 kPa | 0.611654 kPa |
| $\Delta h_\mathrm{vap}$ | 15.420 kJ/mol | 45.055 kJ/mol |
| $\Delta h_\mathrm{fus}$ | 8.90 kJ/mol | 6.007 kJ/mol |
| $s_\mathrm{s}$ | 75.09 J/(mol·K) | 41.34 J/(mol·K) |
| $v_\mathrm{s}$ | 0.02856 L/mol | 0.019652 L/mol |
| $v_\mathrm{l}$ | 0.037345 L/mol | 0.018019 L/mol |
| $c_{p,\mathrm{s}}$ / $c_{p,\mathrm{l}}$ / $c_{p,\mathrm{v}}$ | 56 / 85.96 / 39.99 J/(mol·K) | 37.77 / 76.02 / 33.95 J/(mol·K) |
| Window | 160–275 K × 100–2500 kPa | 200–345 K × 0.015–25 kPa |

Sources: the [NIST Chemistry WebBook](https://webbook.nist.gov/chemistry/fluid/)
(IAPWS-95, Span–Wagner 1996) and CODATA entropies; IAPWS R10-06 for ice;
Giauque & Egan (1937) for solid CO₂. Water is within 0.5 K of the reference
everywhere checked (boiling at 373.6 K vs 373.1 K at 1 atm). CO₂'s
liquid–vapor line falls low toward the critical point (6 % at 233 K, 29 % at
293 K), so its window stops at 275 K.

## Development

Needs Node 22.13+, 24 or 26+; CI uses [.nvmrc](.nvmrc).

```sh
npm ci
npm run dev           # local server with reload
npm test              # Vitest unit tests
npm run build         # static site in dist/
npm run test:e2e      # Playwright against the built site (build first)
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck     # tsc --noEmit
npm run math          # re-render the Model Details formulas after editing them
```

The first Playwright run needs `npx playwright install chromium`. The physics
is in [src/physics/](src/physics/) (no dependencies) and the interface in
[src/ui/](src/ui/), drawn with D3. The Model Details formulas are TeX in
[src/ui/modelDetails.ts](src/ui/modelDetails.ts), pre-rendered to SVG with
MathJax into the committed [src/assets/math.json](src/assets/math.json); a test
fails while it is out of date. [CI](.github/workflows/pterrain.yml) runs every
check on each push and pull request and deploys `main` to GitHub Pages.

## Development note

Claude Opus 5.5 (Anthropic) was used in developing this app, in close iteration
under the author's supervision.

## License

pTerrain is released under the MIT License; see [LICENSE](LICENSE). Bundled
fonts and outlines keep their own licenses: Lato (SIL Open Font License),
Latin Modern Math in the logo (GUST Font License) and MathJax's TeX fonts in
the formulas (Apache License 2.0).
