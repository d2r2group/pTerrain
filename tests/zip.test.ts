import { describe, expect, it } from "vitest";
import { crc32, zip } from "../src/ui/zip";
import { unzip } from "./zipReader";

// The ZIP of a figure export (plan §8 phase 16 (c)), read back by tests/zipReader.ts.

describe("crc32", () => {
  it("matches known values", () => {
    const enc = new TextEncoder();
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(enc.encode("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
});

describe("zip", () => {
  it("stores each entry under its UTF-8 name, in order, with its CRC", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 1, 2]);
    const text = "α₁ + β\n";
    const bytes = zip([
      { name: "Eutectic_α1.json", data: text },
      { name: "plot.png", data: png },
    ]);
    const [json, image] = unzip(bytes);
    expect(json!.name).toBe("Eutectic_α1.json");
    expect(new TextDecoder().decode(json!.data)).toBe(text);
    expect(json!.crc).toBe(crc32(new TextEncoder().encode(text)));
    expect(json!.flags & 0x0800).toBe(0x0800);
    expect(json!.method).toBe(0);
    expect(image!.name).toBe("plot.png");
    expect([...image!.data]).toEqual([...png]);
  });

  it("writes an empty archive and the date as MS-DOS time", () => {
    expect(unzip(zip([]))).toEqual([]);
    const bytes = zip([{ name: "a", data: "" }], new Date(2026, 10, 13, 14, 30, 58));
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(10, true)).toBe((14 << 11) | (30 << 5) | 29);
    expect(view.getUint16(12, true)).toBe((46 << 9) | (11 << 5) | 13);
  });
});
