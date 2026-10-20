import type { RecipeParams } from '../recipes/types';
import { OPS } from './ops.generated';
import { getControl } from '../recipes/controls';

/**
 * Measured colour operators (v2.25). Each fitted operator maps linear RGB
 * through a 3×3 matrix and then three per-channel curves:
 *   out = g(M · in),  g given by 12 knots at gamma-spaced inputs KX.
 * Tone sliders are curves only (M = I); WB shift sides, WB modes and the
 * colour-control base looks carry a matrix. A recipe becomes an ordered
 * chain of such operators; rendering RELATIVE to a decoded original chains
 * the exact inverse of the original's operators first (curves invert as
 * piecewise-linear functions, matrices invert directly).
 */
export interface ColorOp {
  m: number[]; // 3×3 row-major
  k: number[]; // 36 = 3 channels × 12 knot outputs
}

/** Piecewise-linear per-channel curve with explicit knots. */
export interface Curve3 {
  x: [number[], number[], number[]];
  y: [number[], number[], number[]];
}

export type ChainItem = { curve: Curve3 } | { mat: number[] };

export const KNOTS = 12;
export const KX: number[] = Array.from({ length: KNOTS }, (_, i) => Math.pow(i / (KNOTS - 1), 2.2));
const IDENT_M = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Tone operators' matrices are identity up to the generated file's stored
 *  precision; treating them as matrices would spend shader matrix slots
 *  (MAX_MATS) on no-ops and truncate long relative chains. */
export function isIdentityMat(m: number[]): boolean {
  return m.every((v, i) => Math.abs(v - IDENT_M[i]) < 1e-3);
}

function lerpOp(a: ColorOp, b: ColorOp, t: number): ColorOp {
  return {
    m: a.m.map((v, i) => v + (b.m[i] - v) * t),
    k: a.k.map((v, i) => v + (b.k[i] - v) * t),
  };
}

const IDENTITY: ColorOp = { m: IDENT_M, k: [...KX, ...KX, ...KX] };

/** Operator for a slider at a fractional step between measured levels. */
function steppedOp(family: string, step: number, levels: number[]): ColorOp | null {
  if (!step) return null;
  const s = Math.abs(step);
  const sign = step > 0 ? '' : '-';
  let lo = 0, loOp = IDENTITY;
  for (const L of levels) {
    const op = OPS[`${family}:${sign}${L}`];
    if (!op) return null;
    if (s <= L) return lerpOp(loOp, op, (s - lo) / (L - lo));
    lo = L; loOp = op;
  }
  return loOp; // beyond the last measured level: hold
}

function wbSideOp(axis: 'ab' | 'gm', step: number): ColorOp | null {
  if (!step) return null;
  const side = axis === 'ab' ? (step > 0 ? 'A' : 'B') : step > 0 ? 'M' : 'G';
  const s = Math.abs(step);
  const op7 = OPS[`wb:${side}7`], op14 = OPS[`wb:${side}14`];
  if (!op7 || !op14) return null;
  return s <= 7 ? lerpOp(IDENTITY, op7, s / 7) : lerpOp(op7, op14, (s - 7) / 7);
}

export interface NamedOp { key: string; op: ColorOp }

/**
 * The measured operators a recipe applies, in the camera's order, validated
 * on pair developments (calibration/ops/validation.json): white balance
 * (mode, then shift) acts BEFORE the base look — NF+M14 composes at 3.1
 * that way and 4.7 the other — the Saturation slider right after the base
 * look (NF+S4: 2.4 vs 8.1, scripts/fit-sat-ops.py), and the tone sliders
 * come last. Saturation has a fitted operator for every step. Keys
 * identify equal operators so a relative chain can cancel them exactly.
 */
export function recipeOps(p: RecipeParams): NamedOp[] {
  const out: NamedOp[] = [];
  const push = (key: string, op: ColorOp | null) => { if (op) out.push({ key, op }); };
  push(`mode:${p.wbMode}`, OPS[`mode:${p.wbMode}`] ?? null);
  push(`wb:gm:${p.wbShiftGM}`, wbSideOp('gm', p.wbShiftGM));
  push(`wb:ab:${p.wbShiftAB}`, wbSideOp('ab', p.wbShiftAB));
  push(`base:${p.control}`, OPS[`base:${p.control}`] ?? null);
  if (!getControl(p.control).base.mono) push(`sat:${p.saturation}`, OPS[`sat:${p.saturation}`] ?? null);
  push(`key:${p.highLowKey}`, steppedOp('key', p.highLowKey, [2, 4]));
  push(`contrast:${p.contrast}`, steppedOp('contrast', p.contrast, [2, 4]));
  push(`chi:${p.contrastHighlight}`, steppedOp('chi', p.contrastHighlight, [2, 4]));
  push(`csh:${p.contrastShadow}`, steppedOp('csh', p.contrastShadow, [2, 4]));
  return out;
}

