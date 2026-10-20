import { describe, expect, it } from 'vitest';
import { decodeMakerNote } from './decode';
import { parseRicohMakerNote } from './tiff';
import { TAG } from './ricohTags';

/** IFD entry spec for the synthetic MakerNote builder. */
interface Entry {
  tag: number;
  type: number; // 1 BYTE, 3 SHORT, 7 UNDEF, 8 SSHORT
  values: number[];
}

const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4 };

/** Build a "RICOH\0II" (or MM) MakerNote block the way a GR III would. */
function buildMakerNote(entries: Entry[], little = true): Uint8Array {
  const ifdStart = 8;
  const dirSize = 2 + entries.length * 12 + 4;
  let extraOffset = ifdStart + dirSize;
  const extras: { offset: number; bytes: number[] }[] = [];

  const encode = (type: number, values: number[]): number[] => {
    const size = TYPE_SIZES[type]!;
    const out: number[] = [];
    for (const v of values) {
      const uv = v < 0 ? v + (size === 1 ? 256 : size === 2 ? 65536 : 4294967296) : v;
      for (let b = 0; b < size; b++) {
        out.push((uv >>> (8 * (little ? b : size - 1 - b))) & 0xff);
      }
    }
    return out;
  };

  const entryRecords = entries.map((e) => {
    const bytes = encode(e.type, e.values);
    let inline: number[];
    let offset: number | null = null;
    if (bytes.length <= 4) {
      inline = [...bytes, 0, 0, 0, 0].slice(0, 4);
    } else {
      offset = extraOffset;
      extras.push({ offset, bytes });
      extraOffset += bytes.length + (bytes.length % 2);
      inline = encode(4, [offset]);
    }
    return { ...e, inline, offset };
  });

  const buf = new Uint8Array(extraOffset);
  buf.set([0x52, 0x49, 0x43, 0x4f, 0x48, 0x00]); // "RICOH\0"
  buf[6] = little ? 0x49 : 0x4d;
  buf[7] = little ? 0x49 : 0x4d;

  const u16 = (at: number, v: number) => {
    if (little) {
      buf[at] = v & 0xff;
      buf[at + 1] = v >>> 8;
    } else {
      buf[at] = v >>> 8;
      buf[at + 1] = v & 0xff;
    }
  };
  const u32 = (at: number, v: number) => {
    if (little) {
      u16(at, v & 0xffff);
      u16(at + 2, v >>> 16);
    } else {
      u16(at, v >>> 16);
      u16(at + 2, v & 0xffff);
    }
  };

  u16(ifdStart, entries.length);
  entryRecords.forEach((e, i) => {
    const at = ifdStart + 2 + i * 12;
    u16(at, e.tag);
    u16(at + 2, e.type);
    u32(at + 4, e.values.length);
    buf.set(e.inline, at + 8);
  });
  u32(ifdStart + 2 + entries.length * 12, 0); // next-IFD pointer

  for (const x of extras) buf.set(x.bytes, x.offset);
  return buf;
}

/** A ColorInfo block with WB shift at bytes 16/17 (raw ExifTool signs). */
function colorInfo(rawAB: number, rawGM: number): number[] {
  const block = new Array(18).fill(0);
  block[16] = rawAB;
  block[17] = rawGM;
  return block;
}

describe('parseRicohMakerNote', () => {
  it('rejects non-Ricoh buffers', () => {
    expect(() => parseRicohMakerNote(new Uint8Array(32))).toThrow();
    const apple = new TextEncoder().encode('Apple iOS\0not a ricoh block padding');
    expect(() => parseRicohMakerNote(apple)).toThrow();
  });

  it('parses big-endian (MM) blocks too', () => {
    const buf = buildMakerNote([{ tag: TAG.IMAGE_TONE, type: 3, values: [262] }], false);
    const entries = parseRicohMakerNote(buf);
    expect(entries.get(TAG.IMAGE_TONE)?.values[0]).toBe(262);
  });
});

