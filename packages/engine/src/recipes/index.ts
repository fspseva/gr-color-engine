import type { ImageControlId, RecipeParams } from './types';
import { getControl } from './controls';

export * from './types';
export { IMAGE_CONTROLS, getControl, isImageControlId } from './controls';

/** Camera step ranges for each numeric slider. */
export const RANGES = {
  saturation: { min: -4, max: 4 },
  hue: { min: -4, max: 4 },
  highLowKey: { min: -4, max: 4 },
  contrast: { min: -4, max: 4 },
  contrastHighlight: { min: -4, max: 4 },
  contrastShadow: { min: -4, max: 4 },
  sharpness: { min: -4, max: 4 },
  clarity: { min: -4, max: 4 },
  shading: { min: -4, max: 4 },
  grain: { min: 0, max: 3 },
  toning: { min: -4, max: 4 },
  wbShiftAB: { min: -14, max: 14 },
  wbShiftGM: { min: -14, max: 14 },
} as const;

export type NumericParamKey = keyof typeof RANGES;

export function createDefaultParams(control: ImageControlId = 'standard'): RecipeParams {
  getControl(control); // throws on unknown id
  return {
    control,
    saturation: 0,
    hue: 0,
    highLowKey: 0,
    contrast: 0,
    contrastHighlight: 0,
    contrastShadow: 0,
    sharpness: 0,
    clarity: 0,
    shading: 0,
    grain: 0,
    filterOn: false,
    filterR: 10,
    filterG: 70,
    filterB: -20,
    toning: 0,
    wbMode: 'auto',
    wbShiftAB: 0,
    wbShiftGM: 0,
    highlightCorrection: 'off',
    shadowCorrection: 'off',
  };
}

/** Clamp every numeric slider into its camera range and round to whole steps. */
export function clampParams(params: RecipeParams): RecipeParams {
  const out = { ...params };
  for (const key of Object.keys(RANGES) as NumericParamKey[]) {
    const { min, max } = RANGES[key];
    out[key] = Math.min(max, Math.max(min, Math.round(out[key])));
  }
  for (const key of ['filterR', 'filterG', 'filterB'] as const) {
    out[key] = Math.min(120, Math.max(-120, Math.round(out[key] / 10) * 10));
  }
  if (
    out.namedToning &&
    !['sepia', 'red', 'green', 'blue', 'purple'].includes(out.namedToning)
  ) {
    delete out.namedToning;
  }
  return out;
}

/**
 * Express `params` relative to a `baseline` recipe that is already baked into
 * the photo's pixels (a decoded original). With the same image control
 * selected, the result renders as identity when params === baseline, and as
 * the *difference* when sliders move (values may exceed camera ranges — the
 * engine handles that linearly). If the user switches to a different image
 * control, we can't un-bake the old look, so params apply absolutely on top.
 */
export function relativeParams(params: RecipeParams, baseline: RecipeParams): RecipeParams {
  if (params.control !== baseline.control) return params;
  // Neutral base: plain mono for baked-mono photos (keeps toning/grain live),
  // Standard otherwise.
  const neutral: ImageControlId = getControl(baseline.control).base.mono ? 'monotone' : 'standard';
  const out = { ...params, control: neutral };
  for (const key of Object.keys(RANGES) as NumericParamKey[]) {
    out[key] = params[key] - baseline[key];
  }
  // Filter mix: identical to baseline -> baked in, render none; else absolute.
  const sameFilter =
    params.filterOn === baseline.filterOn &&
    params.filterR === baseline.filterR &&
    params.filterG === baseline.filterG &&
    params.filterB === baseline.filterB;
  out.filterOn = sameFilter ? false : params.filterOn;
  out.highlightCorrection =
    params.highlightCorrection === baseline.highlightCorrection ? 'off' : params.highlightCorrection;
  out.shadowCorrection =
    params.shadowCorrection === baseline.shadowCorrection ? 'off' : params.shadowCorrection;
  return out;
}
