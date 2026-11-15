// A small ZIP reader for the tests of the export (plan §8 phase 16 (c)): it follows the end record to
// the central directory and each local header, checks that they agree, and returns the stored
// entries. It reads only what `ui/zip.ts` writes: stored entries, no ZIP64.

export interface ZipRead {
  name: string;
  data: Uint8Array;
  crc: number;
  flags: number;
  method: number;
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(`not a ZIP that ui/zip.ts writes: ${what}`);
}

/** The entries of `bytes`, in the central directory's order. */
export function unzip(bytes: Uint8Array): ZipRead[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  check(view.getUint32(end, true) === 0x06054b50, "no end record");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  check(at + view.getUint32(end + 12, true) === end, "the central directory's size");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const out: ZipRead[] = [];
  for (let k = 0; k < count; k++) {
    check(view.getUint32(at, true) === 0x02014b50, "a central record's signature");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    check(view.getUint32(at + 24, true) === size, "a stored entry's two sizes");
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    check(view.getUint32(offset, true) === 0x04034b50, "a local header's signature");
    check(view.getUint32(offset + 14, true) === crc, "the local header's CRC");
    const localName = view.getUint16(offset + 26, true);
    const localExtra = view.getUint16(offset + 28, true);
    check(
      decoder.decode(bytes.subarray(offset + 30, offset + 30 + localName)) === name,
      "the local header's name",
    );
    const start = offset + 30 + localName + localExtra;
    out.push({ name, data: bytes.subarray(start, start + size), crc, flags, method });
    at += 46 + nameLength + extra;
  }
  return out;
}
