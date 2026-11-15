// The PNG side of the figure export (plan §8 phase 16 (c)), as ThermoBRIDGE's: the DPI a PNG is drawn at, lowered for
// every image of an export when the largest would pass MAX_PNG_PIXELS, and the `pHYs` chunk that
// records it, which browsers' encoders leave out. No DOM.

import { crc32 } from "./zip";

/** The DPIs the Figure menu offers, and the one chosen at first. */
export const DPIS = [150, 300, 600] as const;
export const DEFAULT_DPI = 300;

/** CSS px per inch: a PNG of DPI d is the SVG drawn at d / 96 px per CSS px. */
export const CSS_PX_PER_INCH = 96;

/**
 * The most pixels an export draws in one canvas: iOS Safari's reported limit (4096²), checked
 * against this constant rather than the browser, so that every browser lowers the same DPIs.
 */
export const MAX_PNG_PIXELS = 16_777_216;

/** A canvas side for `css` CSS px at `dpi`, whole px and at least 1. */
export const pngSide = (css: number, dpi: number) =>
  Math.max(1, Math.round((css * dpi) / CSS_PX_PER_INCH));

/** The pixels of an image `width` × `height` CSS px drawn at `dpi`. */
export const pngPixels = (width: number, height: number, dpi: number) =>
  pngSide(width, dpi) * pngSide(height, dpi);

/**
 * `dpi`, or, when the largest of `images` (CSS px) would pass `max` pixels at it, the largest
 * whole DPI at which it fits, for every image of the export alike.
 */
export function fittingDpi(
  images: readonly { width: number; height: number }[],
  dpi: number,
  max = MAX_PNG_PIXELS,
): number {
  const largest = images.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a), {
    width: 0,
    height: 0,
  });
  if (pngPixels(largest.width, largest.height, dpi) <= max) return dpi;
  // A first guess from the area, then moved to the largest that fits: each side's rounding can
  // put the pixel count on either side of the area's.
  const fits = (d: number) => pngPixels(largest.width, largest.height, d) <= max;
  let d = Math.max(
    1,
    Math.min(
      dpi - 1,
      Math.floor(CSS_PX_PER_INCH * Math.sqrt(max / (largest.width * largest.height))),
    ),
  );
  while (d > 1 && !fits(d)) d--;
  while (d + 1 < dpi && fits(d + 1)) d++;
  return Math.max(1, d);
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Metres per inch, for pixels per metre. */
const INCH_M = 0.0254;

/** A PNG chunk: length, type, data and the CRC-32 over type and data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * `png` with a `pHYs` chunk after `IHDR` saying `dpi`: pixels per metre `round(dpi / 0.0254)` on
 * both axes, unit 1 (the metre). A `pHYs` already there is replaced.
 */
export function withPhys(png: Uint8Array, dpi: number): Uint8Array {
  if (!SIGNATURE.every((b, i) => png[i] === b)) throw new Error("not a PNG");
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ppm = Math.round(dpi / INCH_M);
  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  data[8] = 1;
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    const end = at + 12 + length;
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type !== "pHYs") parts.push(png.subarray(at, end));
    if (type === "IHDR") parts.push(chunk("pHYs", data));
    at = end;
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
