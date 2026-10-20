/**
 * Canvas twins of the camera-style parameter icons (ParamIcon.tsx) and
 * control badges, for the recipe-card renderer. Same glyph vocabulary as
 * the app UI; drawn at (x, y) = top-left of a size×size box.
 */

const INK = '#e8e6e1';
const BG = '#101113';

export function drawParamIcon(
  ctx: CanvasRenderingContext2D,
  key: string,
  x: number,
  y: number,
  size: number,
): void {
  const s = size / 24; // glyphs authored in a 24-unit box
  const cx = x + 12 * s;
  const cy = y + 12 * s;
  const r = 8 * s;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = 1.7 * s;

  const circle = (cx2: number, cy2: number, r2: number, fill = false) => {
    ctx.beginPath();
    ctx.arc(cx2, cy2, r2, 0, Math.PI * 2);
    if (fill) ctx.fill();
    else ctx.stroke();
  };
  const halfFill = () => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
  };

  switch (key) {
    case 'saturation':
      circle(x + 12 * s, y + 7.5 * s, 3.1 * s);
      circle(x + 8 * s, y + 15 * s, 3.1 * s);
      circle(x + 16 * s, y + 15 * s, 3.1 * s);
      break;
    case 'hue':
      ctx.lineWidth = 3.4 * s;
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, (i * Math.PI) / 2 + 0.32, (i * Math.PI) / 2 + Math.PI / 2 - 0.32);
        ctx.stroke();
      }
      break;
    case 'highLowKey': {
      const kc = { x: x + 10.5 * s, y: y + 13.5 * s, r: 7 * s };
      circle(kc.x, kc.y, kc.r);
      ctx.beginPath();
      ctx.arc(kc.x, kc.y, kc.r, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      const pc = { x: x + 16.5 * s, y: y + 7.5 * s, r: 4.6 * s };
      ctx.fillStyle = BG;
      circle(pc.x, pc.y, pc.r, true);
      ctx.fillStyle = INK;
      ctx.lineWidth = 1.6 * s;
      circle(pc.x, pc.y, pc.r);
      ctx.beginPath();
      ctx.moveTo(pc.x, pc.y - 2.3 * s);
      ctx.lineTo(pc.x, pc.y + 2.3 * s);
      ctx.moveTo(pc.x - 2.3 * s, pc.y);
      ctx.lineTo(pc.x + 2.3 * s, pc.y);
      ctx.stroke();
      break;
    }
    case 'contrast':
      circle(cx, cy, r);
      halfFill();
      break;
    case 'contrastHighlight':
    case 'contrastShadow': {
      circle(cx, cy, r);
      halfFill();
      // Arrow points straight up (highlight) / straight down (shadow).
      const up = key === 'contrastHighlight';
      const baseY = up ? y + 7.6 * s : y + 16.4 * s;
      const tipY = up ? y + 3.2 * s : y + 20.8 * s;
      ctx.fillStyle = BG;
      ctx.beginPath();
      ctx.moveTo(x + 15.6 * s, baseY);
      ctx.lineTo(x + 20.8 * s, baseY);
      ctx.lineTo(x + 18.2 * s, tipY);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 1.3 * s;
      ctx.stroke();
      ctx.fillStyle = INK;
      break;
    }
    case 'sharpness':
      circle(cx, cy, r);
      ctx.font = `700 ${11.5 * s}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.fillText('S', cx, cy + 4.2 * s);
      ctx.textAlign = 'left';
      break;
    case 'toning': {
      const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
      g.addColorStop(0, INK);
      g.addColorStop(1, BG);
      ctx.fillStyle = g;
      circle(cx, cy, r, true);
      ctx.fillStyle = INK;
      ctx.lineWidth = 1.5 * s;
      circle(cx, cy, r);
      break;
    }
    case 'shading': {
      const g = ctx.createRadialGradient(cx, cy, r * 0.3, cx, cy, r);
      g.addColorStop(0, INK);
      g.addColorStop(1, BG);
      ctx.fillStyle = g;
      circle(cx, cy, r, true);
      ctx.fillStyle = INK;
      ctx.lineWidth = 1.5 * s;
      circle(cx, cy, r);
      break;
    }
    case 'clarity':
      circle(cx, cy, r);
      ctx.lineWidth = 1.5 * s;
      for (const dy of [-2.2 * s, 2.2 * s]) {
        ctx.beginPath();
        ctx.moveTo(cx - 6.4 * s, cy + dy);
        ctx.bezierCurveTo(cx - 3 * s, cy + dy - 3 * s, cx - s, cy + dy + 2 * s, cx + 2.5 * s, cy + dy - 1.2 * s);
        ctx.bezierCurveTo(cx + 4.5 * s, cy + dy - 2.5 * s, cx + 6 * s, cy + dy - 1.6 * s, cx + 6.4 * s, cy + dy - 0.5 * s);
        ctx.stroke();
      }
      break;
    case 'grain':
      circle(cx, cy, r);
      for (const [px, py] of [[9, 8], [13.5, 7], [16, 10], [8, 12], [12, 11.5], [15, 14], [9.5, 16], [13, 16.5], [6.5, 9.5], [16.8, 12.8], [11, 14]]) {
        circle(x + px * s, y + py * s, 0.95 * s, true);
      }
      break;
    case 'filter':
      ctx.lineWidth = 1.6 * s;
      circle(x + 9.5 * s, y + 9.5 * s, 5.4 * s);
      circle(x + 14.5 * s, y + 9.5 * s, 5.4 * s);
      circle(x + 12 * s, y + 14 * s, 5.4 * s);
      break;
  }
  ctx.restore();
}

/** Icon key per card row label. */
export const LABEL_ICON: Record<string, string> = {
  Saturation: 'saturation',
  Hue: 'hue',
  'High/Low Key': 'highLowKey',
  Contrast: 'contrast',
  'Contrast (Highlight)': 'contrastHighlight',
  'Contrast (Shadow)': 'contrastShadow',
  Sharpness: 'sharpness',
  Clarity: 'clarity',
  Shading: 'shading',
  Toning: 'toning',
  'Grain Effect': 'grain',
  'Filter Effect': 'filter',
  'HDR Tone Level': 'contrast',
  'Color Tone': 'toning',
};

const BADGE: Record<string, { text: string[]; film: boolean }> = {
  standard: { text: ['Std'], film: false },
  vivid: { text: ['Vi'], film: false },
  monotone: { text: ['BW'], film: false },
  'soft-monotone': { text: ['Soft', 'BW'], film: false },
  'hard-monotone': { text: ['Hard', 'BW'], film: false },
  'hi-contrast-bw': { text: ['Hi', 'BW'], film: false },
  'negative-film': { text: ['Nega'], film: true },
  'positive-film': { text: ['Posi'], film: true },
  'bleach-bypass': { text: ['BB'], film: true },
  retro: { text: ['Retro'], film: false },
  'hdr-tone': { text: ['HDR'], film: false },
  'cross-processing': { text: ['XP'], film: true },
};

/** Draws the boxed control badge; returns its width. */
export function drawControlBadge(
  ctx: CanvasRenderingContext2D,
  controlId: string,
  x: number,
  y: number,
  h: number,
): number {
  const b = BADGE[controlId];
  if (!b) return 0;
  ctx.save();
  const fontSize = b.text.length > 1 ? h * 0.34 : h * 0.42;
  ctx.font = `700 ${fontSize}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  const wText = Math.max(...b.text.map((t) => ctx.measureText(t).width));
  const pad = h * 0.22;
  const w = Math.max(h * 0.95, wText + pad * 2);

  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  if (b.film) {
    // Film-strip: solid top/bottom rails + sprocket holes down the sides.
    ctx.beginPath();
    ctx.moveTo(x, y + 1.5);
    ctx.lineTo(x + w, y + 1.5);
    ctx.moveTo(x, y + h - 1.5);
    ctx.lineTo(x + w, y + h - 1.5);
    ctx.stroke();
    ctx.fillStyle = INK;
    const holes = 3;
    for (let i = 0; i < holes; i++) {
      const hy = y + h * 0.22 + (i * h * 0.56) / (holes - 1);
      ctx.fillRect(x + 1, hy - 2, 5, 4);
      ctx.fillRect(x + w - 6, hy - 2, 5, 4);
    }
  } else {
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  const lineH = fontSize * 1.02;
  const startY = y + h / 2 - ((b.text.length - 1) * lineH) / 2 + fontSize * 0.36;
  b.text.forEach((t, i) => ctx.fillText(t, x + w / 2, startY + i * lineH));
  ctx.restore();
  return w;
}
