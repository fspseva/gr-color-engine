import type {
  FilterEffect,
  HighlightCorrection,
  ImageControlId,
  ShadowCorrection,
  WhiteBalanceMode,
} from '../recipes/types';

/**
 * Tag interpretation for GR III / IIIx / IV Pentax-format MakerNotes,
 * transcribed from ExifTool's Pentax.pm (see docs/exif-decoder-notes.md).
 *
 * UNVERIFIED against real camera files as of 2026-07-17 — built purely from
 * documentation. Verify with original GR JPEGs before trusting output.
 */

export const TAG = {
  IMAGE_CONTROL_SETTINGS: 0x0247,
  CONTRAST_HL_SH_ADJ: 0x006f,
  COLOR_TEMPERATURE: 0x0050,
  WHITE_BALANCE: 0x0019,
  SATURATION: 0x001f,
  CONTRAST: 0x0020,
  SHARPNESS: 0x0021,
  IMAGE_TONE: 0x004f,
  HUE: 0x0067,
  DYNAMIC_RANGE_EXPANSION: 0x0069, // "highlight correction"
  HIGH_LOW_KEY: 0x006c,
  CONTRAST_HIGHLIGHT: 0x006d,
  CONTRAST_SHADOW: 0x006e,
  MONO_FILTER_EFFECT: 0x0073,
  MONO_TONING: 0x0074,
  SHADOW_CORRECTION: 0x0079,
  CLARITY: 0x0096,
  HDF: 0x009e,
  COLOR_INFO: 0x0222, // subdirectory: WB shift lives at bytes 16/17
} as const;

/** ImageTone values written by GR III/IIIx/IV. */
const IMAGE_TONE_TO_CONTROL: Record<number, ImageControlId> = {
  256: 'standard',
  257: 'vivid',
  258: 'monotone',
  259: 'soft-monotone',
  260: 'hard-monotone',
  261: 'hi-contrast-bw',
  262: 'positive-film',
  263: 'bleach-bypass',
  264: 'retro',
  265: 'hdr-tone',
  266: 'cross-processing',
  267: 'negative-film',
  33024: 'monotone', // GR IV Monochrome body
};

export function imageToneToControl(value: number): ImageControlId | null {
  return IMAGE_TONE_TO_CONTROL[value] ?? null;
}

/**
 * Pentax index table used by Saturation, Contrast, Sharpness and Hue:
 * index -> slider step. 65535 means "n/a" (e.g. saturation in mono).
 */
const INDEX_TO_STEP: Record<number, number> = {
  0: -2,
  1: 0,
  2: 2,
  3: -1,
  4: 1,
  5: -3,
  6: 3,
  7: -4,
  8: 4,
};

export function indexToStep(value: number): number | null {
  if (value === 0xffff) return null;
  return INDEX_TO_STEP[value] ?? null;
}

/** int16s[2] tags ("v 0") used by HighLowKey / ContrastHighlight / ContrastShadow. */
export function pairFirstValue(values: number[]): number | null {
  if (values.length < 1) return null;
  const v = values[0]!;
  return v >= -4 && v <= 4 ? v : null;
}

/** ClarityControl int8s[2]: [0,0] = off, [1,v] = v. */
export function clarityValue(values: number[]): number | null {
  if (values.length < 2) return null;
  if (values[0] === 0) return 0;
  const v = values[1]!;
  return v >= -4 && v <= 4 ? v : null;
}

const MONO_FILTER: Record<number, FilterEffect> = {
  1: 'green',
  2: 'yellow',
  3: 'orange',
  4: 'red',
  5: 'magenta',
  6: 'blue',
  7: 'cyan',
  8: 'infrared',
};

export function monoFilterEffect(value: number): FilterEffect | null {
  if (value === 0xffff) return 'off'; // "None"
  return MONO_FILTER[value] ?? null;
}

/** MonochromeToning: 0..8 -> -4..+4, 65535 = n/a. */
export function monoToning(value: number): number | null {
  if (value === 0xffff) return 0;
  return value >= 0 && value <= 8 ? value - 4 : null;
}

/**
 * ColorTemperature tag 0x0050 (int16u): Kelvin = 53190 − raw, per ExifTool.
 * Raw 0 means "not set" (non-Kelvin WB modes).
 */
export function colorTemperatureK(value: number): number | null {
  if (!value) return null;
  const k = 53190 - value;
  return k >= 2000 && k <= 20000 ? k : null;
}

const WHITE_BALANCE: Record<number, WhiteBalanceMode> = {
  0: 'auto',
  1: 'daylight',
  2: 'shade',
  4: 'tungsten',
  5: 'manual',
  6: 'fl-daylight',
  7: 'fl-neutral',
  8: 'fl-white',
  10: 'cloudy',
  11: 'fl-warm',
  14: 'multi-auto',
  15: 'cta',
  17: 'kelvin',
};

export function whiteBalanceMode(value: number): WhiteBalanceMode | null {
  return WHITE_BALANCE[value] ?? null;
}

/**
 * ShadowCorrection int8u[1..2]: "0"/"0 0" off, "1 1" weak, "1 2" normal,
 * "1 3" strong, "2 4" auto.
 */
