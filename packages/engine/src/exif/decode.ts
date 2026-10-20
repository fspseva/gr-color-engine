import { createDefaultParams } from '../recipes';
import type { RecipeParams } from '../recipes/types';
import { getControl } from '../recipes/controls';
import { parseRicohMakerNote, NotRicohMakerNoteError } from './tiff';
import {
  TAG,
  clarityValue,
  colorTemperatureK,
  highlightCorrection,
  imageToneToControl,
  indexToStep,
  monoFilterEffect,
  monoToning,
  pairFirstValue,
  parseControlSettings,
  shadowCorrection,
  wbShiftFromColorInfo,
  whiteBalanceMode,
} from './ricohTags';

/** Coarse Low/Normal/High levels from the standard EXIF tags (0xa408-0xa40a). */
export interface CoarseHints {
  contrast?: 'low' | 'normal' | 'high';
  saturation?: 'low' | 'normal' | 'high';
  sharpness?: 'low' | 'normal' | 'high';
}

export interface DecodedRecipe {
  params: RecipeParams;
  /** Camera model string from EXIF, e.g. "RICOH GR IIIx". */
  model: string | null;
  /** Human-readable label of the decoded image control. */
  controlLabel: string;
  /** Fields present in the file that we could not interpret. */
  warnings: string[];
  /** Fields the camera did not record (or nobody has reverse-engineered). */
  unavailable: string[];
  /** Coarse Low/Normal/High levels the camera did record. */
  coarse: CoarseHints;
  /** True when the file says highlight/shadow contrast adjustments were used. */
  usesContrastHlSh: boolean;
  /** Highlight Diffusion Filter state (GR IV / IIIx HDF), null if not recorded. */
  hdf: boolean | null;
  /** Fixed color temperature in Kelvin when the WB mode uses one, else null. */
  colorTemperatureK: number | null;
  /**
   * Decoded settings that have no slider in our simulator yet (per-control
   * tonings, filter fine-mix, …) shown as label/value text.
   */
  extras: { label: string; value: string }[];
}

/**
 * Decode a GR recipe from a MakerNote buffer + model string.
 * Returns null when the buffer isn't a Ricoh Pentax-style MakerNote or
 * carries no image control information.
 *
 * NOTE: interpretation is transcribed from ExifTool documentation and is
 * still unverified against real GR files.
 */
