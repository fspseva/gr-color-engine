import { describe, expect, it } from 'vitest';
import { createDefaultParams } from '../recipes';
import { buildUniforms } from './uniforms';
import { applyChain } from './ops';

describe('buildUniforms with baseline (baked recipe)', () => {
  it('same params as baseline renders neutral (identity)', () => {
    const b = { ...createDefaultParams('negative-film'), contrast: 2, wbShiftAB: 14 };
    const u = buildUniforms({ ...b }, b);
    expect(u.chain).toEqual([]); // every measured operator cancels exactly
    expect(u.greyGain.map((v) => +v.toFixed(6))).toEqual([1, 1, 1]);
    expect(u.sCurve).toBe(0);
    expect(u.satMul).toBe(1);
    expect(u.hueDeg).toBe(0);
    expect(u.blackLift).toBe(0);
  });

  it('cross-control divides out the baked base look', () => {
    const b = createDefaultParams('negative-film');
    const u = buildUniforms(createDefaultParams('positive-film'), b);
    // Both looks are measured operators: the chain undoes NF then applies PF,
    // so the parametric sat/hue stay neutral and the chain carries the change.
    expect(u.satMul).toBe(1);
    expect(u.hueDeg).toBe(0);
    expect(u.chain.length).toBeGreaterThan(0);
    expect(u.greyGain.some((v) => Math.abs(v - 1) > 0.01)).toBe(true);
  });

  it('color recipe over baked-mono falls back to absolute', () => {
    const b = createDefaultParams('monotone');
    const u = buildUniforms(createDefaultParams('vivid'), b);
    // absolute render: Vivid's operator applied in full, nothing inverted
    expect(u.chain.length).toBe(buildUniforms(createDefaultParams('vivid')).chain.length);
    expect(u.satMul).toBe(1);
  });
});

describe('buildUniforms', () => {
  it('is neutral for Standard at defaults', () => {
    const u = buildUniforms(createDefaultParams('standard'));
    expect(u.chain).toEqual([]);
    expect(u.greyGain).toEqual([1, 1, 1]);
    expect(u.sCurve).toBe(0);
    expect(u.satMul).toBe(1);
    expect(u.grainAmt).toBe(0);
    expect(u.mono).toBe(false);
  });

  it('warms toward A: red multiplier up, blue down', () => {
    const p = createDefaultParams();
    p.wbShiftAB = 14;
    const u = buildUniforms(p);
    expect(u.greyGain[0]).toBeGreaterThan(u.greyGain[2]);
  });

  it('pushes magenta: green multiplier down', () => {
    const p = createDefaultParams();
    p.wbShiftGM = 10;
    const u = buildUniforms(p);
    expect(u.greyGain[1]).toBeLessThan(u.greyGain[0]);
    expect(u.greyGain[1]).toBeLessThan(u.greyGain[2]);
  });

  it('saturation slider is a measured operator: more chroma up, less down', () => {
    // A saturated red probe through the chain; chroma = max − min channel.
    const chroma = (sat: number) => {
      const p = { ...createDefaultParams('standard'), saturation: sat };
      const [r, g, b] = applyChain(buildUniforms(p).chain, [0.5, 0.12, 0.1]);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    expect(buildUniforms(createDefaultParams('standard')).chain).toEqual([]);
    for (const s of [1, 2, 3, 4]) expect(chroma(s)).toBeGreaterThan(chroma(s - 1));
    for (const s of [-1, -2, -3, -4]) expect(chroma(s)).toBeLessThan(chroma(s + 1));
    // Mono looks have no colour to saturate: no operator.
    expect(buildUniforms({ ...createDefaultParams('monotone'), saturation: 4 }).chain).toEqual([]);
  });

  it('mono controls zero saturation and enable filter weights + toning', () => {
    const p = createDefaultParams('monotone');
    p.filterOn = true;
    p.filterR = 70;
    p.filterG = 25;
    p.filterB = 5;
    p.toning = 4;
    const u = buildUniforms(p);
    expect(u.mono).toBe(true);
    expect(u.satMul).toBe(1); // color survives until the weighted conversion
    expect(u.monoWeights[0]).toBeGreaterThan(u.monoWeights[1]); // red filter favors red
    expect(u.toningTint[0]).toBeGreaterThan(0); // warm toning adds red
    expect(u.toningTint[2]).toBeLessThan(0);
  });

  it('color controls never receive toning or grain from sliders', () => {
    const p = createDefaultParams('positive-film');
    p.toning = 4;
    p.grain = 3;
    const u = buildUniforms(p);
    expect(u.toningTint).toEqual([0, 0, 0]);
    expect(u.grainAmt).toBe(0);
  });

  it('hi-contrast B&W has baked-in grain that the slider adds to', () => {
    const p = createDefaultParams('hi-contrast-bw');
    const base = buildUniforms(p).grainAmt;
    expect(base).toBeGreaterThan(0);
    p.grain = 3;
    expect(buildUniforms(p).grainAmt).toBeGreaterThan(base);
  });

  it('contrast trio maps to distinct curve parameters', () => {
    const p = createDefaultParams();
    p.contrast = 4;
    p.contrastHighlight = 2;
    p.contrastShadow = -3;
    const u = buildUniforms(p);
    // Measured tone operators: three curve operators in the chain, no matrix.
    expect(u.chain.length).toBe(3);
    expect(u.chain.every((it) => 'curve' in it)).toBe(true);
    // Contrast +4 spreads the tone probe: darks darker, brights brighter.
    const n = buildUniforms(createDefaultParams()).toneProbe;
    expect(u.toneProbe[1]).toBeLessThan(n[1]);
    expect(u.toneProbe[4]).toBeGreaterThan(n[4]);
  });

  it('shading follows the measured direction: negative darkens corners', () => {
    const p = createDefaultParams();
    p.shading = -4;
    expect(buildUniforms(p).vignetteAmt).toBeGreaterThan(0); // positive amt = darker corners
    p.shading = 4;
    expect(buildUniforms(p).vignetteAmt).toBeLessThan(0);
  });

  it('highlight/shadow correction produce pre-flattening', () => {
    const p = createDefaultParams();
    p.highlightCorrection = 'on';
    p.shadowCorrection = 'high';
    const u = buildUniforms(p);
    expect(u.hlCompress).toBeGreaterThan(0);
    expect(u.shLift).toBeGreaterThan(0);
  });

  it('HDR Tone carries base local contrast; clarity slider adds separately', () => {
    const hdr = buildUniforms(createDefaultParams('hdr-tone'));
    expect(hdr.localContrastAmt).toBeGreaterThan(0);
    const p = createDefaultParams('standard');
    p.clarity = 4;
    const u = buildUniforms(p);
    expect(u.clarityAmt).toBeGreaterThan(0);
    expect(u.localContrastAmt).toBe(0);
  });
});
