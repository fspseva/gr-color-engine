import type { RecipeParams } from '../recipes/types';
import { buildCardData, type CardMeta } from './format';

// The order recipes are usually posted in on r/ricohGR: Image Control base,
// sliders, grain, mono extras, WB; corrections trail.
const ORDER = [
  'Image Control',
  'Saturation',
  'Hue',
  'High/Low Key',
  'Contrast',
  'Contrast (Highlight)',
  'Contrast (Shadow)',
  'Sharpness',
  'Shading',
  'Clarity',
  'Grain Effect',
  'Toning',
  'Filter Effect',
  'White Balance',
  'WB Shift',
  'Highlight Correction',
  'Shadow Correction',
];

const rank = (label: string) => {
  const i = ORDER.indexOf(label);
  return i < 0 ? ORDER.indexOf('White Balance') - 0.5 : i;
};

export interface ShareInfo {
  name: string;
  credit?: string;
  url: string;
}

export function orderedRows(params: RecipeParams, meta: CardMeta): [string, string][] {
  return [...buildCardData(params, meta).rows].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function heading(info: ShareInfo): string {
  return info.credit ? `${info.name}, recipe by ${info.credit}` : info.name;
}

/** Plain lines for a Reddit comment. Two trailing spaces force a line break
 *  in Reddit's markdown mode and are invisible in the rich editor. */
export function redditText(params: RecipeParams, info: ShareInfo, meta: CardMeta = {}): string {
  const lines = [
    `**${heading(info)}**`,
    '',
    ...orderedRows(params, meta).map(([label, value]) => `${label}: ${value}`),
    '',
    `Try it on your photo: ${info.url}`,
  ];
  return lines.map((l) => (l ? `${l}  ` : l)).join('\n').trimEnd();
}

const SHORT: Record<string, string> = {
  'Image Control': '',
  Saturation: 'Sat',
  'High/Low Key': 'Key',
  'Contrast (Highlight)': 'HL',
  'Contrast (Shadow)': 'SH',
  'Grain Effect': 'Grain',
  'Filter Effect': 'Filter',
  'White Balance': 'WB',
  'WB Shift': 'Shift',
  'Highlight Correction': 'HL corr',
  'Shadow Correction': 'SH corr',
};

/** One-line version that fits a 280-character post (links count as 23). */
export function xText(params: RecipeParams, info: ShareInfo, meta: CardMeta = {}): string {
  const parts = orderedRows(params, meta)
    .filter(([label, value]) => !/Correction/.test(label) || value !== 'Off')
    .map(([label, value]) => {
      const short = SHORT[label] ?? label;
      const v = value.replace(/ WB$/, '');
      return short ? `${short} ${v}` : v;
    });
  const LINK_COST = 23;
  const tail = ' #RicohGR';
  let body = `${heading(info)}: ${parts.join(', ')}`;
  while (body.length + tail.length + 1 + LINK_COST > 280 && parts.length > 1) {
    parts.pop();
    body = `${heading(info)}: ${parts.join(', ')}…`;
  }
  return `${body}${tail} ${info.url}`;
}
