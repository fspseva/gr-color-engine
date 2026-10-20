import type { BaseLook, ImageControlDef, ImageControlId, SliderAvailability } from './types';

/**
 * v1 base looks are hand-tuned generic approximations, labeled as such in
 * the UI. Phase 2 in-camera calibration replaces these numbers (and may add
 * per-control LUTs) without changing any consumer of this module.
 */

const NEUTRAL: BaseLook = {
  mono: false,
  saturation: 1,
  contrast: 0,
  blackLift: 0,
  whitePoint: 1,
  gamma: 1,
  hueRotate: 0,
  shadowTint: [0, 0, 0],
  highlightTint: [0, 0, 0],
  localContrast: 0,
  grainBase: 0,
};

const COLOR_SLIDERS: SliderAvailability = {
  saturation: true,
  hue: true,
  filterEffect: false,
  toning: false,
  grain: false,
};

const MONO_SLIDERS: SliderAvailability = {
  saturation: false,
  hue: false,
  filterEffect: true,
  toning: true,
  grain: true,
};

export const IMAGE_CONTROLS: readonly ImageControlDef[] = [
  {
    id: 'standard',
    label: 'Standard',
    blurb: 'Ricoh’s neutral default. Balanced color and contrast; the baseline every other control deviates from.',
    // No static per-hue trim (Standard IS the reference), but the Hue
    // slider's per-sector nonuniformity is measured (refit 2026-09 on the
    // Hue ±2/±4 sweeps, shader-exact): cyan and blue rotate harder than the
    // global step, so `hs` carries the deviation per slider step.
    base: {
      ...NEUTRAL,
      hueTable: {
        dh: [0, 0, 0, 0, 0, 0],
        ds: [0, 0, 0, 0, 0, 0],
        hs: [0.09001, -0.089001, 0.0965001, 0.2785001, 0.315001, 0.352001],
      },
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'vivid',
    label: 'Vivid',
    blurb: 'Punchier saturation and contrast. Blue skies and azulejos pop; skin tones can run hot.',
    // MEASURED 2026-07-27: chroma ×1.169, hue +1.6°, highlights −4 luma,
    // curve otherwise flat — Vivid is saturation, not contrast.
    // v2.25: tone, colour cast and saturation come from the MEASURED
    // OPERATOR (src/lib/engine/ops.generated.ts, base:vivid); the
    // parametric fields stay neutral and hueTable is the per-hue residual.
    base: {
      ...NEUTRAL,
      baseChroma: 1.17001,
      // Per-hue trims MEASURED 2026-08-24 (R0003655/3677 vs base).
      hueTable: {
        dh: [0, 0, 0, 0, 0, 0],
        ds: [0, 0, 0, 0, 0, 0],
        hs: [0.0995001, -0.091001, -0.1485001, 0.4045001, 0.672001, 0.473001],
      },
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'positive-film',
    label: 'Positive Film',
    blurb: 'Slide-film look: dense blacks, saturated primaries, cool shadows. The GR community favorite for sunny streets.',
    // MEASURED 2026-07-27: chroma ×0.885 (slightly muted, not boosted!),
    // hue −3.7°. Tone curve and per-hue table REFIT 2026-09 (thesis
    // campaign, shader-exact pixel fit vs the Standard base): the curve is a
    // mild midtone lift (gamma <1) with a soft white, not a flat line.
    // v2.25: tone, colour cast and saturation come from the MEASURED
    // OPERATOR (src/lib/engine/ops.generated.ts, base:positive-film); the
    // parametric fields stay neutral and hueTable is the per-hue residual.
    base: {
      ...NEUTRAL,
      baseChroma: 0.885001,
      // Per-hue geometry REFIT 2026-09 (thesis campaign): the slide-film
      // character concentrates in reds and magentas.
      hueTable: {
        dh: [0, 0, 0, 0, 0, 0],
        ds: [0, 0, 0, 0, 0, 0],
        hs: [0.165001, -0.1185001, 0.108001, 0.295001, 0.3115001, 0.3355001],
      },
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'negative-film',
    label: 'Negative Film',
    blurb: 'Soft print-film look: gentle contrast, muted color, slightly lifted blacks and creamy highlights.',
    // MEASURED 2026-07-27 (baseline development vs Standard, pixel-aligned):
    // chroma ×0.732, hue −2.45°, blacks +4 luma. Tone curve and per-hue
    // table REFIT 2026-09 (thesis campaign, shader-exact pixel fit): the
    // highlights are NOT compressed — the earlier white-point reading was a
    // curve-bin artifact; the look is lifted blacks + a slight gamma.
    // v2.25: tone, colour cast and saturation come from the MEASURED
    // OPERATOR (src/lib/engine/ops.generated.ts, base:negative-film); the
    // parametric fields stay neutral and hueTable is the per-hue residual.
    base: {
      ...NEUTRAL,
      baseChroma: 0.73001,
      // Per-hue geometry REFIT 2026-09 (thesis campaign): NF swings greens
      // and magentas by ~40°; the global rotation alone cannot express it.
      hueTable: {
        dh: [0, 0, 0, 0, 0, 0],
        ds: [0, 0, 0, 0, 0, 0],
        hs: [0.159001, -0.1255001, 0.11001, 0.3025001, 0.0915001, 0.1935001],
      },
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'bleach-bypass',
    label: 'Bleach Bypass',
    blurb: 'Silver-retained cinema look: drained color, harsh contrast, a cold metallic cast.',
    // MEASURED 2026-07-27: chroma ×0.897 (only mildly drained!), hue +14.3°,
    // near-flat curve — the metallic look is a strong hue rotation.
    // v2.25: tone, colour cast and saturation come from the MEASURED
    // OPERATOR (src/lib/engine/ops.generated.ts, base:bleach-bypass); the
    // parametric fields stay neutral and hueTable is the per-hue residual.
    base: {
      ...NEUTRAL,
      baseChroma: 0.9001,
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'retro',
    label: 'Retro',
    blurb: 'Faded album print: warm highlights, washed blacks, quiet saturation.',
    // MEASURED 2026-07-27: chroma ×1.047, hue −11.5°, blacks barely lifted —
    // Retro is a hue rotation, not a fade.
    // v2.25: tone, colour cast and saturation come from the MEASURED
    // OPERATOR (src/lib/engine/ops.generated.ts, base:retro); the
    // parametric fields stay neutral and hueTable is the per-hue residual.
    base: {
      ...NEUTRAL,
      baseChroma: 1.05001,
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'hdr-tone',
    label: 'HDR Tone',
    blurb: 'Tone-mapped, gritty, hyper-detailed. Strong local contrast; the most extreme (and least subtle) control.',
    // MEASURED 2026-07-27: level 1 (default) = pure local contrast (+23%
    // fine energy), no color/tone change; level 3 ≈ +58%.
    base: {
      ...NEUTRAL,
      localContrast: 0.25001,
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'cross-processing',
    label: 'Cross Processing',
    blurb: 'Wrong-chemistry look: shifted hues, green-yellow highlights, blue shadows. Unpredictable on purpose.',
    // MEASURED 2026-07-27 (Blue tone, the default): chroma ×1.89,
    // hue +8.4°, strong midtone lift, +32% local contrast.
    // v2.25: tone, colour cast and saturation come from the MEASURED
    // OPERATOR (src/lib/engine/ops.generated.ts, base:cross-processing); the
    // parametric fields stay neutral and hueTable is the per-hue residual.
    // No extra local contrast: on top of the operator it took the real
    // renderer from 3.1 to 13.5 RMS against R0003256 (sweep 2026-10-20,
    // scripts/engine-check.mjs) — the old "+32%" was the operator's own
    // tone and chroma change, not a separate spatial effect.
    base: {
      ...NEUTRAL,
      baseChroma: 1.85001,
    },
    sliders: COLOR_SLIDERS,
  },
  {
    id: 'monotone',
    label: 'Monotone',
    blurb: 'Straight black & white with a neutral tone curve. The mono baseline.',
    base: { ...NEUTRAL, mono: true },
    sliders: MONO_SLIDERS,
  },
  {
    id: 'soft-monotone',
    label: 'Soft Monotone',
    blurb: 'Low-contrast, airy B&W: lifted blacks, bright mids, gentle highlights.',
    // MEASURED 2026-07-27 vs Monotone: blacks +5, highlights −21,
    // baked local-contrast −18% (the built-in clarity −3).
    base: {
      ...NEUTRAL,
      mono: true,
      contrast: -0.08001,
      blackLift: 0.02001,
      whitePoint: 0.93001,
      localContrast: -0.18001,
    },
    sliders: MONO_SLIDERS,
  },
  {
    id: 'hard-monotone',
    label: 'Hard Monotone',
    blurb: 'Deep blacks and strong contrast. Street-photography staple.',
    // MEASURED 2026-07-27: essentially Monotone with slightly compressed
    // highlights — the "hard" look comes from how it's used, not the base.
    base: { ...NEUTRAL, mono: true, contrast: 0.02001, whitePoint: 0.97 },
    sliders: MONO_SLIDERS,
  },
  {
    id: 'hi-contrast-bw',
    label: 'Hi-Contrast B&W',
    blurb: 'Moriyama-style: crushed blacks, blown whites, visible grain baked in.',
    // MEASURED 2026-07-27: blacks crushed to ~3, whites ~248, grain
    // confirmed at 0.35 — the one hand-tuned base that was right.
    base: {
      ...NEUTRAL,
      mono: true,
      contrast: 0.75001,
      grainBase: 0.35001,
    },
    sliders: MONO_SLIDERS,
  },
] as const;

const BY_ID = new Map(IMAGE_CONTROLS.map((c) => [c.id, c]));

export function getControl(id: ImageControlId): ImageControlDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown image control: ${id}`);
  return def;
}

export function isImageControlId(value: string): value is ImageControlId {
  return BY_ID.has(value as ImageControlId);
}
