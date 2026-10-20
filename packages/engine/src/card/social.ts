import type { RecipeParams } from '../recipes/types';
import type { CardMeta } from './format';
import { orderedRows } from './shareText';

/**
 * Before/after images sized for social posts. The photo is split down the
 * middle (left: as shot, right: the recipe), the settings sit under it in
 * camera order, and the footer carries the site CTA.
 *
 *   post   1080×1350  4:5   Instagram feed, Reddit, Facebook
 *   story  1080×1920  9:16  Instagram/Facebook stories — content kept inside
 *                           a 250px safe band top and bottom (UI overlays)
 *   x      1600×900   16:9  X timeline (shown uncropped at this ratio)
 */
export type SocialFormat = 'post' | 'story' | 'x';

export const SOCIAL_SIZES: Record<SocialFormat, { w: number; h: number; safe: number }> = {
  post: { w: 1080, h: 1350, safe: 0 },
  story: { w: 1080, h: 1920, safe: 250 },
  x: { w: 1600, h: 900, safe: 0 },
};

const SANS = '-apple-system, "Helvetica Neue", Arial, sans-serif';
const BG = '#0d0e10';
const SITE_URL = 'callmeseva.cc/recipelab';

// Shorter labels so two columns fit; values stay exactly as on the card.
const LABEL: Record<string, string> = {
  'Contrast (Highlight)': 'Highlight Contrast',
  'Contrast (Shadow)': 'Shadow Contrast',
  'Highlight Correction': 'Highlight Corr.',
  'Shadow Correction': 'Shadow Corr.',
};

export interface SocialInput {
  params: RecipeParams;
  meta?: CardMeta;
  name: string;
  credit?: string;
  before: CanvasImageSource;
  after: CanvasImageSource;
}

function size(src: CanvasImageSource): { w: number; h: number } {
  if (src instanceof HTMLImageElement) return { w: src.naturalWidth, h: src.naturalHeight };
  const s = src as { width: number; height: number };
  return { w: Number(s.width), h: Number(s.height) };
}

