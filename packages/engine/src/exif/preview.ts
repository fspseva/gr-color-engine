/** Load a camera file as pixels. JPEGs decode natively; DNGs can't (no
 *  browser codec), but GR DNGs embed full-size JPEG previews — find the
 *  largest one that decodes and use it.
 *
 *  DNGs are TIFF containers, and browsers that open TIFFs natively (Safari)
 *  "succeed" at decoding one — but return only the tiny 720×480 IFD0
 *  thumbnail, not the photo. So TIFF-magic files skip the native attempt
 *  entirely and always go through embedded-preview extraction. */

function isTiffContainer(head: Uint8Array): boolean {
  return (
    head.length >= 4 &&
    ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0x00) ||
      (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0x00 && head[3] === 0x2a))
  );
}

function findJpegSpans(bytes: Uint8Array): Array<{ start: number; length: number }> {
  const spans: Array<{ start: number; length: number }> = [];
  for (let i = 0; i < bytes.length - 2 && spans.length < 8; i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
      for (let j = i + 2; j < bytes.length - 1; j++) {
        if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
          spans.push({ start: i, length: j + 2 - i });
          break;
        }
      }
    }
  }
  return spans;
}

/** Walk the JPEG's segment list to its SOF marker. Lossless JPEG (SOF3 —
 *  how DNGs store raw sensor data) is undecodable in every browser, so
 *  those spans are skipped without wasting a 27MB decode attempt. Returns
 *  false only on a conclusive lossless marker. */
function isLosslessJpeg(bytes: Uint8Array, start: number, length: number): boolean {
  let i = start + 2;
  const end = start + length;
  while (i + 4 < end) {
    if (bytes[i] !== 0xff) return false; // lost sync — let the decoder decide
    const marker = bytes[i + 1];
    if (marker === 0xc3 || marker === 0xc7 || marker === 0xcb) return true;
    if ((marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) || marker === 0xda) {
      return false; // a decodable SOF (or scan start) — not lossless
    }
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return false;
}

/** Read the Orientation tag (0x0112) from a TIFF/DNG's IFD0. The embedded
 *  JPEG previews are bare streams with no EXIF of their own, so a portrait
 *  DNG's rotation lives only here. Returns 1 (normal) when absent. */
function tiffOrientation(bytes: Uint8Array): number {
  try {
    const little = bytes[0] === 0x49;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ifd = view.getUint32(4, little);
    const count = view.getUint16(ifd, little);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (view.getUint16(entry, little) === 0x0112) return view.getUint16(entry + 8, little);
    }
  } catch {
    // Malformed IFD — treat as normal.
  }
  return 1;
}

async function applyOrientation(bitmap: ImageBitmap, orientation: number): Promise<ImageBitmap> {
  if (orientation !== 3 && orientation !== 6 && orientation !== 8) return bitmap;
  const swap = orientation !== 3;
  const c = document.createElement('canvas');
  c.width = swap ? bitmap.height : bitmap.width;
  c.height = swap ? bitmap.width : bitmap.height;
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(((orientation === 6 ? 90 : orientation === 8 ? -90 : 180) * Math.PI) / 180);
  ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  return createImageBitmap(c);
}

export async function loadCameraImage(file: File): Promise<ImageBitmap> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!isTiffContainer(head)) {
    try {
      return await createImageBitmap(file);
    } catch {
      // Not a browser-decodable format — try embedded previews below.
    }
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const orientation = isTiffContainer(bytes) ? tiffOrientation(bytes) : 1;
  const spans = findJpegSpans(bytes)
    .filter((s) => !isLosslessJpeg(bytes, s.start, s.length))
    .sort((a, b) => b.length - a.length);
  for (const s of spans.slice(0, 5)) {
    try {
      const bitmap = await createImageBitmap(
        new Blob([bytes.subarray(s.start, s.start + s.length)], { type: 'image/jpeg' }),
      );
      return await applyOrientation(bitmap, orientation);
    } catch {
      // False SOI/EOI pairing — try the next candidate.
    }
  }
  throw new Error(`"${file.name}" could not be opened as an image.`);
}
