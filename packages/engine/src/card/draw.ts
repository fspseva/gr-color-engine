import type { CardData } from './format';
import { LABEL_ICON, drawControlBadge, drawParamIcon } from './icons';

function sourceSize(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  const s = src as { width: number; height: number };
  return { w: Number(s.width), h: Number(s.height) };
}

/**
 * Trading-card recipe render: framed card, recipe name banner, stat rows
 * (camera icons, plain white values). Plain card is 1000×1400 (2.5:3.5).
 * With a photo, a full-width 1:1 center crop of the rendered look tops the
 * card and the height grows to fit (≈story proportions).
 */
export function drawRecipeCard(data: CardData, photo?: CanvasImageSource): HTMLCanvasElement {
  const W = 1000;
  const FRAME = 26;
  // Full-width landscape (3:2) photo crop inside the frame, regardless of
  // the source orientation. Plain card is 5:7; photo card is exactly 9:16.
  const photoW = photo ? W - 2 * FRAME : 0;
  const photoH = photo ? Math.round(photoW / 1.5) : 0;
  const H = photo ? 1778 : 1400;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  const sans = '-apple-system, "Helvetica Neue", Arial, sans-serif';

  // Backdrop + card frame.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0d0e10';
  ctx.beginPath();
  ctx.roundRect(26, 26, W - 52, H - 52, 30);
  ctx.fill();
  ctx.strokeStyle = '#4a4a4a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#232323';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(40, 40, W - 80, H - 80, 22);
  ctx.stroke();

  const M = 72;

  // Full-width landscape photo (the recipe's rendered look, center-cropped
  // to 3:2 — the GR's native frame).
  if (photo) {
    const { w: sw, h: sh } = sourceSize(photo);
    let cw = sw;
    let ch = sh;
    if (sw / sh >= 1.5) {
      cw = sh * 1.5; // wider than 3:2 — trim the sides
    } else {
      ch = sw / 1.5; // taller (portraits) — take the middle band
    }
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(FRAME, FRAME, photoW, photoH, 30);
    ctx.clip();
    ctx.drawImage(photo, (sw - cw) / 2, (sh - ch) / 2, cw, ch, FRAME, FRAME, photoW, photoH);
    // Fade the photo's lower edge into the card so the title sits naturally.
    const fade = ctx.createLinearGradient(0, FRAME + photoH - 90, 0, FRAME + photoH);
    fade.addColorStop(0, 'rgba(13, 14, 16, 0)');
    fade.addColorStop(1, 'rgba(13, 14, 16, 0.92)');
    ctx.fillStyle = fade;
    ctx.fillRect(FRAME, FRAME + photoH - 90, photoW, 90);
    ctx.restore();
  }

  // Name banner (slightly tighter in photo mode).
  const nameY = photo ? FRAME + photoH + 62 : 168;
  ctx.fillStyle = '#fff';
  ctx.font = `750 ${photo ? 54 : 62}px ${sans}`;
  ctx.textAlign = 'center';
  ctx.fillText(data.title, W / 2, nameY, W - 2 * M);
  // "Recipe by …" under the name; everything below shifts down to fit it.
  const creditH = data.credit ? (photo ? 40 : 46) : 0;
  if (data.credit) {
    ctx.fillStyle = '#9e9e9e';
    ctx.font = `400 ${photo ? 28 : 30}px ${sans}`;
    ctx.fillText(`Recipe by ${data.credit}`, W / 2, nameY + creditH, W - 2 * M);
  }
  ctx.textAlign = 'left';
  ctx.strokeStyle = '#262626';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(M, nameY + (photo ? 24 : 30) + creditH);
  ctx.lineTo(W - M, nameY + (photo ? 24 : 30) + creditH);
  ctx.stroke();

  // Stat rows, band-based: each row is a [top, top+rowH] band whose bottom
  // edge is the separator; text and icons are optically centered in the band.
  let top = nameY + (photo ? 40 : 58) + creditH;
  const footerY = H - (photo ? 56 : 64);
  const rowH = photo
    ? Math.max(36, Math.min(64, Math.floor((footerY - top - 18) / data.rows.length)))
    : Math.min(72, Math.floor((footerY - top - 24) / data.rows.length));
  const font = photo ? Math.min(30, Math.round(rowH * 0.5)) : 30;
  const icon = photo ? font + 3 : 34;
  for (const [label, value] of data.rows) {
    const mid = top + rowH / 2;
    const baseline = mid + font * 0.36;
    let labelX = M;
    if (label === 'Image Control') {
      const bw = drawControlBadge(ctx, data.controlId, M, mid - icon / 2, icon);
      labelX = M + (bw ? bw + 16 : 0);
    } else {
      const iconKey = LABEL_ICON[label];
      if (iconKey) {
        drawParamIcon(ctx, iconKey, M, mid - icon / 2, icon);
        labelX = M + icon + 18;
      }
    }
    ctx.fillStyle = '#9e9e9e';
    ctx.font = `400 ${font}px ${sans}`;
    ctx.fillText(label, labelX, baseline);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${font}px ${sans}`;
    const vw = ctx.measureText(value).width;
    ctx.fillText(value, W - M - vw, baseline);
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(M, top + rowH);
    ctx.lineTo(W - M, top + rowH);
    ctx.stroke();
    top += rowH;
  }

  // Footer CTA, centered as one line:
  // "Try and build recipes at GR RECIPE LAB · callmeseva.cc/recipelab"
  const SITE_URL = 'callmeseva.cc/recipelab';
  const CTA = 'Try and build recipes at';
  let fSize = 24;
  let ctaW = 0;
  let brandW = 0;
  let urlW = 0;
  const gap = 14;
  do {
    ctx.font = `400 ${fSize - 2}px ${sans}`;
    ctaW = ctx.measureText(CTA).width;
    urlW = ctx.measureText(SITE_URL).width;
    ctx.font = `700 ${fSize}px ${sans}`;
    brandW = ctx.measureText(data.footer).width;
    if (ctaW + brandW + urlW + 2 * gap <= W - 2 * M) break;
    fSize -= 1;
  } while (fSize > 16);
  let fx = (W - ctaW - brandW - urlW - 2 * gap) / 2;
  ctx.fillStyle = '#6b6a65';
  ctx.font = `400 ${fSize - 2}px ${sans}`;
  ctx.fillText(CTA, fx, footerY);
  fx += ctaW + gap;
  ctx.fillStyle = '#9e9e9e';
  ctx.font = `700 ${fSize}px ${sans}`;
  ctx.fillText(data.footer, fx, footerY);
  fx += brandW + gap;
  ctx.fillStyle = '#6b6a65';
  ctx.font = `400 ${fSize - 2}px ${sans}`;
  ctx.fillText(SITE_URL, fx, footerY);

  return canvas;
}

export async function downloadRecipeCard(
  data: CardData,
  filename: string,
  photo?: CanvasImageSource,
): Promise<void> {
  const canvas = drawRecipeCard(data, photo);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
