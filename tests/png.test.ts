import { describe, expect, it } from "vitest";
import { fittingDpi, MAX_PNG_PIXELS, pngPixels, pngSide, withPhys } from "../src/ui/png";
import { crc32 } from "../src/ui/zip";

// The PNG side of the figure export (plan §8 phase 16 (c)): the pHYs writer and the DPI that fits.

/** A chunk's bytes: length, type, data, CRC. */
function chunk(type: string, data: number[]): number[] {
  const body = [...type].map((c) => c.charCodeAt(0)).concat(data);
  const be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  return [...be(data.length), ...body, ...be(crc32(new Uint8Array(body)))];
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
const IDAT = chunk("IDAT", [0x78, 0x9c, 0x63, 0, 1, 0, 0, 5, 0, 1]);
const IEND = chunk("IEND", []);

/** The chunks of a PNG, with their data and whether their CRC holds. */
function chunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset);
  const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const crc = view.getUint32(at + 8 + length);
    out.push({
      type,
      data: png.subarray(at + 8, at + 8 + length),
      crcOk: crc === crc32(png.subarray(at + 4, at + 8 + length)),
    });
    at += 12 + length;
  }
  return out;
}

describe("withPhys", () => {
  it("adds pHYs after IHDR with its CRC, in px per metre, unit 1", () => {
    const png = new Uint8Array([...SIGNATURE, ...IHDR, ...IDAT, ...IEND]);
    const out = withPhys(png, 300);
    expect([...out.subarray(0, 8)]).toEqual(SIGNATURE);
    const list = chunks(out);
    expect(list.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    expect(list.every((c) => c.crcOk)).toBe(true);
    const phys = new DataView(list[1]!.data.buffer, list[1]!.data.byteOffset);
    expect(list[1]!.data.length).toBe(9);
    expect(phys.getUint32(0)).toBe(11811);
    expect(phys.getUint32(4)).toBe(11811);
    expect(phys.getUint8(8)).toBe(1);
  });

  it("replaces a pHYs already there rather than adding a second", () => {
    const old = chunk("pHYs", [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1]);
    const png = new Uint8Array([...SIGNATURE, ...IHDR, ...old, ...IDAT, ...IEND]);
    const list = chunks(withPhys(png, 150));
    expect(list.map((c) => c.type)).toEqual(["IHDR", "pHYs", "IDAT", "IEND"]);
    expect(new DataView(list[1]!.data.buffer, list[1]!.data.byteOffset).getUint32(0)).toBe(5906);
  });

  it("refuses what is not a PNG", () => {
    expect(() => withPhys(new Uint8Array(16), 300)).toThrow();
  });
});

describe("fittingDpi", () => {
  it("keeps a DPI that fits and lowers one that does not to the largest that fits", () => {
    const small = [{ width: 440, height: 480 }];
    expect(fittingDpi(small, 600)).toBe(600);
    const images = [
      { width: 800, height: 840 },
      { width: 800, height: 450 },
    ];
    const d = fittingDpi(images, 600);
    expect(d).toBeLessThan(600);
    expect(pngPixels(800, 840, d)).toBeLessThanOrEqual(MAX_PNG_PIXELS);
    expect(pngPixels(800, 840, d + 1)).toBeGreaterThan(MAX_PNG_PIXELS);
  });

  it("rounds each side to whole pixels", () => {
    expect(pngSide(100, 300)).toBe(313);
    expect(pngPixels(100, 50, 96)).toBe(5000);
  });
});
