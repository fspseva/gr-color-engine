import type { RecipeParams } from '../recipes/types';
import { getControl } from '../recipes/controls';

/** Everything needed to draw a recipe card, resolved to plain strings. */
export interface CardData {
  title: string;
  controlId: string;
  rows: [string, string][];
  footer: string;
  /** Shown as "Recipe by …" under the name. */
  credit?: string;
}

export interface CardMeta {
  /** Recipe name (gallery) — falls back to the control label. */
  name?: string;
  /** Recipe author: name or @handle. */
  credit?: string;
  model?: string | null;
  hdf?: boolean | null;
  colorTemperatureK?: number | null;
  /** Decoded per-control extras (toning choices, filter mix, …). */
  extras?: { label: string; value: string }[];
}

const step = (v: number) => (v > 0 ? `+${v}` : `${v}`);

/** Camera-style WB shift notation: "A14 G2", "B5 M4", "0". */
export function formatWbShift(ab: number, gm: number): string {
  const parts: string[] = [];
  if (ab !== 0) parts.push(ab > 0 ? `A${ab}` : `B${-ab}`);
  if (gm !== 0) parts.push(gm > 0 ? `M${gm}` : `G${-gm}`);
  return parts.join(' ') || '0';
}

const WB_LABELS: Record<string, string> = {
  auto: 'Auto WB',
  'multi-auto': 'Multi-Pattern Auto',
  daylight: 'Daylight',
  shade: 'Shade',
  cloudy: 'Cloudy',
  'fl-daylight': 'Fluor. Daylight',
  'fl-neutral': 'Fluor. Neutral White',
  'fl-white': 'Fluor. Cool White',
  'fl-warm': 'Fluor. Warm White',
  tungsten: 'Tungsten',
  cta: 'CTE',
  manual: 'Manual',
  kelvin: 'Kelvin',
};

export function buildCardData(params: RecipeParams, meta: CardMeta = {}): CardData {
  const control = getControl(params.control);
  // Row order follows the community recipe-publishing standard
  // (ricohrecipes.com): control, sliders, mono extras, corrections, WB last.
  const rows: [string, string][] = [];
  rows.push(['Image Control', control.label]);
  if (control.sliders.saturation) {
    rows.push(['Saturation', step(params.saturation)]);
    rows.push(['Hue', step(params.hue)]);
  }
  rows.push(['High/Low Key', step(params.highLowKey)]);
  rows.push(['Contrast', step(params.contrast)]);
  rows.push(['Contrast (Highlight)', step(params.contrastHighlight)]);
  rows.push(['Contrast (Shadow)', step(params.contrastShadow)]);
  rows.push(['Sharpness', step(params.sharpness)]);
  if (params.control !== 'hdr-tone') rows.push(['Shading', step(params.shading)]);
  if (params.control !== 'soft-monotone') rows.push(['Clarity', step(params.clarity)]);

  const extraLabels = new Set((meta.extras ?? []).map((e) => e.label));
  if (control.sliders.grain && !extraLabels.has('Grain Effect')) {
    rows.push(['Grain Effect', ['Off', 'Low', 'Medium', 'High'][params.grain] ?? 'Off']);
  }
  // Mono toning: the camera's named choice (Off/Sepia/Red/Green/Blue/
  // Purple). Decoded-file extras take precedence; legacy numeric values
  // (old EXIF tag) fall back to their step display.
  if (control.sliders.toning && !extraLabels.has('Toning')) {
    const named = params.namedToning;
    rows.push([
      'Toning',
      named ? named[0].toUpperCase() + named.slice(1) : params.toning !== 0 ? step(params.toning) : 'Off',
    ]);
  }
  for (const e of meta.extras ?? []) rows.push([e.label, e.value]);
  if (control.sliders.filterEffect && !extraLabels.has('Filter Effect') && params.filterOn) {
    const f = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v)}`;
    rows.push(['Filter Effect', `R${f(params.filterR)}% G${f(params.filterG)}% B${f(params.filterB)}%`]);
  }

  rows.push([
    'Highlight Correction',
    params.highlightCorrection === 'off' ? 'Off' : params.highlightCorrection === 'on' ? 'On' : 'Auto',
  ]);
  rows.push([
    'Shadow Correction',
    params.shadowCorrection.charAt(0).toUpperCase() + params.shadowCorrection.slice(1),
  ]);

  let wb = WB_LABELS[params.wbMode] ?? params.wbMode;
  if (params.wbMode === 'kelvin' && meta.colorTemperatureK) {
    wb = `${meta.colorTemperatureK}K`;
  }
  rows.push(['White Balance', wb]);
  rows.push(['WB Shift', formatWbShift(params.wbShiftAB, params.wbShiftGM)]);

  return {
    title: meta.name ?? 'Custom Recipe',
    controlId: params.control,
    rows,
    footer: 'GR RECIPE LAB',
    credit: meta.credit?.trim() || undefined,
  };
}
