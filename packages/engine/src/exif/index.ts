import exifr from 'exifr';
import { decodeMakerNote, type CoarseHints, type DecodedRecipe } from './decode';
import { extractEmbeddedRecipe } from './embed';
import { clampParams, createDefaultParams, getControl } from '../recipes';

export type { CoarseHints, DecodedRecipe } from './decode';
export { decodeMakerNote } from './decode';

/** Standard EXIF 0xa408-0xa40a: 0 = Normal, 1 = Low/Soft, 2 = High/Hard. */
function coarseLevel(value: unknown): 'low' | 'normal' | 'high' | undefined {
  if (typeof value === 'number') {
    return value === 1 ? 'low' : value === 2 ? 'high' : value === 0 ? 'normal' : undefined;
  }
  if (typeof value === 'string') {
    const v = value.toLowerCase();
    if (v.includes('low') || v.includes('soft')) return 'low';
    if (v.includes('high') || v.includes('hard')) return 'high';
    if (v.includes('normal')) return 'normal';
  }
  return undefined;
}

const RICOH_HEADER = [0x52, 0x49, 0x43, 0x4f, 0x48, 0x00, 0x49, 0x49]; // "RICOH\0II"

function findRicohBlock(bytes: Uint8Array): number {
  outer: for (let i = 0; i <= bytes.length - RICOH_HEADER.length; i++) {
    for (let j = 0; j < RICOH_HEADER.length; j++) {
      if (bytes[i + j] !== RICOH_HEADER[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export type DecodeOutcome =
  | { status: 'decoded'; result: DecodedRecipe }
  /** Readable image, but no Ricoh recipe data (stripped or non-GR camera). */
  | { status: 'no-recipe'; model: string | null }
  /** File could not be read as an image with EXIF at all. */
  | { status: 'unreadable' };

/**
 * Extract a GR recipe from a photo file, entirely in the browser.
 * Never throws for user-supplied files.
 */
export async function decodeRecipeFromFile(file: File | ArrayBuffer): Promise<DecodeOutcome> {
  // GR Recipe Lab exports carry their settings in a small EXIF payload —
  // recognize those first so exported photos round-trip like camera files.
  try {
    const head = new Uint8Array(
      file instanceof ArrayBuffer ? file.slice(0, 131072) : await file.slice(0, 131072).arrayBuffer(),
    );
    const embedded = extractEmbeddedRecipe(head);
    if (embedded) {
      const params = clampParams({ ...createDefaultParams('standard'), ...embedded.params });
      return {
        status: 'decoded',
        result: {
          params,
          model: 'GR Recipe Lab export',
          controlLabel: getControl(params.control).label,
          warnings: [],
          unavailable: [],
          // An export is not a camera file: no coarse tags, HDF flag or
          // decoded extras; the settings above are the whole recipe.
          coarse: {},
          usesContrastHlSh: true,
          hdf: null,
          colorTemperatureK: null,
          extras: [],
        },
      };
    }
  } catch {
    // Fall through to the normal EXIF path.
  }
  let exif: Record<string, unknown> | undefined;
  try {
    exif = await exifr.parse(file, { makerNote: true });
  } catch {
    return { status: 'unreadable' };
  }
  if (!exif) return { status: 'no-recipe', model: null };

  const model = typeof exif.Model === 'string' ? exif.Model : null;
  let makerNote: Uint8Array | null = exif.makerNote instanceof Uint8Array ? exif.makerNote : null;
  if (!makerNote) {
    // DNG: exifr doesn't surface the MakerNote from TIFF containers, but the
    // Pentax block (with the full recipe) is in the file — find it directly.
    try {
      const bytes = new Uint8Array(file instanceof ArrayBuffer ? file : await file.arrayBuffer());
      const idx = findRicohBlock(bytes);
      if (idx === -1) return { status: 'no-recipe', model };
      makerNote = bytes.subarray(idx, Math.min(idx + 65536, bytes.length));
    } catch {
      return { status: 'no-recipe', model };
    }
  }

  const coarse: CoarseHints = {
    contrast: coarseLevel(exif.Contrast),
    saturation: coarseLevel(exif.Saturation),
    sharpness: coarseLevel(exif.Sharpness),
  };
  const result = decodeMakerNote(makerNote, model, coarse);
  if (!result) return { status: 'no-recipe', model };
  return { status: 'decoded', result };
}
