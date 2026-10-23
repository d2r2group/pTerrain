import { describe, expect, it } from "vitest";
import { autoWindow } from "../src/physics/autoWindow";
import { CUSTOM, PRESETS, type Preset } from "../src/physics/presets";
import {
  cleanName,
  fileName,
  parseLink,
  parseSubstanceFile,
  toLink,
  toSubstanceFile,
  type Substance,
} from "../src/ui/substanceFile";

const { h2o, co2 } = PRESETS;
const substance = (preset: Preset, extra: Partial<Substance> = {}): Substance => ({
  name: preset.name,
  params: preset.params,
  window: preset.window,
  auto: true,
  ...extra,
});

/** A Custom substance with a typed window and numbers that need all their digits. */
const typed: Substance = {
  name: "Dry ice, 1 atm #2 — café",
  params: { ...CUSTOM.params, Tt: 301.234567891, pt: 0.000123, cp: { s: 1e-7, l: 12.5, v: 0 } },
  window: { Tmin: 220, Tmax: 380, pmin: 0.00001, pmax: 0.05 },
  auto: false,
};

/** The substance file as an object, to break it one key at a time. */
const fileObject = () => JSON.parse(toSubstanceFile("H₂O", h2o.params, h2o.window, true));
const problemOf = (text: string) => {
  const parsed = parseSubstanceFile(text);
  return parsed.ok ? null : parsed.problem;
};

describe("substance file", () => {
  it("round-trips the name, parameters, window and box", () => {
    for (const s of [substance(h2o), substance(co2), substance(CUSTOM, { auto: false }), typed]) {
      const parsed = parseSubstanceFile(toSubstanceFile(s.name, s.params, s.window, s.auto));
      expect(parsed).toEqual({ ok: true, value: s });
    }
  });

  it("is pretty-printed JSON in the model's units, with a units map", () => {
    const text = toSubstanceFile("H₂O", h2o.params, h2o.window, true);
    expect(text).toContain('\n  "format": "pterrain-substance",\n  "version": 1,');
    const file = JSON.parse(text);
    expect(file.params.pt).toBe(0.611654);
    expect(file.params.cp).toEqual({ s: 37.77, l: 76.02, v: 33.95 });
    expect(file.window).toEqual(h2o.window);
    expect(file.autoWindow).toBe(true);
    expect(file.units).toMatchObject({ pt: "kPa", dHfus: "kJ/mol", Vs: "L/mol" });
  });

  it("ignores unknown keys and does not read units", () => {
    const file = fileObject();
    file.comment = "made by hand";
    file.params.extra = "x";
    file.units = { pt: "bar" };
    const parsed = parseSubstanceFile(JSON.stringify(file));
    expect(parsed).toEqual({ ok: true, value: substance(h2o) });
  });

  it("trims the name and applies an empty one as Custom", () => {
    const file = fileObject();
    file.name = "  Water  ";
    expect(parseSubstanceFile(JSON.stringify(file))).toMatchObject({ value: { name: "Water" } });
    file.name = "   ";
    expect(parseSubstanceFile(JSON.stringify(file))).toMatchObject({ value: { name: "Custom" } });
    expect(cleanName("x".repeat(50))).toBe("x".repeat(40));
  });

  it("names the first problem of a malformed file", () => {
    expect(problemOf("{ not json")).toBe("it is not JSON");
    expect(problemOf("[1, 2]")).toBe("it is not a JSON object");
    const cases: [(file: ReturnType<typeof fileObject>) => void, string][] = [
      [(f) => (f.format = "other"), 'its format is not "pterrain-substance"'],
      [(f) => (f.version = 2), "version 2 is not supported"],
      [(f) => delete f.version, "version undefined is not supported"],
      [(f) => (f.name = 3), "its name is not a string"],
      [(f) => delete f.params, "params is missing"],
      [(f) => delete f.params.dHvap, "params.dHvap is missing or not a finite number"],
      [(f) => (f.params.Vs = "0.02"), "params.Vs is missing or not a finite number"],
      [(f) => (f.params.cp.l = null), "params.cp.l is missing or not a finite number"],
      [(f) => delete f.params.cp, "params.cp is missing"],
      [(f) => delete f.window.pmax, "window.pmax is missing or not a finite number"],
      [(f) => (f.autoWindow = "yes"), "autoWindow is not true or false"],
    ];
    for (const [breakIt, problem] of cases) {
      const file = fileObject();
      breakIt(file);
      expect(problemOf(JSON.stringify(file))).toBe(problem);
    }
    // JSON has no Infinity, but a number too large for a double parses as one.
    const huge = toSubstanceFile("H₂O", h2o.params, h2o.window, true).replace("273.16", "1e999");
    expect(problemOf(huge)).toBe("params.Tt is missing or not a finite number");
  });

  it("names the download after the substance", () => {
    expect(fileName("H₂O")).toBe("H2O.json");
    expect(fileName("CO₂")).toBe("CO2.json");
    expect(fileName("Dry ice (1 atm), café!")).toBe("Dry_ice_1_atm_cafe.json");
    expect(fileName("my-substance_2")).toBe("my-substance_2.json");
    expect(fileName("")).toBe("substance.json");
    expect(fileName("?!")).toBe("substance.json");
  });
});

