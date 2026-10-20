#!/usr/bin/env python3
"""Film-mode thesis analysis.

Reads calibration/thesis/grid.json (from scripts/thesis-grid.mjs), measures
every development against its reference (same control, same WB mode, all
zero) and scores the engine's prediction (a numpy port of the color stages of
src/lib/engine/shaders.ts driven by the dumped uniforms) against the camera.

  python3 scripts/analyze-thesis.py            # full table + model errors
  python3 scripts/analyze-thesis.py --fit      # also solve per-sector residuals

Writes calibration/thesis/analysis.json.
"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GRID = os.path.join(ROOT, 'calibration/thesis/grid.json')
CACHE = os.path.join(ROOT, 'calibration/thesis/.cache')
os.makedirs(CACHE, exist_ok=True)
REDUCE = 4  # 6000x4000 -> 1500x1000, box-filtered

LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)
CENTERS = [0.0, 52.0, 120.0, 185.0, 230.0, 295.0]
SECTOR = ['red', 'yel', 'grn', 'cyn', 'blu', 'mag']


def load(path):
    key = os.path.join(CACHE, os.path.basename(path) + '.npy')
    if os.path.exists(key):
        return np.load(key)
    im = Image.open(os.path.join(ROOT, path)).convert('RGB').reduce(REDUCE)
    a = np.asarray(im, np.uint8)
    np.save(key, a)
    return a


def f32(a):
    return a.astype(np.float32) / 255.0


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def luma(c):
    return c @ LUMA


def rgb2hsl(c):
    mx = c.max(-1); mn = c.min(-1)
    l = (mx + mn) * 0.5
    d = mx - mn
    sdiv = 1.0 - np.abs(2.0 * l - 1.0)
    s = np.where(d < 1e-5, 0.0, d / np.maximum(sdiv, 1e-5))
    r, g, b = c[..., 0], c[..., 1], c[..., 2]
    dd = np.maximum(d, 1e-9)
    h = np.where(mx == r, np.mod((g - b) / dd, 6.0), np.where(mx == g, (b - r) / dd + 2.0, (r - g) / dd + 4.0))
    h = np.where(d < 1e-5, 0.0, h / 6.0)
    h = np.where(h < 0, h + 1.0, h)
    return h, s, l


def hsl2rgb(h, s, l):
    q = np.where(l < 0.5, l * (1 + s), l + s - l * s)
    p = 2 * l - q

    def chan(t):
        t = np.where(t < 0, t + 1, t)
        t = np.where(t > 1, t - 1, t)
        return np.where(t < 1 / 6, p + (q - p) * 6 * t,
               np.where(t < 0.5, q,
               np.where(t < 2 / 3, p + (q - p) * (2 / 3 - t) * 6, p)))
    out = np.stack([chan(h + 1 / 3), chan(h), chan(h - 1 / 3)], -1)
    grey = np.stack([l, l, l], -1)
    return np.where((s < 1e-5)[..., None], grey, out)


def hue_rotate(c, deg):
    rad = np.radians(deg)
    cs, sn = np.cos(rad), np.sin(rad)
    k = np.array([0.57735, 0.57735, 0.57735], np.float32)
    cross = np.cross(k, c)
    return c * cs + cross * sn + k * (c @ k)[..., None] * (1 - cs)


def sector_weights(hd):
    """Circular-interpolation weights the shader uses: (6,) per pixel."""
    W = np.zeros(hd.shape + (6,), np.float32)
    edges = [(0, 52, 0, 1), (52, 120, 1, 2), (120, 185, 2, 3), (185, 230, 3, 4), (230, 295, 4, 5), (295, 360, 5, 0)]
    for lo, hi, a, b in edges:
        m = (hd >= lo) & (hd < hi)
        t = (hd[m] - lo) / (hi - lo)
        W[m, a] += 1 - t
        W[m, b] += t
    return W


def apply_chain(c, chain):
    """Measured operator chain (src/lib/engine/ops.ts): per-channel piecewise-
    linear curves (explicit knots per channel) and 3x3 matrices, linear light."""
    for it in chain:
        if 'mat' in it:
            M = np.array(it['mat'], np.float32).reshape(3, 3)
            c = c @ M.T
        else:
            cv = it['curve']
            c = np.stack([np.interp(np.clip(c[..., ch], 0, 1), np.array(cv['x'][ch]), np.array(cv['y'][ch])) for ch in range(3)], -1).astype(np.float32)
    return c


def render(srgb, u, extra_dh=None, extra_ds=None):
    """Color stages of the shader (no blur/vignette/grain — all zero here).
    Returns final display rgb and the pre-correction HSL used for the
    per-hue lookup (needed to fit sector residuals)."""
    c = np.power(srgb, 2.2) * np.array(u.get('wbMul', [1, 1, 1]), np.float32)
    y0 = luma(c)
    hl = 1 - u['hlCompress'] * smoothstep(0.55, 1.0, y0) * 0.45
    sh = 1 + u['shLift'] * (1 - smoothstep(0.0, 0.45, y0)) * 0.9
    c = c * (hl * sh)[..., None]
    c = apply_chain(c, u.get('chain', []))
    g = np.power(np.maximum(c, 0), 1 / 2.2)
    g = g * (1 + u.get('brightnessMul', 0)) + u.get('brightness', 0)
    k = u['sCurve']
    g = np.clip(g + k * (g - 0.5) * (1 - np.abs(2 * g - 1)), 0, 1)
    y = luma(g)
    hi = smoothstep(0.5, 1.0, y); lo = 1 - smoothstep(0.0, 0.5, y)
    g = g + u.get('sCurveHighlight', 0) * hi[..., None] * (g - 0.5) * 0.8
    g = g + u.get('sCurveShadow', 0) * lo[..., None] * (g - 0.5) * 0.8
    g = g * (u['whitePoint'] - u['blackLift']) + u['blackLift']
    g = np.power(np.clip(g, 0, 1), u['gamma'])
    y2 = luma(g)
    g = g + np.array(u['shadowTint'], np.float32) * (1 - smoothstep(0, 0.6, y2))[..., None]
    g = g + np.array(u['highlightTint'], np.float32) * smoothstep(0.4, 1, y2)[..., None]
    yl = luma(g)
    g = yl[..., None] + (g - yl[..., None]) * u['satMul']
    if abs(u['hueDeg']) > 0.01:
        g = hue_rotate(g, u['hueDeg'])
    h, s, l = rgb2hsl(np.clip(g, 0, 1))
    pre = (h, s, l)
    dh = np.array(u['hueCorDh'], np.float32) + (0 if extra_dh is None else np.array(extra_dh, np.float32))
    ds = np.array(u['hueCorDs'], np.float32) + (0 if extra_ds is None else np.array(extra_ds, np.float32))
    on = np.any(dh != 0) or np.any(ds != 0)
    if on and not u['mono']:
        W = sector_weights(h * 360.0)
        w = smoothstep(0.05, 0.14, s)
        h2 = np.mod(h + (W @ dh) / 360.0 * w + 1.0, 1.0)
        s2 = np.clip(s * (1 + (W @ ds) * w), 0, 1)  # relative, like the shader
        g = hsl2rgb(h2, s2, l)
    return np.clip(g, 0, 1), pre


def wrap_deg(d):
    return (d + 180.0) % 360.0 - 180.0


def measure(base, tgt):
    """Camera target vs camera reference: neutral gains, chroma ratio, global
    hue delta, per-sector dh/ds (display HSL, binned by the reference hue)."""
    hb, sb, lb = rgb2hsl(base)
    ht, st, lt = rgb2hsl(tgt)
    valid = (lb > 0.04) & (lb < 0.96)
    neutral = valid & (sb < 0.06)
    lin_b = np.power(base, 2.2); lin_t = np.power(tgt, 2.2)
    gains = [float(np.median(lin_t[neutral][:, i] / np.maximum(lin_b[neutral][:, i], 1e-4))) for i in range(3)]
    # chroma in linear light = distance from the grey axis
    def chroma(lin):
        y = luma(lin)
        return np.sqrt(((lin - y[..., None]) ** 2).sum(-1))
    colored = valid & (sb > 0.14)
    sat_ratio = float(np.median(chroma(lin_t)[colored] / np.maximum(chroma(lin_b)[colored], 1e-4)))
    dh = wrap_deg((ht - hb) * 360.0)
    hue_global = float(np.median(dh[colored]))
    sec_dh, sec_ds, sec_n = [], [], []
    hd = hb * 360.0
    for k, ctr in enumerate(CENTERS):
        dist = np.abs(wrap_deg(hd - ctr))
        m = colored & (dist < 20)
        sec_n.append(int(m.sum()))
        sec_dh.append(float(np.median(dh[m])) if m.sum() > 200 else None)
        sec_ds.append(float(np.median((st - sb)[m])) if m.sum() > 200 else None)
    # tone curve: mean target luma in 10 reference-luma bins
    yb = luma(base) * 255; yt = luma(tgt) * 255
    curve = []
    for i in range(10):
        m = (yb >= i * 25.6) & (yb < (i + 1) * 25.6)
        curve.append(round(float(yt[m].mean()), 1) if m.any() else None)
    return dict(gains=[round(g, 4) for g in gains], satRatio=round(sat_ratio, 4), hueDeltaDeg=round(hue_global, 2),
                sectorDh=[None if v is None else round(v, 2) for v in sec_dh],
                sectorDs=[None if v is None else round(v, 4) for v in sec_ds], sectorN=sec_n, curve=curve)


def score(cam, model, ref):
    """Model vs camera: hue error on saturated pixels, chroma error, rgb rms."""
    hc, sc, lc = rgb2hsl(cam)
    hm, sm, lm = rgb2hsl(model)
    hr, sr, lr = rgb2hsl(ref)
    valid = (lr > 0.04) & (lr < 0.96)
    sat = valid & (sc > 0.25) & (sm > 0.05)
    dh = np.abs(wrap_deg((hm - hc) * 360.0))
    hue_err = float(dh[sat].mean()) if sat.any() else None
    hue_p90 = float(np.percentile(dh[sat], 90)) if sat.any() else None
    colored = valid & (sr > 0.14)
    s_err = float((sm - sc)[colored].mean())
    rms = float(np.sqrt(((model - cam) ** 2)[valid].mean()) * 255)
    neutral = valid & (sr < 0.06)
    lin_c = np.power(cam, 2.2); lin_m = np.power(model, 2.2)
    gain_err = [float(np.median(lin_m[neutral][:, i] / np.maximum(lin_c[neutral][:, i], 1e-4))) for i in range(3)]
    yr = luma(ref) * 255; dy = (luma(model) - luma(cam)) * 255
    curve_err = [round(float(dy[(yr >= i * 25.6) & (yr < (i + 1) * 25.6)].mean()), 1) for i in range(10)]
    return dict(curveErr=curve_err, hueErrDeg=round(hue_err, 2) if hue_err is not None else None,
                hueErrP90=round(hue_p90, 2) if hue_p90 is not None else None,
                satErr=round(s_err, 4), rgbRms=round(rms, 2), gainErr=[round(g, 4) for g in gain_err])


def fit_residual(cam, model, pre, ref):
    """Per-sector dh/ds deltas that move the model onto the camera, using
    the shader's own interpolation weights on the pre-correction hue.
    Robust (IRLS, ~L1) on saturated pixels only: a plain least-squares over
    every colored pixel is steered by hue noise near neutral and lands
    ~2° off on the saturated colors that matter."""
    h, s, l = pre
    hc, sc, lc = rgb2hsl(cam)
    hm, sm, lm = rgb2hsl(model)
    hr, sr, lr = rgb2hsl(ref)
    w = smoothstep(0.05, 0.14, s) * ((lr > 0.04) & (lr < 0.96)) * (sc > 0.25)
    m = w > 0.5
    W = sector_weights((h * 360.0)[m])
    r_h = wrap_deg(((hc - hm) * 360.0)[m])
    r_s = ((sc - sm))[m]
    keep = np.abs(r_h) < 60
    W = W[keep]; r_h = r_h[keep]; r_s = r_s[keep]
    # ds is relative: S_final = S_pre * (1 + w * W·ds), so a delta dds moves
    # S by S_pre * w * W·dds.
    Ws = W * (s[m][keep] * w[m][keep])[:, None]
    reg = 1e-3 * np.eye(6)

    def irls(W, r, floor):
        x = np.zeros(6)
        for _ in range(6):
            wt = 1.0 / np.maximum(np.abs(r - W @ x), floor)
            Wt = W * wt[:, None]
            x = np.linalg.solve(Wt.T @ W + reg, Wt.T @ r)
        return x
    ddh = irls(W, r_h, 1.0)
    dds = irls(Ws, r_s, 0.01)
    return [round(float(v), 2) for v in ddh], [round(float(v), 4) for v in dds]


def main():
    do_fit = '--fit' in sys.argv
    pts = json.load(open(GRID))['points']
    bases = {(p['control'], p['wbMode']): p for p in pts if p['isBase']}
    std0 = bases[('standard', 'daylight')]
    img_std0 = f32(load(std0['file']))
    out = []
    print(f"{'file':9} {'control':14} {'wb':8} {'dev':9} | {'gains R/G/B':20} {'sat':6} {'hue':6} | sector dh (r/y/g/c/b/m) | abs: hue/p90/sat/rms | own: hue/p90/sat/rms")
    for p in pts:
        ref = bases[(p['control'], p['wbMode'])]
        cam = f32(load(p['file']))
        refimg = img_std0 if ref is std0 else f32(load(ref['file']))
        row = dict(id=p['id'], control=p['control'], wbMode=p['wbMode'], label=p['label'], sat=p['saturation'], hue=p['hue'], ab=p['ab'], gm=p['gm'])
        row['vsRef'] = measure(refimg, cam) if not p['isBase'] else None
        if p['isBase'] and ref is not std0:
            row['vsStd0'] = measure(img_std0, cam)
        m_abs, pre_abs = render(img_std0, p['uAbs'])
        row['errAbs'] = score(cam, m_abs, img_std0)
        if ref is not std0:
            m_own, pre_own = render(refimg, p['uOwn'])
            row['errOwn'] = score(cam, m_own, refimg)
        else:
            row['errOwn'] = row['errAbs']
        if do_fit:
            row['fitAbs'] = fit_residual(cam, m_abs, pre_abs, img_std0)
            row['fitOwn'] = fit_residual(cam, m_own, pre_own, refimg) if ref is not std0 else row['fitAbs']
        out.append(row)
        v = row['vsRef'] or row.get('vsStd0') or {}
        g = v.get('gains', [1, 1, 1]); sd = v.get('sectorDh', [None] * 6)
        ea, eo = row['errAbs'], row['errOwn']
        print(f"{p['id']:9} {p['control']:14} {p['wbMode']:8} {p['label']:9} | {g[0]:.3f}/{g[1]:.3f}/{g[2]:.3f}  {v.get('satRatio', 1):.3f} {v.get('hueDeltaDeg', 0):+6.1f} | "
              + ' '.join(f"{x:+5.1f}" if x is not None else '   --' for x in sd)
              + f" | {ea['hueErrDeg']:5.1f} {ea['hueErrP90']:5.1f} {ea['satErr']:+.3f} {ea['rgbRms']:5.1f} | {eo['hueErrDeg']:5.1f} {eo['hueErrP90']:5.1f} {eo['satErr']:+.3f} {eo['rgbRms']:5.1f}")
    json.dump(out, open(os.path.join(ROOT, 'calibration/thesis/analysis.json'), 'w'), indent=1)
    print(f"\n{len(out)} rows -> calibration/thesis/analysis.json")


if __name__ == '__main__':
    main()
