import type { HighlightCorrection, RecipeParams, ShadowCorrection, WhiteBalanceMode } from './types';
import { IMAGE_CONTROLS } from './controls';
import { clampParams, createDefaultParams } from './index';

/**
 * Read a recipe pasted as text ("Image Control: Positive Film", "Saturation:
 * +2", "WB Shift: A3 G1", one setting per line, the way recipes are posted
 * on r/ricohGR) back into settings. Unknown lines are reported, not guessed.
 */
export interface ParsedRecipe {
  params: RecipeParams;
  name?: string;
  /** Lines that looked like a setting but couldn't be read. */
  unread: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+\-]/g, '');

const WB: Record<string, WhiteBalanceMode> = {
  autowb: 'auto', auto: 'auto', awb: 'auto',
  multipatternauto: 'multi-auto', multiauto: 'multi-auto',
  daylight: 'daylight', shade: 'shade', cloudy: 'cloudy', overcast: 'cloudy',
  fluordaylight: 'fl-daylight', fluorescentdaylight: 'fl-daylight',
  fluorneutralwhite: 'fl-neutral', fluorescentneutralwhite: 'fl-neutral',
  fluorcoolwhite: 'fl-white', fluorescentcoolwhite: 'fl-white',
  fluorwarmwhite: 'fl-warm', fluorescentwarmwhite: 'fl-warm',
  tungsten: 'tungsten', incandescent: 'tungsten', cte: 'cta', manual: 'manual', kelvin: 'kelvin',
};

const NUMERIC: Record<string, keyof RecipeParams> = {
  saturation: 'saturation', sat: 'saturation',
  hue: 'hue',
  highlowkey: 'highLowKey', key: 'highLowKey',
  contrast: 'contrast',
  contrasthighlight: 'contrastHighlight', highlightcontrast: 'contrastHighlight',
  contrastshadow: 'contrastShadow', shadowcontrast: 'contrastShadow',
  sharpness: 'sharpness', clarity: 'clarity', shading: 'shading',
  toning: 'toning',
};

const step = (v: string): number | null => {
  const m = /^\s*([+\-−]?\s*\d+)/.exec(v);
  return m ? Number(m[1].replace('−', '-').replace(/\s/g, '')) : null;
};

/** "A14 G2", "B5 M4", "0", "A3" → [ab, gm]. */
export function parseWbShift(v: string): [number, number] | null {
  const t = v.toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^0$|^NONE$|^OFF$/.test(t)) return [0, 0];
  let ab = 0, gm = 0, hit = false;
  for (const m of t.matchAll(/([ABGM])\s*:?\s*(\d+)/g)) {
    const n = Number(m[2]);
    hit = true;
    if (m[1] === 'A') ab = n;
    else if (m[1] === 'B') ab = -n;
    else if (m[1] === 'M') gm = n;
    else gm = -n;
  }
  return hit ? [ab, gm] : null;
}

export function parseRecipeText(text: string): ParsedRecipe {
  let control = IMAGE_CONTROLS[0].id;
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\*\*/g, '').trim()).filter(Boolean);
  const pairs: [string, string][] = [];
  let name: string | undefined;
  for (const l of lines) {
    const m = /^([^:]{2,40}):\s*(.+)$/.exec(l);
    if (m && !/^https?$/i.test(m[1].trim())) pairs.push([m[1].trim(), m[2].trim()]);
    else if (!name && !/^https?:\/\//.test(l)) name = l.replace(/,\s*recipe by .*/i, '').trim();
  }
  for (const [k, v] of pairs) {
    if (norm(k) === 'imagecontrol' || norm(k) === 'filmsimulation') {
      const c = IMAGE_CONTROLS.find((c) => norm(c.label) === norm(v) || c.id === v.toLowerCase());
      if (c) control = c.id;
    }
  }
  const p = createDefaultParams(control);
  const unread: string[] = [];
  for (const [k, v] of pairs) {
    const key = norm(k.replace(/\(([^)]+)\)/, '$1'));
    if (key === 'imagecontrol' || key === 'filmsimulation') continue;
    if (NUMERIC[key]) {
      const n = step(v);
      if (n === null && key === 'toning' && /sepia|red|green|blue|purple/i.test(v)) {
        p.namedToning = v.toLowerCase().match(/sepia|red|green|blue|purple/)![0] as RecipeParams['namedToning'];
      } else if (n === null) {
        if (!(key === 'toning' && /off/i.test(v))) unread.push(`${k}: ${v}`);
      } else (p[NUMERIC[key]] as number) = n;
    } else if (key === 'graineffect' || key === 'grain') {
      const g = ['off', 'low', 'medium', 'high'].indexOf(v.toLowerCase().trim());
      if (g >= 0) p.grain = g;
      else unread.push(`${k}: ${v}`);
    } else if (key === 'whitebalance' || key === 'wb') {
      // "Daylight, A3 G1" style: mode, optionally followed by the shift.
      const [mode, ...rest] = v.split(/[,;]/);
      const w = WB[norm(mode)] ?? (/^\d{4,5}\s*k$/i.test(mode.trim()) ? 'kelvin' : undefined);
      if (w) p.wbMode = w;
      else unread.push(`${k}: ${v}`);
      const shift = rest.length ? parseWbShift(rest.join(' ')) : null;
      if (shift) [p.wbShiftAB, p.wbShiftGM] = shift;
    } else if (key === 'wbshift' || key === 'whitebalanceshift' || key === 'shift') {
      const s = parseWbShift(v);
      if (s) [p.wbShiftAB, p.wbShiftGM] = s;
      else unread.push(`${k}: ${v}`);
    } else if (key === 'highlightcorrection' || key === 'highlightcorr') {
      const c = v.toLowerCase().trim() as HighlightCorrection;
      if (['auto', 'on', 'off'].includes(c)) p.highlightCorrection = c;
      else unread.push(`${k}: ${v}`);
    } else if (key === 'shadowcorrection' || key === 'shadowcorr') {
      const c = v.toLowerCase().trim() as ShadowCorrection;
      if (['auto', 'off', 'low', 'medium', 'high'].includes(c)) p.shadowCorrection = c;
      else unread.push(`${k}: ${v}`);
    } else if (key === 'filtereffect') {
      const m = /R\s*([+\-−]?\d+)%?\s*G\s*([+\-−]?\d+)%?\s*B\s*([+\-−]?\d+)/i.exec(v);
      if (m) {
        p.filterOn = true;
        [p.filterR, p.filterG, p.filterB] = [m[1], m[2], m[3]].map((x) => Number(x.replace('−', '-')));
      } else if (!/off/i.test(v)) unread.push(`${k}: ${v}`);
    } else if (!/try it|link|iso|exposure|more from/i.test(k)) {
      unread.push(`${k}: ${v}`);
    }
  }
  return { params: clampParams(p), name, unread };
}
