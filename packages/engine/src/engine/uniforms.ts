import type { BaseLook, RecipeParams } from '../recipes/types';
import { RANGES, type NumericParamKey } from '../recipes';
import { getControl } from '../recipes/controls';
import type { Sector6 } from '../recipes/wbTables';
import { applyChain, buildChain, type ChainItem } from './ops';

/**
 * Flat numeric values handed to the shader. This module is the single place
 * where camera slider steps become rendering strengths.
 *
 * v2.25: white balance (shift and mode), the tone sliders and the colour
 * controls' base looks are MEASURED OPERATORS (src/lib/engine/ops.ts),
 * chained in linear light. The parametric tone fields below remain only
 * for looks without a measured operator (the monochromes, HDR Tone).
 */
export interface EngineUniforms {
  /** Measured operator chain (linear light), applied after pre-flattening. */
  chain: ChainItem[];
  /** Pre-flattening from highlight/shadow correction. */
  hlCompress: number; // 0..1
  shLift: number; // 0..1
  /** Parametric tone (base looks without an operator only). */
  blackLift: number;
  whitePoint: number;
  gamma: number;
  sCurve: number;
  /** Color. */
  satMul: number; // 0 for mono
  hueDeg: number;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  /** Local contrast / detail. */
  clarityAmt: number; // uses large blur
  localContrastAmt: number; // HDR tone, uses large blur
  sharpAmt: number; // uses small blur
  /** Effects. */
  vignetteAmt: number; // positive darkens corners
  grainAmt: number;
  mono: boolean;
  monoWeights: [number, number, number];
  toningTint: [number, number, number];
  /** Per-hue display-space correction: 6 sector hue deltas (deg) + 6 relative sat changes (S *= 1 + ds). */
  hueCorDh: number[];
  hueCorDs: number[];
  /**
   * Descriptors of what the chain does, for recipe similarity: linear gains
   * on an 18% grey and the luma the chain returns for five grey levels.
   */
  greyGain: [number, number, number];
  toneProbe: number[];
}

/**
 * Per-step strengths for the operators that stay parametric. Measured
 * 2026-07-24/27 (see docs/calibration-standard-results.md).
 */
const STEP = {
  saturation: 0.085001, // measured: ±4 → ×0.64 / ×1.33
  hueDeg: 2.3001, // measured: ±4 → ∓9.7° / +9.1°
  clarity: 0.067001, // measured full-res: ±4 → mid-band energy ×0.79 / ×1.27
  sharpness: 0.1001, // measured full-res: ±4 → fine-band energy ×0.61 / ×1.41
  vignette: 0.12001, // measured: −4 → corners at ~0.59×
  grain: 0.08001, // measured full-res: levels 1-3 → noise ×1.56 / ×2.0 / ×2.9
  toning: 0.25001,
} as const;

// Measured (full-res regression): with the filter OFF the GR's mono
// conversion is near-pure red channel; with it ON the user's RGB slider
// percentages are used, normalized.
const MONO_DEFAULT: [number, number, number] = [0.9001, 0.12001, -0.02001];
function monoWeightsFor(p: RecipeParams): [number, number, number] {
  if (!p.filterOn) return MONO_DEFAULT;
  // Camera-display values; the B axis is display-inverted vs the actual
  // render weight (measured: default "B-20" renders as +0.24 blue weight).
  const r = p.filterR;
  const g = p.filterG;
  const b = -p.filterB;
  const sum = r + g + b;
  if (sum <= 0.01) return MONO_DEFAULT;
  return [r / sum, g / sum, b / sum];
}

/** Named mono tonings, measured 2026-08-20 from in-camera Monotone
 *  developments of the color chart (R0003639–3644): median additive offset
 *  in linear space under the shader's midtone mask, vs the untinted frame. */
const NAMED_TONING_TINTS: Record<string, [number, number, number]> = {
  sepia: [0.043001, -0.007001, -0.073801],
  red: [0.072801, -0.027601, -0.027601],
  green: [-0.054301, 0.028501, 0],
  blue: [-0.020801, 0, 0.065201],
  purple: [0.007001, -0.013901, 0.050401],
};

