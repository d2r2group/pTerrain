import { describe, expect, it } from "vitest";
import {
  BAND_LABEL_GAP,
  placeBandLabels,
  SIDE_INSET,
  type BandLabel,
  type BandLabelRun,
} from "../src/ui/bandLabels";

// The stable phases' letters over the slice panel's band.

const run = (name: string, x0: number, x1: number, width = 10): BandLabelRun => ({
  name,
  phase: name,
  x0,
  x1,
  width,
});

describe("the band's letters", () => {
  it("centers each letter on its run, left to right", () => {
    const placed = placeBandLabels([run("v", 300, 400), run("s", 0, 200)], 400);
    expect(placed.map((l) => [l.name, l.x])).toEqual([
      ["s", 100],
      ["v", 350],
    ]);
  });

  it("leaves out a middle run's letter where it does not fit over the run", () => {
    const tight = 10 + 2 * BAND_LABEL_GAP;
    expect(placeBandLabels([run("l", 100, 100 + tight)], 400)).toHaveLength(1);
    expect(placeBandLabels([run("l", 100, 99 + tight)], 400)).toHaveLength(0);
  });

  it("always names a run on either side, however narrow, inset from the side", () => {
    const placed = placeBandLabels([run("s", 0, 3), run("v", 398, 400)], 400);
    expect(placed.map((l) => [l.name, l.x])).toEqual([
      ["s", 5 + SIDE_INSET],
      ["v", 395 - SIDE_INSET],
    ]);
  });

  it("never overlaps two letters: a side run's goes ahead of a narrow middle run's", () => {
    // The liquid run fits, but its letter would overlap the solid's, which is pulled in from the side.
    const placed = placeBandLabels([run("s", 0, 3), run("l", 3, 22), run("v", 22, 400)], 400);
    expect(placed.map((l) => l.name)).toEqual(["s", "v"]);
    const [a, b] = placed as [BandLabel, BandLabel];
    expect(b.x - a.x).toBeGreaterThanOrEqual((a.width + b.width) / 2 + BAND_LABEL_GAP);
  });

  it("puts the wider of two middle runs first", () => {
    const placed = placeBandLabels([run("l", 100, 119, 12), run("v", 119, 160, 12)], 400);
    expect(placed.map((l) => l.name)).toEqual(["v"]);
  });

  it("keeps every letter SIDE_INSET inside the plot area", () => {
    const placed = placeBandLabels([run("s", 0, 400, 30)], 400);
    expect(placed[0]!.x).toBe(200);
    const [l] = placeBandLabels([run("v", 395, 400, 16)], 400);
    expect(l!.x).toBe(400 - 8 - SIDE_INSET);
    const [r] = placeBandLabels([run("s", 0, 2, 16)], 400);
    expect(r!.x).toBe(8 + SIDE_INSET);
  });
});
