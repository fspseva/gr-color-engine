import type {
  HighlightCorrection,
  ImageControlId,
  RecipeParams,
  ShadowCorrection,
  WhiteBalanceMode,
} from './types';
import { clampParams, createDefaultParams } from './index';

/**
 * Recipe permalinks: everything lives in the URL fragment (#r=…), which
 * browsers never send to a server — no storage, no backend.
 *
 *   #r=1.<22 dot-separated numbers>&n=<name>&by=<credit>&u=<link>&s=<slug>
 *
 * The leading "1" is the format version. The enum tables below are FROZEN
 * for v1: append new values at the end only, never reorder, or old links
 * decode to the wrong settings.
 */
const CONTROLS_V1: ImageControlId[] = [
  'standard',
  'vivid',
  'positive-film',
  'negative-film',
  'bleach-bypass',
  'retro',
  'hdr-tone',
  'cross-processing',
  'monotone',
  'soft-monotone',
  'hard-monotone',
  'hi-contrast-bw',
];
const WB_V1: WhiteBalanceMode[] = [
  'auto',
  'multi-auto',
  'daylight',
  'shade',
  'cloudy',
  'fl-daylight',
  'fl-neutral',
  'fl-white',
  'fl-warm',
  'tungsten',
  'cta',
  'manual',
  'kelvin',
];
const HL_V1: HighlightCorrection[] = ['auto', 'on', 'off'];
const SH_V1: ShadowCorrection[] = ['auto', 'off', 'low', 'medium', 'high'];
const TONING_V1 = ['', 'sepia', 'red', 'green', 'blue', 'purple'] as const;

const NUMERIC_V1 = [
  'saturation',
  'hue',
  'highLowKey',
  'contrast',
  'contrastHighlight',
  'contrastShadow',
  'sharpness',
  'clarity',
  'shading',
  'grain',
  'filterR',
  'filterG',
  'filterB',
  'toning',
  'wbShiftAB',
  'wbShiftGM',
] as const;

export const MAX_NAME = 60;
export const MAX_CREDIT = 40;
export const MAX_URL = 200;

export interface RecipeLink {
  params: RecipeParams;
  /** Recipe name as the maker typed it. */
  name?: string;
  /** Name or @handle. */
  credit?: string;
  /** The maker's page (https only). */
  url?: string;
  /** Library recipe this link points to, when unedited. */
  slug?: string;
}

/** Only plain https links survive — no javascript:, data:, or http. */
export function safeUrl(raw: string | undefined): string | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return undefined;
    return u.href.slice(0, MAX_URL);
  } catch {
    return undefined;
  }
}

const tidy = (s: string | undefined, max: number) => {
  const t = s?.replace(/\s+/g, ' ').trim().slice(0, max);
  return t || undefined;
};

export function encodeRecipeHash(link: RecipeLink): string {
  const p = clampParams(link.params);
  const nums = [
    CONTROLS_V1.indexOf(p.control),
    ...NUMERIC_V1.map((k) => p[k]),
    p.filterOn ? 1 : 0,
    TONING_V1.indexOf(p.namedToning ?? ''),
    WB_V1.indexOf(p.wbMode),
    HL_V1.indexOf(p.highlightCorrection),
    SH_V1.indexOf(p.shadowCorrection),
  ];
  const q = new URLSearchParams();
  q.set('r', `1.${nums.join('.')}`);
  const name = tidy(link.name, MAX_NAME);
  const credit = tidy(link.credit, MAX_CREDIT);
  const url = safeUrl(link.url);
  if (name) q.set('n', name);
  if (credit) q.set('by', credit);
  if (url) q.set('u', url);
  if (link.slug) q.set('s', link.slug);
  // URLSearchParams writes spaces as "+"; %20 survives every chat app.
  return '#' + q.toString().replace(/\+/g, '%20');
}

export function buildRecipeUrl(link: RecipeLink, origin = 'https://callmeseva.cc/recipelab/'): string {
  return origin + encodeRecipeHash(link);
}

/** Parse a #r=… fragment; null when absent or not a valid v1 recipe. */
export function decodeRecipeHash(hash: string): RecipeLink | null {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const r = q.get('r');
  if (!r) return null;
  const parts = r.split('.');
  if (parts[0] !== '1') return null;
  const nums = parts.slice(1).map(Number);
  if (nums.length < 22 || nums.some((n) => !Number.isFinite(n))) return null;
  const control = CONTROLS_V1[nums[0]];
  const wbMode = WB_V1[nums[19]];
  const hl = HL_V1[nums[20]];
  const sh = SH_V1[nums[21]];
  if (!control || !wbMode || !hl || !sh) return null;
  const params = createDefaultParams(control);
  NUMERIC_V1.forEach((k, i) => {
    params[k] = nums[1 + i];
  });
  params.filterOn = nums[17] === 1;
  const toning = TONING_V1[nums[18]];
  if (toning) params.namedToning = toning;
  params.wbMode = wbMode;
  params.highlightCorrection = hl;
  params.shadowCorrection = sh;
  return {
    params: clampParams(params),
    name: tidy(q.get('n') ?? undefined, MAX_NAME),
    credit: tidy(q.get('by') ?? undefined, MAX_CREDIT),
    url: safeUrl(q.get('u') ?? undefined),
    slug: q.get('s')?.match(/^[a-z0-9-]{1,64}$/)?.[0],
  };
}