export function shadowCorrection(values: number[]): ShadowCorrection | null {
  if (values.length === 0) return null;
  if (values[0] === 0) return 'off';
  if (values[0] === 2) return 'auto';
  if (values[0] === 1) {
    const level = values[1] ?? 2;
    return level === 1 ? 'low' : level === 3 ? 'high' : 'medium';
  }
  return null;
}

/**
 * DynamicRangeExpansion (highlight correction) int8u[4].
 * Byte 1 is the user's setting: 0 off, 1 on, 2 auto. Byte 0 records whether
 * the expansion actually engaged for this exposure (scene-dependent) —
 * verified on real files: setting On can appear as [0,1,..] or [1,1,..].
 */
export function highlightCorrection(values: number[]): HighlightCorrection | null {
  if (values.length < 2) return null;
  const setting = values[1];
  return setting === 0 ? 'off' : setting === 1 ? 'on' : setting === 2 ? 'auto' : null;
}

/**
 * GR III/IIIx image-control slider block, Pentax tag 0x0247 (undef[44]).
 * Byte layout reverse-engineered by the community (ovibobi's
 * ricoh-recipe-decoder); verified against real GR IIIx HDF files with a
 * known recipe. ±4 sliders are little-endian int16 pairs (value byte +
 * 0x00/0xff sign byte); the fields marked "single" are one raw byte.
 */
export interface ControlSettings {
  saturation: number | null;
  hue: number | null;
  highLowKey: number | null;
  contrast: number | null;
  contrastHighlight: number | null;
  contrastShadow: number | null;
  sharpness: number | null;
  shading: number | null;
  clarity: number | null;
  /** Our 0 (off) .. 3 (high). */
  grain: number | null;
  /** Monotone toning choice: 0 off, 1 Sepia, 2 Red, 3 Green, 4 Blue, 5 Purple. */
  monoToning: number | null;
  /** Mono filter strength 1..4, or null when off. */
  filterLevel: number | null;
  filterR: number | null; // RGB custom-slider percents (camera defaults 10/70/20)
  filterG: number | null;
  filterB: number | null;
  retroToning: number | null; // ± value (Retro control)
  bleachToning: number | null; // 0 off, 1 Cool, 2 Warm
  hdrToning: number | null; // 0 off, 1 BW, 2 Sepia
  hdrLevel: number | null;
  colorTone: number | null; // Cross Processing: 1 Blue, 2 Magenta, 3 Yellow
}

/** Raw grain byte -> Off/Low/Medium/High as 0..3. */
const GRAIN_RAW: Record<number, number> = { 0: 0, 5: 1, 3: 2, 1: 3 };

export function parseControlSettings(values: number[]): ControlSettings | null {
  if (values.length < 44) return null;
  // Sign byte: 0x00 positive, 0xff negative, 0x80 "not applicable for this
  // control" (verified on real files: mono controls write 0x8000 for
  // saturation/hue). Singles use 0xff for n/a.
  const pair = (n: number): number | null => {
    const lo = values[n]!;
    const sign = values[n + 1]!;
    if (sign === 0xff) return lo - 256;
    if (sign === 0) return lo;
    return null; // 0x80 n/a or unknown
  };
  const single = (n: number): number | null => {
    const v = values[n]!;
    return v === 0xff ? null : v;
  };

  return {
    saturation: pair(0),
    hue: pair(2),
    highLowKey: pair(4),
    contrast: pair(6),
    contrastHighlight: pair(8),
    contrastShadow: pair(10),
    sharpness: pair(12),
    retroToning: pair(16),
    shading: pair(18),
    clarity: pair(20),
    monoToning: pair(26),
    grain: (() => {
      const raw = pair(38);
      return raw === null ? null : (GRAIN_RAW[raw] ?? null);
    })(),
    // Byte 34 is the mono filter strength ("filter add" 1..4 in the menu;
    // camera ground truth 2026-07-20). 0 and 8 both mean off — 8 also fills
    // the byte on controls without a filter setting.
    filterLevel: (() => {
      const v = single(34);
      return v !== null && v >= 1 && v <= 4 ? v : null;
    })(),
    filterR: single(35),
    filterG: single(36),
    filterB: single(37),
    bleachToning: single(28),
    hdrToning: single(30),
    hdrLevel: single(32),
    colorTone: single(42),
  };
}

/**
 * ColorInfo block, int8s at byte 16/17. ExifTool: positive AB = toward blue,
 * positive GM = toward green. Our params use positive = A (amber) and
 * positive = M (magenta), so both signs flip. Confirmed on camera:
 * raw -14/+2 displays as A14 G2.
 */
export function wbShiftFromColorInfo(values: number[]): { ab: number; gm: number } | null {
  if (values.length < 18) return null;
  const toSigned = (v: number) => (v > 127 ? v - 256 : v);
  const ab = -toSigned(values[16]!);
  const gm = -toSigned(values[17]!);
  if (Math.abs(ab) > 14 || Math.abs(gm) > 14) return null;
  return { ab, gm };
}