describe('decodeMakerNote', () => {
  it('decodes a full Positive Film recipe', () => {
    const buf = buildMakerNote([
      { tag: TAG.WHITE_BALANCE, type: 3, values: [1] },
      { tag: TAG.SATURATION, type: 3, values: [8] }, // +4
      { tag: TAG.CONTRAST, type: 3, values: [6] }, // +3
      { tag: TAG.SHARPNESS, type: 3, values: [1] }, // 0
      { tag: TAG.IMAGE_TONE, type: 3, values: [262] }, // Positive Film
      { tag: TAG.HUE, type: 3, values: [7] }, // -4
      { tag: TAG.DYNAMIC_RANGE_EXPANSION, type: 1, values: [0, 1, 0, 0] }, // set On, not engaged
      { tag: TAG.HIGH_LOW_KEY, type: 8, values: [2, 0] },
      { tag: TAG.CONTRAST_HIGHLIGHT, type: 8, values: [-3, 0] },
      { tag: TAG.CONTRAST_SHADOW, type: 8, values: [1, 0] },
      { tag: TAG.SHADOW_CORRECTION, type: 1, values: [1, 3] },
      { tag: TAG.CLARITY, type: 6, values: [1, -2] },
      { tag: TAG.COLOR_INFO, type: 7, values: colorInfo(-5, 3) },
    ]);
    const decoded = decodeMakerNote(buf, 'RICOH GR IIIx');
    expect(decoded).not.toBeNull();
    const p = decoded!.params;
    expect(decoded!.controlLabel).toBe('Positive Film');
    expect(p.control).toBe('positive-film');
    expect(p.saturation).toBe(4);
    expect(p.contrast).toBe(3);
    expect(p.sharpness).toBe(0);
    expect(p.hue).toBe(-4);
    expect(p.highLowKey).toBe(2);
    expect(p.contrastHighlight).toBe(-3);
    expect(p.contrastShadow).toBe(1);
    expect(p.clarity).toBe(-2);
    expect(p.wbMode).toBe('daylight');
    // ExifTool: positive raw AB = toward blue; our +AB = amber, so -5 -> +5.
    expect(p.wbShiftAB).toBe(5);
    expect(p.wbShiftGM).toBe(-3);
    expect(p.highlightCorrection).toBe('on');
    expect(p.shadowCorrection).toBe('high');
    expect(decoded!.warnings).toEqual([]);
    expect(decoded!.model).toBe('RICOH GR IIIx');
  });

  it('decodes a Monotone recipe with filter effect and toning', () => {
    const buf = buildMakerNote([
      { tag: TAG.IMAGE_TONE, type: 3, values: [258] },
      { tag: TAG.SATURATION, type: 3, values: [0xffff] }, // n/a in mono
      { tag: TAG.MONO_FILTER_EFFECT, type: 3, values: [4] }, // red
      { tag: TAG.MONO_TONING, type: 3, values: [6] }, // +2
    ]);
    const decoded = decodeMakerNote(buf, 'RICOH GR III');
    expect(decoded!.params.control).toBe('monotone');
    expect(decoded!.params.filterOn).toBe(true);
    expect(decoded!.params.filterR).toBe(70); // legacy 'red' preset
    expect(decoded!.params.toning).toBe(2);
    expect(decoded!.params.saturation).toBe(0); // untouched by n/a
    expect(decoded!.warnings).toEqual([]);
  });

  it('returns null for non-Ricoh MakerNotes and missing ImageTone', () => {
    expect(decodeMakerNote(new Uint8Array(64), null)).toBeNull();
    const noTone = buildMakerNote([{ tag: TAG.SATURATION, type: 3, values: [1] }]);
    expect(decodeMakerNote(noTone, null)).toBeNull();
    const unknownTone = buildMakerNote([{ tag: TAG.IMAGE_TONE, type: 3, values: [9999] }]);
    expect(decodeMakerNote(unknownTone, null)).toBeNull();
  });

  it('collects warnings for unrecognized values instead of failing', () => {
    const buf = buildMakerNote([
      { tag: TAG.IMAGE_TONE, type: 3, values: [256] },
      { tag: TAG.SATURATION, type: 3, values: [77] }, // not in the index table
    ]);
    const decoded = decodeMakerNote(buf, null);
    expect(decoded).not.toBeNull();
    expect(decoded!.params.saturation).toBe(0);
    expect(decoded!.warnings.length).toBe(1);
    expect(decoded!.warnings[0]).toMatch(/Saturation/);
  });

  it('reports grain and shading as unavailable when 0x0247 is absent', () => {
    const buf = buildMakerNote([{ tag: TAG.IMAGE_TONE, type: 3, values: [256] }]);
    const decoded = decodeMakerNote(buf, null);
    expect(decoded!.unavailable.join(' ')).toMatch(/Grain/);
    expect(decoded!.unavailable.join(' ')).toMatch(/Shading/);
  });

  it('decodes sliders from the GR III 0x0247 block', () => {
    // sat +3, hue -1, key 0, contrast +2, hl +2, sh -4, sharp 0, shading -2,
    // clarity -1, grain raw 3 (=Medium), rest zero.
    const block = new Array(44).fill(0);
    const setPair = (off: number, v: number) => {
      block[off] = v < 0 ? v + 256 : v;
      block[off + 1] = v < 0 ? 255 : 0;
    };
    setPair(0, 3);
    setPair(2, -1);
    setPair(6, 2);
    setPair(8, 2);
    setPair(10, -4);
    setPair(18, -2);
    setPair(20, -1);
    setPair(38, 3);
    const buf = buildMakerNote([
      { tag: TAG.IMAGE_TONE, type: 3, values: [267] },
      { tag: TAG.IMAGE_CONTROL_SETTINGS, type: 7, values: block },
    ]);
    const decoded = decodeMakerNote(buf, null);
    const p = decoded!.params;
    expect(p.saturation).toBe(3);
    expect(p.hue).toBe(-1);
    expect(p.contrast).toBe(2);
    expect(p.contrastHighlight).toBe(2);
    expect(p.contrastShadow).toBe(-4);
    expect(p.shading).toBe(-2);
    expect(p.clarity).toBe(-1);
    expect(p.grain).toBe(2); // raw 3 -> Medium
    expect(decoded!.unavailable).toEqual([]);
    expect(decoded!.warnings).toEqual([]);
  });

  it('decodes Kelvin color temperature (53190 - raw)', () => {
    const buf = buildMakerNote([
      { tag: TAG.IMAGE_TONE, type: 3, values: [256] },
      { tag: TAG.WHITE_BALANCE, type: 3, values: [17] }, // Kelvin
      { tag: TAG.COLOR_TEMPERATURE, type: 3, values: [53190 - 5500] },
    ]);
    const decoded = decodeMakerNote(buf, null);
    expect(decoded!.params.wbMode).toBe('kelvin');
    expect(decoded!.colorTemperatureK).toBe(5500);
    // raw 0 = not set
    const buf2 = buildMakerNote([
      { tag: TAG.IMAGE_TONE, type: 3, values: [256] },
      { tag: TAG.COLOR_TEMPERATURE, type: 3, values: [0] },
    ]);
    expect(decodeMakerNote(buf2, null)!.colorTemperatureK).toBeNull();
  });

  it('decodes mono toning and filter mix into extras', () => {
    const block = new Array(44).fill(0);
    block[26] = 1; // toning: Sepia
    block[34] = 1; // filter on
    block[35] = 40; // R+40%
    block[36] = 10;
    block[37] = 20;
    const buf = buildMakerNote([
      { tag: TAG.IMAGE_TONE, type: 3, values: [258] }, // Monotone
      { tag: TAG.IMAGE_CONTROL_SETTINGS, type: 7, values: block },
    ]);
    const decoded = decodeMakerNote(buf, null);
    const extras = Object.fromEntries(decoded!.extras.map((e) => [e.label, e.value]));
    expect(extras['Toning']).toBe('Sepia');
    expect(extras['Filter Effect']).toBe('R+40% G+10% B−20%');
  });

  it('treats filter byte 0 and 8 as off', () => {
    for (const raw of [0, 8]) {
      const block = new Array(44).fill(0);
      block[34] = raw;
      const buf = buildMakerNote([
        { tag: TAG.IMAGE_TONE, type: 3, values: [258] },
        { tag: TAG.IMAGE_CONTROL_SETTINGS, type: 7, values: block },
      ]);
      const decoded = decodeMakerNote(buf, null);
      expect(decoded!.extras.find((e) => e.label === 'Filter Effect')).toBeUndefined();
    }
  });
});