/** The toning tint a recipe contributes: named menu choice, or the numeric
 *  warm/cool slider (warm end tuned to the measured Sepia tint, cool end to
 *  the measured Blue toning). */
function toningVec(p: RecipeParams): [number, number, number] {
  if (p.namedToning && NAMED_TONING_TINTS[p.namedToning]) {
    return NAMED_TONING_TINTS[p.namedToning];
  }
  const t = p.toning * STEP.toning; // -1..1, + warm
  return t >= 0
    ? [t * 0.043001, -t * 0.007001, -t * 0.073801]
    : [t * 0.020801, 0, -t * 0.065201];
}

const ZERO6: Sector6 = [0, 0, 0, 0, 0, 0];

interface HueCor { dh: Sector6; ds: Sector6 }

/** Difference of two per-hue tables (target minus baseline), undefined when both absent. */
function subHueTables(a: BaseLook['hueTable'], b: BaseLook['hueTable']): BaseLook['hueTable'] {
  if (!a && !b) return undefined;
  const ad = a?.dh ?? ZERO6, as = a?.ds ?? ZERO6, bd = b?.dh ?? ZERO6, bs = b?.ds ?? ZERO6;
  return {
    dh: ad.map((v, i) => v - bd[i]) as Sector6,
    ds: as.map((v, i) => v - bs[i]) as Sector6,
  };
}

/**
 * Slider-driven part of the per-hue correction for one side of a render
 * (target or baseline): the Hue slider's per-sector deviation scaled by that
 * side's own slider value. The WB shift's hue geometry is NOT added: the
 * measured WB operators already carry it, and the v2.23 tables on top made
 * every WB development worse in the real renderer (M14+A14 4.5 → 1.4 RMS
 * without them; scripts/engine-check.mjs, 2026-10-20).
 */
function hueCorSide(base: BaseLook, hue: number): HueCor {
  const hs = base.hueTable?.hs ?? ZERO6;
  return { dh: hs.map((v) => hue * v) as Sector6, ds: [...ZERO6] as Sector6 };
}

function probes(chain: ChainItem[]): Pick<EngineUniforms, 'greyGain' | 'toneProbe'> {
  const g = applyChain(chain, [0.18, 0.18, 0.18]);
  const luma = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return {
    greyGain: [g[0] / 0.18, g[1] / 0.18, g[2] / 0.18],
    toneProbe: [0.02, 0.1, 0.25, 0.5, 0.8].map((v) => luma(applyChain(chain, [v, v, v]))),
  };
}

/**
 * Build uniforms, optionally RELATIVE to a baseline recipe already baked
 * into the photo's pixels (a decoded original). The measured operators
 * chain the exact inverse of the baseline's before the target's; the
 * remaining parametric parts (sat/hue, detail, tints of operator-less
 * looks) are divided out the same way as before. A color recipe over a
 * baked-mono photo is unrecoverable and falls back to absolute.
 */