function forwardItems(op: ColorOp): ChainItem[] {
  const items: ChainItem[] = [];
  if (!isIdentityMat(op.m)) items.push({ mat: op.m });
  items.push({ curve: { x: [KX, KX, KX], y: [op.k.slice(0, 12), op.k.slice(12, 24), op.k.slice(24, 36)] } });
  return items;
}

function strictlyIncreasing(k: number[]): number[] {
  const out = k.slice();
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1e-6;
  return out;
}

function invert3(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const s = 1 / det;
  return [
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ];
}

/** Exact inverse: a piecewise-linear curve inverts by swapping its knot
 *  axes (made strictly increasing first), then M⁻¹. */
function inverseItems(op: ColorOp): ChainItem[] {
  const ys = [op.k.slice(0, 12), op.k.slice(12, 24), op.k.slice(24, 36)].map(strictlyIncreasing) as [number[], number[], number[]];
  const items: ChainItem[] = [{ curve: { x: ys, y: [KX, KX, KX] } }];
  if (!isIdentityMat(op.m)) items.push({ mat: invert3(op.m) });
  return items;
}

/** Evaluate the piecewise-linear function with knots (xs, ys) at v. */
export function evalPwl(xs: number[], ys: number[], v: number): number {
  if (v <= xs[0]) return ys[0];
  const n = xs.length;
  if (v >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= v) lo = mid; else hi = mid;
  }
  const t = (v - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + (ys[hi] - ys[lo]) * t;
}

/**
 * Full chain for a render: the inverse of the baseline's operators (last
 * first), then the target's, with operators shared by both cancelled so a
 * same-look edit touches only what changed.
 */
export function buildChain(target: RecipeParams, baseline?: RecipeParams): ChainItem[] {
  const R = recipeOps(target);
  if (!baseline) return R.flatMap((n) => forwardItems(n.op));
  const B = recipeOps(baseline);
  // cancel from the inside: inv(b1) meets r1 first
  let i = 0;
  while (i < B.length && i < R.length && B[i].key === R[i].key) i++;
  const inv = B.slice(i).reverse().flatMap((n) => inverseItems(n.op));
  const fwd = R.slice(i).flatMap((n) => forwardItems(n.op));
  return [...inv, ...fwd];
}

/** Apply a chain to one linear RGB triple (used for similarity probes and tests). */
export function applyChain(chain: ChainItem[], rgb: [number, number, number]): [number, number, number] {
  let c: [number, number, number] = [rgb[0], rgb[1], rgb[2]];
  for (const it of chain) {
    if ('mat' in it) {
      const m = it.mat;
      c = [m[0] * c[0] + m[1] * c[1] + m[2] * c[2], m[3] * c[0] + m[4] * c[1] + m[5] * c[2], m[6] * c[0] + m[7] * c[1] + m[8] * c[2]];
    } else {
      c = [0, 1, 2].map((ch) => evalPwl(it.curve.x[ch], it.curve.y[ch], Math.min(1, Math.max(0, c[ch])))) as [number, number, number];
    }
  }
  return c;
}

/**
 * Pack a chain for the shader: alternating curve stages and matrices,
 * curves sampled to a 1024-entry table indexed by gamma-encoded input.
 * Stage n's curve is the composition of every curve between matrix n-1
 * and matrix n (exact function composition, no knot resampling).
 */
export const CURVE_SAMPLES = 1024;
/** Matrix slots in the shader. A relative render undoes the photo's own
 *  recipe and applies the target: up to five matrices per side (WB mode,
 *  G/M shift, A/B shift, base look, saturation), so ten, plus headroom. */
export const MAX_MATS = 12;
export interface PackedChain { mats: number[][]; curves: Float32Array[] /* per stage: 3 × 1024 */ }

export function packChain(chain: ChainItem[]): PackedChain {
  const mats: number[][] = [];
  const curves: Float32Array[] = [];
  let pending: Curve3[] = [];
  const flush = () => {
    const tab = new Float32Array(3 * CURVE_SAMPLES);
    for (let j = 0; j < CURVE_SAMPLES; j++) {
      const x = Math.pow(j / (CURVE_SAMPLES - 1), 2.2);
      for (let ch = 0; ch < 3; ch++) {
        let v = x;
        for (const c of pending) v = evalPwl(c.x[ch], c.y[ch], Math.min(1, Math.max(0, v)));
        tab[ch * CURVE_SAMPLES + j] = Math.min(1, Math.max(0, v));
      }
    }
    curves.push(tab);
    pending = [];
  };
  for (const it of chain) {
    if ('mat' in it) { flush(); mats.push(it.mat); } else pending.push(it.curve);
  }
  flush();
  return { mats, curves };
}
