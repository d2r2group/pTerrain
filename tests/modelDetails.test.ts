import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PRESETS, type PresetId } from "../src/physics/presets";
import { modelDetailsHtml, substanceTable } from "../src/ui/modelDetails";
import { substanceValues, type FieldKey } from "../src/ui/substanceFields";

/** The values the table shows, by preset and field, read back from its HTML. */
function tableValues(html: string): Map<string, string> {
  const cells = html.matchAll(/data-preset="(\w+)" data-key="(\w+)">([^<]*)</g);
  return new Map([...cells].map(([, id, key, text]) => [`${id}.${key}`, text!]));
}

const WINDOW: ReadonlySet<FieldKey> = new Set(["Tmin", "Tmax", "pmin", "pmax", "gRange"]);

describe("model details", () => {
  it("shows every input of both presets as presets.ts has it, and not the window", () => {
    const shown = tableValues(substanceTable());
    const ids = Object.keys(PRESETS) as PresetId[];
    let count = 0;
    for (const id of ids) {
      const values = substanceValues(PRESETS[id].params, PRESETS[id].window);
      for (const [key, value] of Object.entries(values) as [FieldKey, number][]) {
        if (WINDOW.has(key)) {
          expect(shown.has(`${id}.${key}`), `${id}.${key}`).toBe(false);
          continue;
        }
        expect(Number(shown.get(`${id}.${key}`)), `${id}.${key}`).toBe(value);
        count++;
      }
    }
    expect(shown.size).toBe(count);
  });

  it("holds the six sections, with the table, and the development note", () => {
    const html = modelDetailsHtml();
    const headings = [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map(([, h]) => h);
    expect(headings).toEqual([
      "Gibbs free energies",
      "What follows from them",
      "Compared with integrating Clausius–Clapeyron",
      "Substance data",
      "Limits",
      "Numerics",
    ]);
    expect(html).toContain(substanceTable());
    expect(html).toMatch(/class="disclaimer">Claude Opus 5\.5/);
  });

  it("has every formula rendered, from its current TeX", () => {
    // Exits non-zero, and so throws, when src/assets/math.json is out of date.
    const script = fileURLToPath(new URL("../scripts/renderMath.mjs", import.meta.url));
    expect(() =>
      execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
    expect(modelDetailsHtml()).toContain("<svg");
  });
});
