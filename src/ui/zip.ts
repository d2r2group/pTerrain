// The ZIP of a figure export (plan §8 phase 16 (c)), as ThermoBRIDGE's: stored entries (no compression), CRC-32
// and UTF-8 names, with no dependency. The files are a few KB of text, or PNG, which is already
// compressed. No DOM here.

/** One file of a ZIP: its name inside the archive and its bytes, or text written as UTF-8. */
export interface ZipEntry {
  name: string;
  data: Uint8Array | string;
}

/** The CRC-32 (IEEE 802.3, reflected, as ZIP and PNG use) of each byte value. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 of `bytes`. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `date` as MS-DOS time and date words (local time, 2 s steps, from 1980). */
function dosTime(date: Date): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** General-purpose flag bit 11: the name is UTF-8. */
const UTF8_FLAG = 0x0800;
/** The version needed to extract a stored entry: 1.0. */
const VERSION = 10;

/**
 * A ZIP archive of `entries`, in order, each stored without compression and named in UTF-8,
 * dated `date`. No ZIP64: every entry and the archive stay far under 4 GB.
 */
export function zip(entries: readonly ZipEntry[], date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const { time, day } = dosTime(date);
  const files = entries.map(({ name, data }) => {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    return { name: encoder.encode(name), bytes, crc: crc32(bytes) };
  });
  const localSize = files.reduce((n, f) => n + 30 + f.name.length + f.bytes.length, 0);
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;
  const u16 = (x: number) => {
    view.setUint16(at, x, true);
    at += 2;
  };
  const u32 = (x: number) => {
    view.setUint32(at, x >>> 0, true);
    at += 4;
  };
  const put = (bytes: Uint8Array) => {
    out.set(bytes, at);
    at += bytes.length;
  };
  /** The fields that a local header and a central record share, from the version needed on. */
  const common = (f: (typeof files)[number]) => {
    u16(VERSION);
    u16(UTF8_FLAG);
    u16(0); // stored
    u16(time);
    u16(day);
    u32(f.crc);
    u32(f.bytes.length);
    u32(f.bytes.length);
    u16(f.name.length);
    u16(0); // no extra field
  };

  const offsets: number[] = [];
  for (const f of files) {
    offsets.push(at);
    u32(0x04034b50);
    common(f);
    put(f.name);
    put(f.bytes);
  }
  const centralStart = at;
  files.forEach((f, k) => {
    u32(0x02014b50);
    u16(VERSION); // made by: MS-DOS, 1.0
    common(f);
    u16(0); // no comment
    u16(0); // disk 0
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(offsets[k]!);
    put(f.name);
  });
  const centralLength = at - centralStart;
  u32(0x06054b50);
  u16(0); // this disk
  u16(0); // the central directory's disk
  u16(files.length);
  u16(files.length);
  u32(centralLength);
  u32(centralStart);
  u16(0); // no comment
  return out;
}
