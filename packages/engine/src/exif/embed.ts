import type { RecipeParams } from '../recipes/types';

/** Marker prefixing the JSON payload inside the EXIF ImageDescription. */
const MARKER = 'GRRL1:';

/**
 * Build a minimal EXIF APP1 segment (ImageDescription + Software) carrying
 * the recipe as JSON, and splice it into a JPEG right after SOI. Exported
 * photos become self-describing: re-uploading one decodes its recipe, the
 * same way an original camera file does.
 */
export function embedRecipeInJpeg(jpeg: ArrayBuffer, params: RecipeParams, title: string): Blob {
  const payload = MARKER + JSON.stringify({ v: 1, title, params }) + '\0';
  const desc = new TextEncoder().encode(payload);
  const software = new TextEncoder().encode('GR Recipe Lab\0');

  // TIFF container (little endian), IFD0 with two ASCII entries.
  const entries = 2;
  const ifdSize = 2 + entries * 12 + 4;
  const dataOffset = 8 + ifdSize;
  const tiff = new Uint8Array(dataOffset + desc.length + software.length);
  const dv = new DataView(tiff.buffer);
  tiff.set([0x49, 0x49, 0x2a, 0x00]);
  dv.setUint32(4, 8, true); // IFD0 offset
  dv.setUint16(8, entries, true);
  let e = 10;
  dv.setUint16(e, 0x010e, true); // ImageDescription, ASCII
  dv.setUint16(e + 2, 2, true);
  dv.setUint32(e + 4, desc.length, true);
  dv.setUint32(e + 8, dataOffset, true);
  e += 12;
  dv.setUint16(e, 0x0131, true); // Software, ASCII
  dv.setUint16(e + 2, 2, true);
  dv.setUint32(e + 4, software.length, true);
  dv.setUint32(e + 8, dataOffset + desc.length, true);
  e += 12;
  dv.setUint32(e, 0, true); // no next IFD
  tiff.set(desc, dataOffset);
  tiff.set(software, dataOffset + desc.length);

  const exifBody = new Uint8Array(6 + tiff.length);
  exifBody.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  exifBody.set(tiff, 6);
  const app1 = new Uint8Array(4 + exifBody.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  const segLen = exifBody.length + 2;
  app1[2] = (segLen >> 8) & 0xff;
  app1[3] = segLen & 0xff;
  app1.set(exifBody, 4);

  const src = new Uint8Array(jpeg);
  const out = new Uint8Array(src.length + app1.length);
  out.set(src.subarray(0, 2), 0); // SOI
  out.set(app1, 2);
  out.set(src.subarray(2), 2 + app1.length);
  return new Blob([out], { type: 'image/jpeg' });
}

/** Find and parse an embedded recipe payload in a file's leading bytes. */
export function extractEmbeddedRecipe(
  bytes: Uint8Array,
): { v: number; title?: string; params: Partial<RecipeParams> } | null {
  const scan = bytes.subarray(0, Math.min(bytes.length, 131072));
  let text = '';
  for (let i = 0; i < scan.length; i++) text += String.fromCharCode(scan[i]);
  const idx = text.indexOf(MARKER);
  if (idx < 0) return null;
  const end = text.indexOf('\0', idx);
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(idx + MARKER.length, end));
    if (parsed && typeof parsed === 'object' && parsed.params) return parsed;
  } catch {
    // Corrupted payload — treat as absent.
  }
  return null;
}