describe("share link", () => {
  it("round-trips with and without a window and a view", () => {
    const views = [undefined, { mode: "isobar", cut: 12.34 }, { mode: "isotherm", cut: 250.5 }];
    const subs = [
      typed,
      { ...typed, auto: true, window: autoWindow(typed.params) },
      substance(CUSTOM, { name: "Custom" }),
      substance(h2o, { name: "Water, mine" }),
      substance(h2o, { name: "H₂O#1;ñ" }),
    ];
    for (const s of subs) {
      for (const view of views) {
        const link = toLink(s, view as never);
        expect(link).toMatch(/^#[^#;]*(;[^#;]*)?$/);
        expect(parseLink(link)).toEqual({ ok: true, value: { substance: s, view } });
      }
    }
  });

  it("writes numbers in their shortest exact form, without the leading 0", () => {
    const link = toLink({ ...typed, name: "x" });
    expect(link).toBe(
      "#1,x,301.234567891,.000123,2.49,12.5,33.3,2,3.5,1e-7,12.5,0,220,380,.00001,.05",
    );
    expect(toLink(substance(h2o), { mode: "isobar", cut: Math.sqrt(0.611654 * 25) })).toBe(
      "#h2o;p,3.91",
    );
    expect(toLink(substance(h2o), { mode: "isotherm", cut: 0.123456 })).toBe("#h2o;T,.1235");
  });

  it("gives a preset its id, which parses back to the preset", () => {
    expect(toLink(substance(h2o))).toBe("#h2o");
    expect(toLink(substance(co2, { auto: false }))).toBe("#co2");
    expect(toLink(substance(h2o), { mode: "isotherm", cut: 250 })).toBe("#h2o;T,250");
    expect(parseLink("#co2")).toEqual({ ok: true, value: { substance: substance(co2) } });
    expect(parseLink("h2o;T,250")).toEqual({
      ok: true,
      value: { substance: substance(h2o), view: { mode: "isotherm", cut: 250 } },
    });
    // Another name, or another window, writes the substance out.
    expect(toLink(substance(h2o, { name: "Water" }))).toMatch(/^#1,Water,273.16,/);
  });

  it("has the measured lengths", () => {
    // Written out, H₂O is 82 characters with its name, which takes 11 encoded (H%E2%82%82O).
    const named = substance(h2o, { name: "Water" });
    const full = 82 - 11 + "Water".length;
    expect(encodeURIComponent("H₂O")).toHaveLength(11);
    expect(toLink(named)).toHaveLength(full);
    expect(toLink({ ...named, auto: false })).toHaveLength(full + 16);
    expect(toLink(named, { mode: "isotherm", cut: 250 })).toHaveLength(full + 6);
    expect(toLink(substance(h2o), { mode: "isotherm", cut: 250 })).toHaveLength(10);
  });

  it("names the first problem of a malformed fragment", () => {
    const nums = "273.16,.611654,6.007,45.055,41.34,.019652,.018019,37.77,76.02,33.95";
    const cases: [string, string][] = [
      ["", "it is empty"],
      ["#", "it is empty"],
      ["#2,x," + nums, "version 2 is not supported"],
      ["#nacl", 'unknown substance "nacl"'],
      ["#toString", 'unknown substance "toString"'],
      ["#h2o,1", "the preset id h2o takes no numbers"],
      ["#1,x,1,2,3", "it has 3 numbers, not 10 or 14"],
      ["#1,x," + nums + ",1", "it has 11 numbers, not 10 or 14"],
      ["#1,x," + nums + ",1,2,3,4,5", "it has 15 numbers, not 10 or 14"],
      ["#1,x," + nums.replace("6.007", "Infinity"), "dHfus is not a finite number"],
      ["#1,x," + nums.replace("6.007", "1e999"), "dHfus is not a finite number"],
      ["#1,x," + nums.replace("6.007", ""), "dHfus is not a finite number"],
      ["#1,x," + nums.replace("6.007", "0x10"), "dHfus is not a finite number"],
      ["#1,%E2%82," + nums, "its name is not encoded right"],
      ["#h2o;q,250", 'unknown mode "q"'],
      ["#h2o;T", "its view is not <p|T>,<cut>"],
      ["#h2o;T,abc", "the cut is not a finite number"],
      ["#h2o;T,250;p,3", "it has more than one ;"],
    ];
    for (const [fragment, problem] of cases) {
      expect(parseLink(fragment)).toEqual({ ok: false, problem });
    }
  });
});