/** Center-crop `src` to the box's aspect and draw it there. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  x: number,
  y: number,
  w: number,
  h: number,
  // Portion of the box (0..1 horizontally) this source fills — the split.
  from = 0,
  to = 1,
) {
  const { w: sw, h: sh } = size(src);
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  const cx = (sw - cw) / 2;
  const cy = (sh - ch) / 2;
  ctx.drawImage(src, cx + cw * from, cy, cw * (to - from), ch, x + w * from, y, w * (to - from), h);
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, alignRight = false) {
  ctx.font = `700 ${size}px ${SANS}`;
  const tw = ctx.measureText(text).width;
  const padX = size * 0.6;
  const h = size * 1.7;
  const bx = alignRight ? x - tw - 2 * padX : x;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
  ctx.beginPath();
  ctx.roundRect(bx, y - h, tw + 2 * padX, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.fillText(text, bx + padX, y - h * 0.32);
}

function splitPhoto(ctx: CanvasRenderingContext2D, inp: SocialInput, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 22);
  ctx.clip();
  drawCover(ctx, inp.before, x, y, w, h, 0, 0.5);
  drawCover(ctx, inp.after, x, y, w, h, 0.5, 1);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x + w / 2 - 1.5, y, 3, h);
  const s = Math.round(Math.max(18, w / 46));
  pill(ctx, 'BEFORE', x + s, y + h - s, s);
  pill(ctx, 'AFTER', x + w - s, y + h - s, s, true);
  ctx.restore();
}

function title(ctx: CanvasRenderingContext2D, inp: SocialInput, x: number, y: number, maxW: number, size: number, align: CanvasTextAlign) {
  ctx.textAlign = align;
  ctx.fillStyle = '#fff';
  ctx.font = `750 ${size}px ${SANS}`;
  ctx.fillText(inp.name, x, y, maxW);
  let bottom = y;
  if (inp.credit) {
    ctx.fillStyle = '#9e9e9e';
    ctx.font = `400 ${Math.round(size * 0.5)}px ${SANS}`;
    bottom = y + Math.round(size * 0.85);
    ctx.fillText(`Recipe by ${inp.credit}`, x, bottom, maxW);
  }
  ctx.textAlign = 'left';
  return bottom;
}

function rows(
  ctx: CanvasRenderingContext2D,
  list: [string, string][],
  x: number,
  y: number,
  w: number,
  cols: number,
  rowH: number,
  font: number,
) {
  const per = Math.ceil(list.length / cols);
  const gap = 36;
  const colW = (w - gap * (cols - 1)) / cols;
  list.forEach(([label, value], i) => {
    const c = Math.floor(i / per);
    const r = i % per;
    const cx = x + c * (colW + gap);
    const top = y + r * rowH;
    const base = top + rowH / 2 + font * 0.36;
    ctx.fillStyle = '#9e9e9e';
    ctx.font = `400 ${font}px ${SANS}`;
    ctx.fillText(LABEL[label] ?? label, cx, base, colW * 0.62);
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${font}px ${SANS}`;
    const vw = Math.min(ctx.measureText(value).width, colW * 0.4);
    ctx.fillText(value, cx + colW - vw, base, colW * 0.4);
    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, top + rowH);
    ctx.lineTo(cx + colW, top + rowH);
    ctx.stroke();
  });
  return y + per * rowH;
}

function footer(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, align: CanvasTextAlign) {
  const a = 'Try and build recipes at ';
  ctx.font = `400 ${size}px ${SANS}`;
  const aw = ctx.measureText(a).width;
  ctx.font = `700 ${size}px ${SANS}`;
  const bw = ctx.measureText(SITE_URL).width;
  let fx = align === 'center' ? x - (aw + bw) / 2 : x;
  ctx.fillStyle = '#6b6a65';
  ctx.font = `400 ${size}px ${SANS}`;
  ctx.fillText(a, fx, y);
  fx += aw;
  ctx.fillStyle = '#d8d6d0';
  ctx.font = `700 ${size}px ${SANS}`;
  ctx.fillText(SITE_URL, fx, y);
}

export function drawSocial(format: SocialFormat, inp: SocialInput): HTMLCanvasElement {
  const { w: W, h: H, safe } = SOCIAL_SIZES[format];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  const list = orderedRows(inp.params, inp.meta ?? {});

  if (format === 'x') {
    const M = 40;
    const photoW = 1000;
    splitPhoto(ctx, inp, M, M, photoW, H - 2 * M);
    const rx = M + photoW + 44;
    const rw = W - rx - M;
    const tb = title(ctx, inp, rx, M + 52, rw, 44, 'left');
    const footY = H - M - 6;
    const rowH = Math.min(40, Math.floor((footY - 36 - (tb + 28)) / list.length));
    rows(ctx, list, rx, tb + 28, rw, 1, rowH, Math.min(22, Math.round(rowH * 0.56)));
    footer(ctx, rx, footY, 20, 'left');
    return canvas;
  }

  const M = 48;
  const top = safe + M;
  const bottom = H - safe - M;
  const tb = title(ctx, inp, W / 2, top + 58, W - 2 * M, 62, 'center');
  const footY = bottom;
  const cols = 2;
  const rowH = format === 'story' ? 52 : 44;
  const font = format === 'story' ? 25 : 23;
  const rowsH = Math.ceil(list.length / cols) * rowH;
  const photoY = tb + 36;
  const photoH = Math.min(Math.round((W - 2 * M) / 1.5), footY - 50 - rowsH - 28 - photoY);
  splitPhoto(ctx, inp, M, photoY, W - 2 * M, photoH);
  rows(ctx, list, M, photoY + photoH + 28, W - 2 * M, cols, rowH, font);
  footer(ctx, W / 2, footY, 24, 'center');
  return canvas;
}

/** Save the image: the share sheet on touch devices that can take files
 *  (straight into Instagram, Reddit, …), a plain download elsewhere. */
export async function deliverImage(canvas: HTMLCanvasElement, filename: string, title: string): Promise<void> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) return;
  const file = new File([blob], filename, { type: 'image/jpeg' });
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      // Share refused (no user activation left) — fall through to download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
