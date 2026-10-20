import { describe, expect, it } from 'vitest';
import { createDefaultParams, IMAGE_CONTROLS } from '../recipes/index';
import type { RecipeParams } from '../recipes/types';
import { buildChain, MAX_MATS, packChain } from './ops';

describe('operator chain fits the shader', () => {
  it('a fully set recipe rendered on a photo shot with another fully set recipe fits MAX_MATS', () => {
    const full = (control: RecipeParams['control'], wb: RecipeParams['wbMode'], s: number): RecipeParams => ({
      ...createDefaultParams(control),
      wbMode: wb,
      wbShiftAB: 9 * s,
      wbShiftGM: -5 * s,
      saturation: 3 * s,
      highLowKey: s,
      contrast: 2 * s,
      contrastHighlight: -s,
      contrastShadow: s,
    });
    for (const a of IMAGE_CONTROLS) {
      for (const b of IMAGE_CONTROLS) {
        const chain = buildChain(full(a.id, 'tungsten', 1), full(b.id, 'shade', -1));
        expect(packChain(chain).mats.length).toBeLessThanOrEqual(MAX_MATS);
      }
    }
  });
});