export function decodeMakerNote(
  makerNote: Uint8Array,
  model: string | null,
  coarse: CoarseHints = {},
): DecodedRecipe | null {
  let entries;
  try {
    entries = parseRicohMakerNote(makerNote);
  } catch (err) {
    if (err instanceof NotRicohMakerNoteError) return null;
    throw err;
  }

  const tone = entries.get(TAG.IMAGE_TONE)?.values[0];
  if (tone === undefined) return null;
  const control = imageToneToControl(tone);
  const warnings: string[] = [];
  if (control === null) {
    return null;
  }

  const params = createDefaultParams(control);
  const take = (
    tag: number,
    label: string,
    apply: (values: number[]) => boolean | null,
  ): void => {
    const entry = entries.get(tag);
    if (!entry) return;
    const ok = apply(entry.values);
    if (ok === null) warnings.push(`${label}: unrecognized value (${entry.values.join(' ')})`);
  };

  const applyStep = (key: 'saturation' | 'contrast' | 'sharpness' | 'hue') =>
    (values: number[]): boolean | null => {
      const step = indexToStep(values[0] ?? -1);
      if (step === null && values[0] !== 0xffff) return null;
      if (step !== null) params[key] = step;
      return true;
    };

  take(TAG.SATURATION, 'Saturation', applyStep('saturation'));
  take(TAG.CONTRAST, 'Contrast', applyStep('contrast'));
  take(TAG.SHARPNESS, 'Sharpness', applyStep('sharpness'));
  take(TAG.HUE, 'Hue', applyStep('hue'));

  take(TAG.HIGH_LOW_KEY, 'High/Low Key', (v) => {
    const s = pairFirstValue(v);
    if (s === null) return null;
    params.highLowKey = s;
    return true;
  });
  take(TAG.CONTRAST_HIGHLIGHT, 'Contrast (Highlight)', (v) => {
    const s = pairFirstValue(v);
    if (s === null) return null;
    params.contrastHighlight = s;
    return true;
  });
  take(TAG.CONTRAST_SHADOW, 'Contrast (Shadow)', (v) => {
    const s = pairFirstValue(v);
    if (s === null) return null;
    params.contrastShadow = s;
    return true;
  });
  take(TAG.CLARITY, 'Clarity', (v) => {
    const s = clarityValue(v);
    if (s === null) return null;
    params.clarity = s;
    return true;
  });
  take(TAG.MONO_FILTER_EFFECT, 'Filter Effect', (v) => {
    const f = monoFilterEffect(v[0] ?? -1);
    if (f === null) return null;
    // Legacy named filters (older Pentax bodies) -> approximate RGB mixes.
    const LEGACY_RGB: Record<string, [number, number, number]> = {
      yellow: [30, 60, -10], orange: [50, 45, -5], red: [70, 25, -5],
      green: [15, 75, -10], blue: [10, 20, -70], magenta: [45, 10, -45],
      cyan: [5, 50, -45], infrared: [45, 55, 0],
    };
    if (f !== 'off' && LEGACY_RGB[f]) {
      params.filterOn = true;
      [params.filterR, params.filterG, params.filterB] = LEGACY_RGB[f];
    }
    return true;
  });
  take(TAG.MONO_TONING, 'Toning', (v) => {
    const t = monoToning(v[0] ?? -1);
    if (t === null) return null;
    params.toning = t;
    return true;
  });
  take(TAG.WHITE_BALANCE, 'White Balance', (v) => {
    const wb = whiteBalanceMode(v[0] ?? -1);
    if (wb === null) return null;
    params.wbMode = wb;
    return true;
  });
  take(TAG.COLOR_INFO, 'WB Shift', (v) => {
    const shift = wbShiftFromColorInfo(v);
    if (shift === null) return null;
    params.wbShiftAB = shift.ab;
    params.wbShiftGM = shift.gm;
    return true;
  });
  take(TAG.DYNAMIC_RANGE_EXPANSION, 'Highlight Correction', (v) => {
    const h = highlightCorrection(v);
    if (h === null) return null;
    params.highlightCorrection = h;
    return true;
  });
  take(TAG.SHADOW_CORRECTION, 'Shadow Correction', (v) => {
    const s = shadowCorrection(v);
    if (s === null) return null;
    params.shadowCorrection = s;
    return true;
  });

  // GR III/IIIx firmware stores the exact slider values in the undocumented
  // 44-byte block at tag 0x0247 (community reverse engineering — see
  // docs/exif-decoder-notes.md). The K-5-era tags handled above stay as a
  // fallback for other Pentax/Ricoh bodies; 0x0247 wins when present.
  const mono = getControl(control).base.mono;
  const unavailable: string[] = [];
  const extras: { label: string; value: string }[] = [];
  const csEntry = entries.get(TAG.IMAGE_CONTROL_SETTINGS);
  const cs = csEntry ? parseControlSettings(csEntry.values) : null;
  if (cs) {
    // null = "n/a for this control" (sign byte 0x80) — silently keep default.
    const applySigned = (
      key:
        | 'saturation'
        | 'hue'
        | 'highLowKey'
        | 'contrast'
        | 'contrastHighlight'
        | 'contrastShadow'
        | 'sharpness'
        | 'shading'
        | 'clarity',
      label: string,
    ) => {
      const v = cs[key];
      if (v === null) return;
      if (v >= -4 && v <= 4) params[key] = v;
      else warnings.push(`${label}: out-of-range value ${v} in 0x0247`);
    };
    applySigned('saturation', 'Saturation');
    applySigned('hue', 'Hue');
    applySigned('highLowKey', 'High/Low Key');
    applySigned('contrast', 'Contrast');
    applySigned('contrastHighlight', 'Contrast (Highlight)');
    applySigned('contrastShadow', 'Contrast (Shadow)');
    applySigned('sharpness', 'Sharpness');
    // Some controls bake internal values into slider positions they don't
    // expose (verified on real files): HDR Tone writes junk at the shading
    // offset, Soft Monotone writes its built-in clarity −3. Skip those so
    // the UI doesn't present phantom user settings.
    if (control !== 'hdr-tone') applySigned('shading', 'Shading');
    if (control !== 'soft-monotone') applySigned('clarity', 'Clarity');
    if (cs.grain !== null) params.grain = cs.grain;

    if (mono) {
      const toningNames = ['Off', 'Sepia', 'Red', 'Green', 'Blue', 'Purple'];
      if (cs.monoToning !== null && cs.monoToning > 0) {
        extras.push({ label: 'Toning', value: toningNames[cs.monoToning] ?? `#${cs.monoToning}` });
        const named = toningNames[cs.monoToning]?.toLowerCase();
        if (named && named !== 'off') {
          params.namedToning = named as RecipeParams['namedToning'];
        }
      }
      // The menu's "filter add 1-4" is only a factory-preset picker for the
      // RGB sliders — renders depend solely on the RGB mix (proven
      // pixel-identical across levels, 2026-07-27). Show just the mix.
      if (cs.filterLevel !== null) {
        params.filterOn = true;
        params.filterR = cs.filterR ?? 10;
        params.filterG = cs.filterG ?? 70;
        // Stored as magnitude; the camera displays the B axis negated.
        params.filterB = -(cs.filterB ?? 20);
        const fmt = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v)}`;
        extras.push({
          label: 'Filter Effect',
          value: `R${fmt(params.filterR)}% G${fmt(params.filterG)}% B${fmt(params.filterB)}%`,
        });
      }
    }
    if (control === 'retro' && cs.retroToning !== null && cs.retroToning !== 0) {
      extras.push({ label: 'Toning', value: `${cs.retroToning > 0 ? '+' : ''}${cs.retroToning}` });
    }
    if (control === 'bleach-bypass' && cs.bleachToning) {
      extras.push({ label: 'Toning', value: cs.bleachToning === 1 ? 'Cool' : 'Warm' });
    }
    if (control === 'hdr-tone') {
      if (cs.hdrLevel) extras.push({ label: 'HDR Tone Level', value: String(cs.hdrLevel) });
      if (cs.hdrToning) extras.push({ label: 'Toning', value: cs.hdrToning === 1 ? 'BW' : 'Sepia' });
    }
    if (control === 'cross-processing' && cs.colorTone) {
      const tones: Record<number, string> = { 1: 'Blue', 2: 'Magenta', 3: 'Yellow' };
      extras.push({ label: 'Color Tone', value: tones[cs.colorTone] ?? `#${cs.colorTone}` });
    }
  } else {
    // No 0x0247 block and none of the fallback tags: report honestly.
    const missing: [number, string][] = [
      ...(mono
        ? ([
            [TAG.MONO_FILTER_EFFECT, 'Filter Effect'],
            [TAG.MONO_TONING, 'Toning'],
          ] as [number, string][])
        : ([
            [TAG.SATURATION, 'Saturation'],
            [TAG.HUE, 'Hue'],
          ] as [number, string][])),
      [TAG.HIGH_LOW_KEY, 'High/Low Key'],
      [TAG.CONTRAST, 'Contrast'],
      [TAG.CONTRAST_HIGHLIGHT, 'Contrast (Highlight)'],
      [TAG.CONTRAST_SHADOW, 'Contrast (Shadow)'],
      [TAG.SHARPNESS, 'Sharpness'],
      [TAG.CLARITY, 'Clarity'],
    ];
    unavailable.push(
      ...missing.filter(([tag]) => !entries.has(tag)).map(([, label]) => label),
      'Grain Effect',
      'Shading',
    );
  }

  const hlShAdj = entries.get(TAG.CONTRAST_HL_SH_ADJ)?.values[0];
  const hdfRaw = entries.get(TAG.HDF)?.values[0];
  const ctRaw = entries.get(TAG.COLOR_TEMPERATURE)?.values[0];

  return {
    params,
    model,
    controlLabel: getControl(control).label,
    warnings,
    unavailable,
    coarse,
    usesContrastHlSh: hlShAdj === 1,
    hdf: hdfRaw === undefined ? null : hdfRaw === 1,
    colorTemperatureK: ctRaw === undefined ? null : colorTemperatureK(ctRaw),
    extras,
  };
}
