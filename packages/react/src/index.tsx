import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  RecipeRenderer,
  RANGES,
  getControl,
  IMAGE_CONTROLS,
  clampParams,
  type RecipeParams,
} from '@fspseva/gr-color-engine';

export interface RecipePreviewProps {
  /** The photo: an ImageBitmap, an <img>, or a URL. */
  image: ImageBitmap | HTMLImageElement | string;
  params: RecipeParams;
  /** The recipe already baked into the photo (decoded from its file), so it is undone first. */
  baseline?: RecipeParams;
  className?: string;
  style?: CSSProperties;
  /** Called with the canvas after every render (for downloads or cards). */
  onRender?: (canvas: HTMLCanvasElement) => void;
}

/** Live preview of a GR recipe on a photo, rendered with WebGL. */
export function RecipePreview({ image, params, baseline, className, style, onRender }: RecipePreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<{ r: RecipeRenderer; canvas: HTMLCanvasElement } | null>(null);
  const [ready, setReady] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    (async () => {
      try {
        const src =
          typeof image === 'string' ? await createImageBitmap(await (await fetch(image)).blob()) : image;
        const r = new RecipeRenderer(canvas);
        await r.setImage(src as ImageBitmap);
        if (dead) return r.dispose();
        engine.current = { r, canvas };
        host.current?.replaceChildren(canvas);
        setReady((n) => n + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      dead = true;
      engine.current?.r.dispose();
      engine.current = null;
    };
  }, [image]);

  useEffect(() => {
    if (!engine.current) return;
    engine.current.r.render(clampParams(params), { baseline });
    onRender?.(engine.current.canvas);
  }, [params, baseline, ready, onRender]);

  return (
    <div ref={host} className={className} style={style} data-gr-preview="">
      {error && <p role="alert">Preview unavailable: {error}</p>}
    </div>
  );
}

const LABELS: Partial<Record<keyof typeof RANGES, string>> = {
  saturation: 'Saturation',
  hue: 'Hue',
  highLowKey: 'High/Low Key',
  contrast: 'Contrast',
  contrastHighlight: 'Contrast (Highlight)',
  contrastShadow: 'Contrast (Shadow)',
  sharpness: 'Sharpness',
  clarity: 'Clarity',
  shading: 'Shading',
  grain: 'Grain',
  toning: 'Toning',
  wbShiftAB: 'WB shift A/B',
  wbShiftGM: 'WB shift G/M',
};

export interface RecipeSlidersProps {
  params: RecipeParams;
  onChange: (next: RecipeParams) => void;
  className?: string;
}

/** Unstyled camera controls: the Image Control picker and the sliders it exposes. */
export function RecipeSliders({ params, onChange, className }: RecipeSlidersProps) {
  const control = getControl(params.control);
  const show = (k: keyof typeof RANGES) => {
    const s = control.sliders as unknown as Record<string, boolean | undefined>;
    if (k in s) return !!s[k];
    return true;
  };
  return (
    <div className={className} data-gr-sliders="">
      <label>
        Image Control{' '}
        <select value={params.control} onChange={(e) => onChange({ ...params, control: e.target.value as RecipeParams['control'] })}>
          {IMAGE_CONTROLS.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      {(Object.keys(LABELS) as (keyof typeof RANGES)[]).filter(show).map((k) => (
        <label key={k}>
          {LABELS[k]} <output>{params[k] > 0 ? `+${params[k]}` : params[k]}</output>
          <input
            type="range"
            min={RANGES[k].min}
            max={RANGES[k].max}
            step={1}
            value={params[k]}
            onChange={(e) => onChange({ ...params, [k]: Number(e.target.value) })}
          />
        </label>
      ))}
    </div>
  );
}
