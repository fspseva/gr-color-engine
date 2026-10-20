import { describe, expect, it } from 'vitest';
import { clampParams, createDefaultParams, IMAGE_CONTROLS } from './index';
import { decodeRecipeHash, encodeRecipeHash } from './link';
import { parseRecipeText, parseWbShift } from './parse';
import { redditText } from '../card/shareText';
import type { RecipeParams } from './types';

const samples = (): RecipeParams[] =>
  IMAGE_CONTROLS.map((c, i) => ({
    ...createDefaultParams(c.id),
    saturation: c.sliders.saturation ? (i % 9) - 4 : 0,
    hue: c.sliders.saturation ? ((i * 3) % 9) - 4 : 0,
    highLowKey: (i % 5) - 2,
    contrast: ((i * 2) % 9) - 4,
    contrastHighlight: 1,
    contrastShadow: -2,
    sharpness: 1,
    clarity: c.id === 'soft-monotone' ? 0 : -1,
    shading: c.id === 'hdr-tone' ? 0 : -2,
    grain: c.sliders.grain ? 2 : 0,
    wbMode: (['daylight', 'shade', 'auto', 'tungsten'] as const)[i % 4],
    wbShiftAB: (i % 2 ? 1 : -1) * (i + 1),
    wbShiftGM: i % 3 ? -(i % 6) : 3,
    highlightCorrection: 'on',
    shadowCorrection: 'low',
  }));

describe('recipe text and links', () => {
  it('reddit text parses back to the same settings for every Image Control', () => {
    for (const p of samples()) {
      const text = redditText(p, { name: 'Test', credit: '@me', url: 'https://example.com/#r=1' });
      const back = parseRecipeText(text);
      expect(back.unread, p.control).toEqual([]);
      const want = clampParams(p);
      for (const k of ['control', 'saturation', 'hue', 'highLowKey', 'contrast', 'contrastHighlight', 'contrastShadow',
        'sharpness', 'shading', 'wbMode', 'wbShiftAB', 'wbShiftGM', 'highlightCorrection', 'shadowCorrection'] as const) {
        expect(back.params[k], `${p.control} ${k}`).toBe(want[k]);
      }
      expect(back.name).toBe('Test');
    }
  });

  it('links round-trip', () => {
    for (const p of samples()) {
      const back = decodeRecipeHash(encodeRecipeHash({ params: p, name: 'X', credit: '@me' }))!;
      expect(JSON.stringify(back.params)).toBe(JSON.stringify(clampParams(p)));
    }
  });

  it('reads WB shift notation', () => {
    expect(parseWbShift('A14 G2')).toEqual([14, -2]);
    expect(parseWbShift('B5 M4')).toEqual([-5, 4]);
    expect(parseWbShift('0')).toEqual([0, 0]);
  });
});
