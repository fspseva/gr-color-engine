/** Image controls available on GR III / IIIx (late firmware). */
export type ImageControlId =
  | 'standard'
  | 'vivid'
  | 'positive-film'
  | 'negative-film'
  | 'bleach-bypass'
  | 'retro'
  | 'hdr-tone'
  | 'cross-processing'
  | 'monotone'
  | 'soft-monotone'
  | 'hard-monotone'
  | 'hi-contrast-bw';

export type FilterEffect =
  | 'off'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'green'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'infrared';

export type HighlightCorrection = 'auto' | 'on' | 'off';
export type ShadowCorrection = 'auto' | 'off' | 'low' | 'medium' | 'high';

export type WhiteBalanceMode =
  | 'auto'
  | 'multi-auto'
  | 'daylight'
  | 'shade'
  | 'cloudy'
  | 'fl-daylight'
  | 'fl-neutral'
  | 'fl-white'
  | 'fl-warm'
  | 'tungsten'
  | 'cta'
  | 'manual'
  | 'kelvin';

/**
 * Full recipe state. Numeric sliders use the camera's own step ranges
 * (±4 for image-control sliders, ±14 for WB fine adjustment).
 * `grain` is 0 (off) to 3 (high), mirroring Off/Low/Medium/High.
 */
export interface RecipeParams {
  control: ImageControlId;
  saturation: number;        // -4..+4 (color controls)
  hue: number;               // -4..+4 (color controls)
  highLowKey: number;        // -4..+4
  contrast: number;          // -4..+4
  contrastHighlight: number; // -4..+4
  contrastShadow: number;    // -4..+4
  sharpness: number;         // -4..+4
  clarity: number;           // -4..+4
  shading: number;           // -4..+4 (vignette; negative darkens corners)
  grain: number;             // 0..3 (monochrome controls)
  /** Mono filter: on/off + RGB mix as the CAMERA displays it, signed
   *  −120..+120 per channel (default R+10 G+70 B−20). The camera's B axis
   *  is display-inverted vs the measured render weight; the engine handles
   *  that. The menu's "filter add 1-4" is only a factory preset picker. */
  filterOn: boolean;
  filterR: number; // -120..120, camera default +10
  filterG: number; // -120..120, camera default +70
  filterB: number; // -120..120, camera default -20
  toning: number;            // -4 (cool) .. +4 (warm), monochrome controls
  /** Named mono toning (camera menu choice) — overrides the numeric slider. */
  namedToning?: 'sepia' | 'red' | 'green' | 'blue' | 'purple';
  wbMode: WhiteBalanceMode;
  wbShiftAB: number;         // -14 (B, cooler) .. +14 (A, warmer)
  wbShiftGM: number;         // -14 (G) .. +14 (M)
  highlightCorrection: HighlightCorrection;
  shadowCorrection: ShadowCorrection;
}

/** Which sliders a given image control exposes. */
export interface SliderAvailability {
  saturation: boolean;
  hue: boolean;
  filterEffect: boolean;
  toning: boolean;
  grain: boolean;
}

/**
 * Generic "base look" of an image control — the v1 approximation the engine
 * renders before slider adjustments. Every value here is a hand-tuned
 * placeholder; Phase 2 calibration replaces these numbers with measured ones.
 */
export interface BaseLook {
  mono: boolean;
  /** Saturation multiplier, 1 = neutral. */
  saturation: number;
  /**
   * Measured chroma of the look vs Standard, for looks whose saturation is
   * rendered by a measured operator (saturation stays 1). Only feeds the
   * Saturation slider's chroma-restoring law.
   */
  baseChroma?: number;
  /** Extra S-curve strength, 0 = neutral, positive = punchier. */
  contrast: number;
  /** Lifted (faded) blacks, 0..~0.15. */
  blackLift: number;
  /** Highlight ceiling, 1 = full white; <1 = softened highlights. */
  whitePoint: number;
  /** Midtone gamma, 1 = neutral; <1 brightens mids. */
  gamma: number;
  /** Global hue rotation in degrees. */
  hueRotate: number;
  /** Additive tint applied in shadows (linear RGB, small values). */
  shadowTint: [number, number, number];
  /** Additive tint applied in highlights (linear RGB, small values). */
  highlightTint: [number, number, number];
  /** Local-contrast boost (HDR Tone), 0 = none. */
  localContrast: number;
  /** Baked-in grain amount, 0..1 (Hi-Contrast B&W has some). */
  grainBase: number;
  /**
   * Per-hue color geometry, measured against camera developments: six hue
   * sectors (red, yellow, green, cyan, blue, magenta — centers 0/52/120/
   * 185/230/295°) with a hue correction in degrees and a RELATIVE
   * saturation change (HSL S is multiplied by 1 + ds), applied in display
   * space after the global operators. `hs` is the Hue slider's per-sector deviation from the global
   * rotation, in degrees per slider step — the camera's Hue control is not a
   * uniform rotation and each look bends sectors differently. Absent =
   * geometry fully captured by the global model.
   */
  hueTable?: {
    dh: [number, number, number, number, number, number];
    ds: [number, number, number, number, number, number];
    hs?: [number, number, number, number, number, number];
  };
}

export interface ImageControlDef {
  id: ImageControlId;
  label: string;
  /** Short plain-language description shown in the UI. */
  blurb: string;
  base: BaseLook;
  sliders: SliderAvailability;
}

/** A recipe as published in the gallery. */
export interface Recipe {
  slug: string;
  name: string;
  description: string;
  params: RecipeParams;
  /** Placeholder image path until real Lisbon shots exist. */
  image: string;
}