export function buildUniforms(params: RecipeParams, baseline?: RecipeParams): EngineUniforms {
  if (!baseline) {
    const A = getControl(params.control).base;
    return computeUniforms(params, A, toningVec(params),
      hueCorSide(A, params.hue),
      buildChain(params), A.baseChroma ?? A.saturation);
  }
  const R = getControl(params.control).base;
  const B = getControl(baseline.control).base;
  const corR = hueCorSide(R, params.hue);
  const corB = hueCorSide(B, baseline.hue);
  const corDiff: HueCor = {
    dh: corR.dh.map((v, k) => v - corB.dh[k]) as Sector6,
    ds: corR.ds.map((v, k) => v - corB.ds[k]) as Sector6,
  };
  if (B.mono && !R.mono) return computeUniforms(params, R, toningVec(params), corR, buildChain(params), R.baseChroma ?? R.saturation); // color is gone

  const d = { ...params };
  for (const key of Object.keys(RANGES) as NumericParamKey[]) {
    d[key] = params[key] - baseline[key];
  }
  const sameFilter =
    params.filterOn === baseline.filterOn &&
    params.filterR === baseline.filterR &&
    params.filterG === baseline.filterG &&
    params.filterB === baseline.filterB;
  d.filterOn = sameFilter ? false : params.filterOn;
  d.highlightCorrection =
    params.highlightCorrection === baseline.highlightCorrection ? 'off' : params.highlightCorrection;
  d.shadowCorrection =
    params.shadowCorrection === baseline.shadowCorrection ? 'off' : params.shadowCorrection;

  const sub = (x: [number, number, number], y: [number, number, number]): [number, number, number] =>
    [x[0] - y[0], x[1] - y[1], x[2] - y[2]];
  const effBase: BaseLook = {
    mono: R.mono,
    saturation: R.mono ? 1 : R.saturation / Math.max(0.05, B.saturation),
    contrast: R.contrast - B.contrast,
    blackLift: R.blackLift - B.blackLift,
    whitePoint: R.whitePoint / Math.max(0.05, B.whitePoint),
    gamma: R.gamma / Math.max(0.05, B.gamma),
    hueRotate: R.hueRotate - B.hueRotate,
    shadowTint: sub(R.shadowTint, B.shadowTint),
    highlightTint: sub(R.highlightTint, B.highlightTint),
    localContrast: R.localContrast - B.localContrast,
    grainBase: R.grainBase, // grain can be added, never removed
    hueTable: subHueTables(R.hueTable, B.hueTable),
  };
  const tv = toningVec(params);
  const bv = toningVec(baseline);
  // The saturation slider's restoring law depends on the TARGET look's
  // absolute base saturation, not on the ratio between the two looks.
  return computeUniforms(d, effBase, [tv[0] - bv[0], tv[1] - bv[1], tv[2] - bv[2]], corDiff, buildChain(params, baseline), R.baseChroma ?? R.saturation);
}

function computeUniforms(
  params: RecipeParams,
  base: BaseLook,
  toningTint: [number, number, number],
  hueCorExtra: HueCor,
  chain: ChainItem[],
  satRef: number,
): EngineUniforms {
  const hlCompress =
    params.highlightCorrection === 'off' ? 0 : params.highlightCorrection === 'on' ? 0.5 : 0.3;
  const shLift =
    params.shadowCorrection === 'off'
      ? 0
      : params.shadowCorrection === 'low'
        ? 0.15
        : params.shadowCorrection === 'medium'
          ? 0.3
          : params.shadowCorrection === 'high'
            ? 0.45
            : 0.25; // auto

  return {
    chain,
    hlCompress,
    shLift,
    blackLift: base.blackLift,
    whitePoint: base.whitePoint,
    gamma: base.gamma,
    sCurve: base.contrast,
    // The Saturation slider is a measured operator in the chain (sat:N,
    // scripts/fit-sat-ops.py); only the base look's own multiplier stays.
    satMul: base.mono ? 1 : base.saturation,
    hueDeg: base.mono ? 0 : base.hueRotate + params.hue * STEP.hueDeg,
    shadowTint: base.shadowTint,
    highlightTint: base.highlightTint,
    clarityAmt: params.clarity * STEP.clarity,
    localContrastAmt: base.localContrast,
    sharpAmt: Math.max(0, params.sharpness * STEP.sharpness),
    // Measured: negative Shading darkens corners (vignette), positive
    // brightens them — the slider is a peripheral-illumination adjustment.
    vignetteAmt: -params.shading * STEP.vignette,
    grainAmt: base.mono ? base.grainBase + params.grain * STEP.grain : base.grainBase,
    mono: base.mono,
    monoWeights: base.mono ? monoWeightsFor(params) : MONO_DEFAULT,
    toningTint: base.mono ? toningTint : [0, 0, 0],
    hueCorDh: base.mono
      ? [...ZERO6]
      : (base.hueTable?.dh ?? ZERO6).map((v, k) => v + hueCorExtra.dh[k]),
    hueCorDs: base.mono
      ? [...ZERO6]
      : (base.hueTable?.ds ?? ZERO6).map((v, k) => v + hueCorExtra.ds[k]),
    ...probes(chain),
  };
}
