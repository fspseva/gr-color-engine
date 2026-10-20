/**
 * Minimal TIFF IFD parser for the Ricoh GR III/IIIx/IV MakerNote block.
 *
 * The block starts with "RICOH\0" followed by "II" (little-endian) or "MM"
 * (big-endian); the IFD begins at byte 8, and value offsets are relative to
 * the start of the block (per ExifTool's MakerNoteRicohPentax definition).
 */

export interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** Decoded numeric values (ascii/undef come back as byte values). */
  values: number[];
}

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
};

export class NotRicohMakerNoteError extends Error {
  constructor() {
    super('Buffer does not start with a RICOH Pentax-style MakerNote header.');
  }
}

export function parseRicohMakerNote(buffer: Uint8Array): Map<number, IfdEntry> {
  if (buffer.length < 16) throw new NotRicohMakerNoteError();
  const header = String.fromCharCode(...buffer.subarray(0, 5));
  if (header !== 'RICOH' || buffer[5] !== 0) throw new NotRicohMakerNoteError();
  const order = String.fromCharCode(buffer[6]!, buffer[7]!);
  if (order !== 'II' && order !== 'MM') throw new NotRicohMakerNoteError();
  const little = order === 'II';

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);

  const entries = new Map<number, IfdEntry>();
  const ifdStart = 8;
  if (ifdStart + 2 > buffer.length) throw new NotRicohMakerNoteError();
  const count = u16(ifdStart);

  for (let i = 0; i < count; i++) {
    const at = ifdStart + 2 + i * 12;
    if (at + 12 > buffer.length) break;
    const tag = u16(at);
    const type = u16(at + 2);
    const n = u32(at + 4);
    const size = TYPE_SIZES[type];
    if (!size || n > 0x10000) continue; // skip unknown/absurd entries
    const byteLen = size * n;
    // Values <= 4 bytes are inline; larger ones are at an offset relative
    // to the start of the MakerNote block.
    const valueOffset = byteLen <= 4 ? at + 8 : u32(at + 8);
    if (valueOffset + byteLen > buffer.length) continue;

    const values: number[] = [];
    for (let j = 0; j < n; j++) {
      const o = valueOffset + j * size;
      switch (type) {
        case 1:
        case 2:
        case 7:
          values.push(view.getUint8(o));
          break;
        case 6:
          values.push(view.getInt8(o));
          break;
        case 3:
          values.push(u16(o));
          break;
        case 8:
          values.push(view.getInt16(o, little));
          break;
        case 4:
          values.push(u32(o));
          break;
        case 9:
          values.push(view.getInt32(o, little));
          break;
      }
    }
    entries.set(tag, { tag, type, count: n, values });
  }
  return entries;
}
