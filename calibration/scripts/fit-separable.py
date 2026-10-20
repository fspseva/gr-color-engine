#!/usr/bin/env python3
"""Experiment: how much of the camera's recipe transform is separable?

For a representative set of developments (calibration/separable/uniforms.json,
from scripts/dump-uniforms.mjs), fit pixel-level models from the Standard/
Daylight/zero JPEG (R0002790) to each development on pixel-aligned pairs:

  A  curves          out_c = f_c(in_c)                 per-channel 1D only
  B  matrix+curves   out   = g(M · lin(in))            3x3 in linear light, then per-channel curves
  C  curves+matrix   out   = g(M · f(lin(in)))         pre-curves added
  E  engine          the shader port (scripts/analyze-thesis.py) with the engine's own uniforms

All scored as 8-bit sRGB RMS on the same full-resolution pixel sample, then
broken down by input hue / saturation / luminance and by chart patch.

  python3 scripts/fit-separable.py            -> calibration/separable/results.json + report
"""
import json, os, sys, importlib.util
import numpy as np
from PIL import Image
from scipy.optimize import least_squares

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('an', os.path.join(ROOT, 'scripts/analyze-thesis.py'))
an = importlib.util.module_from_spec(spec); spec.loader.exec_module(an)

BASE = 'test-images/control/R0002790.JPG'
UNI = json.load(open(os.path.join(ROOT, 'calibration/separable/uniforms.json')))
OUT = os.path.join(ROOT, 'calibration/separable/results.json')
N_FIT, N_EVAL, SEED = 60000, 300000, 0
KNOTS = 12

# Chart geometry in full-res pixels of R0002785 developments (all aligned).
RAMP = dict(x0=3190, x1=3980, y0=1010, y1=1666, cols=10, rows=9,
            rows_lbl=['CM', 'C', 'CY', 'Y', 'MY', 'M', 'CMY', 'K', 'CMYK'], cols_lbl=[f'{p}%' for p in range(100, 0, -10)])
GRAY = dict(x0=4144, x1=4210, y0=974, y1=1744, cols=1, rows=21, rows_lbl=[f'{5 * i}%' for i in range(21)], cols_lbl=['G'])
SWOP = dict(x0=3196, x1=3520, y0=1830, y1=2376, cols=4, rows=7, rows_lbl=['CM', 'C', 'CY', 'Y', 'MY', 'M', 'CMYK'], cols_lbl=['100%', '75%', '50%', '25%'])


def find_file(id_):
    for d in ('', 'greens/', 'round2/'):
        p = os.path.join(ROOT, 'test-images/control', d, id_ + '.JPG')
        if os.path.exists(p):
            return p
    raise FileNotFoundError(id_)


def full(path):
    return np.asarray(Image.open(path).convert('RGB'), np.uint8)


def patches():
    out = []
    for name, g in (('ramp', RAMP), ('gray', GRAY), ('swop', SWOP)):
        cw = (g['x1'] - g['x0']) / g['cols']; rh = (g['y1'] - g['y0']) / g['rows']
        for r in range(g['rows']):
            for c in range(g['cols']):
                cx = g['x0'] + (c + 0.5) * cw; cy = g['y0'] + (r + 0.5) * rh
                out.append(dict(name=f"{name}:{g['rows_lbl'][r]}/{g['cols_lbl'][c]}",
                                x0=int(cx - cw * 0.2), x1=int(cx + cw * 0.2), y0=int(cy - rh * 0.2), y1=int(cy + rh * 0.2)))
    return out


def patch_means(img, pl):
    return np.array([img[p['y0']:p['y1'], p['x0']:p['x1']].reshape(-1, 3).mean(0) for p in pl], np.float32)


# ---- models -----------------------------------------------------------------
def lin(x):
    return np.power(x, 2.2)


def srgb(x):
    return np.power(np.maximum(x, 0), 1 / 2.2)


KX = np.power(np.linspace(0, 1, KNOTS), 2.2)  # knot positions in linear light (gamma-spaced)


def curve(x, v):
    return np.interp(x, KX, v)


def model_A(inp, out):
    """Per-channel binned-median curves; exact, no optimization."""
    f = []
    for c in range(3):
        b = inp[:, c]
        med = np.array([np.median(out[b == k, c]) if np.any(b == k) else np.nan for k in range(256)])
        ok = ~np.isnan(med); med = np.interp(np.arange(256), np.arange(256)[ok], med[ok])
        f.append(med)
    pred = np.stack([f[c][inp[:, c]] for c in range(3)], 1)
    return pred, dict(curves=[fc.round(2).tolist() for fc in f])


def apply_B(theta, x_lin, pre):
    i = 0
    if pre:
        fv = theta[i:i + 3 * KNOTS].reshape(3, KNOTS); i += 3 * KNOTS
        x_lin = np.stack([curve(x_lin[:, c], fv[c]) for c in range(3)], 1)
    M = theta[i:i + 9].reshape(3, 3); i += 9
    y = x_lin @ M.T
    gv = theta[i:i + 3 * KNOTS].reshape(3, KNOTS)
    y = np.stack([curve(np.clip(y[:, c], 0, 1), gv[c]) for c in range(3)], 1)
    return srgb(y) * 255


def fit_B(inp, out, pre, warm=None):
    x = lin(inp / 255.0); t = out.astype(np.float32)
    if warm is not None:  # C warm-started from B: identity pre-curves + B's matrix and curves
        th0 = np.concatenate([KX] * 3 + [warm]).astype(np.float64)
    else:
        th0 = np.concatenate([np.eye(3).ravel()] + [KX] * 3).astype(np.float64)
    res = least_squares(lambda th: (apply_B(th, x, pre) - t).ravel(), th0, method='trf', max_nfev=150 if pre else 80, x_scale='jac', verbose=0)
    return res.x


def pointwise_ceiling(inp_fit, out_fit, inp_eval, fallback, n=32):
    """DIAGNOSTIC, not a model: median output per 32³ input cell on the fit
    sample, evaluated on the disjoint eval sample (cells unseen -> fallback).
    Approximates the best any pointwise colour transform can do; whatever
    remains above it is not colour structure (spatial ops, noise, JPEG)."""
    key = lambda a: (a[:, 0] // (256 // n)) * n * n + (a[:, 1] // (256 // n)) * n + (a[:, 2] // (256 // n))
    kf = key(inp_fit.astype(np.int64)); ke = key(inp_eval.astype(np.int64))
    order = np.argsort(kf); kf_s = kf[order]; of = out_fit[order].astype(np.float32)
    uniq, start, cnt = np.unique(kf_s, return_index=True, return_counts=True)
    med = np.zeros((len(uniq), 3), np.float32)
    for i, (st, c) in enumerate(zip(start, cnt)):
        med[i] = np.median(of[st:st + c], 0)
    pos = np.searchsorted(uniq, ke); pos = np.minimum(pos, len(uniq) - 1)
    hit = (uniq[pos] == ke) & (cnt[pos] >= 4)
    pred = fallback.copy(); pred[hit] = med[pos[hit]]
    return pred, float(hit.mean())


def engine_pred(inp, u):
    m, _ = an.render(inp.astype(np.float32) / 255.0, u)
    return m * 255


# ---- breakdowns -------------------------------------------------------------
def breakdown(inp, resid):
    """RMS of residual by input hue (12 bins, S>0.15), saturation (4), luminance (5)."""
    h, s, l = an.rgb2hsl(inp.astype(np.float32) / 255.0)
    r2 = (resid ** 2).mean(1)
    out = {}
    hb = ((h * 360) // 30).astype(int); m = s > 0.15
    out['hue'] = [round(float(np.sqrt(r2[m & (hb == k)].mean())), 2) if np.any(m & (hb == k)) else None for k in range(12)]
    sb = np.digitize(s, [0.06, 0.25, 0.5, 0.75])
    out['sat'] = [round(float(np.sqrt(r2[sb == k].mean())), 2) for k in range(5)]
    lb = np.minimum((l * 5).astype(int), 4)
    out['lum'] = [round(float(np.sqrt(r2[lb == k].mean())), 2) for k in range(5)]
    return out


def main():
    base = full(os.path.join(ROOT, BASE))
    H, W, _ = base.shape
    rng = np.random.default_rng(SEED)
    idx = rng.choice(H * W, N_EVAL, replace=False)
    fit_idx = idx[:N_FIT]
    pl = patches()
    base_flat = base.reshape(-1, 3)
    inp_eval = base_flat[idx]; inp_fit = base_flat[fit_idx]
    base_patch = patch_means(base, pl)
    results = {}
    print(f"{'dev':9} {'settings':26} | RMS: engine  A-curves  B-mat+crv  C-crv+mat+crv  D-pointwise-ceiling(cover) | B matrix (rows R,G,B)", flush=True)
    for id_, rec in UNI.items():
        img = full(find_file(id_)); out_flat = img.reshape(-1, 3)
        out_eval = out_flat[idx].astype(np.float32); out_fit = out_flat[fit_idx]
        p = rec['params']
        lbl = f"{p['control'][:3]}" + ''.join(f" {k}{p[key]:+d}" for k, key in (('S', 'saturation'), ('H', 'hue'), ('K', 'highLowKey'), ('C', 'contrast'), ('CHi', 'contrastHighlight'), ('CSh', 'contrastShadow'), ('ab', 'wbShiftAB'), ('gm', 'wbShiftGM')) if p[key]) + (f" {p['wbMode']}" if p['wbMode'] != 'daylight' else '') or 'sta zero'
        predE = engine_pred(inp_eval, rec['uAbs'])
        predA, infoA = model_A(inp_fit, out_fit.astype(np.float32)) if False else (None, None)
        # model A on eval set: fit curves on the fit set, apply to eval
        fA = []
        for c in range(3):
            b = inp_fit[:, c]; o = out_fit[:, c]
            med = np.full(256, np.nan)
            for k in np.unique(b):
                med[k] = np.median(o[b == k])
            ok = ~np.isnan(med); med = np.interp(np.arange(256), np.arange(256)[ok], med[ok]); fA.append(med)
        predA = np.stack([fA[c][inp_eval[:, c]] for c in range(3)], 1)
        thB = fit_B(inp_fit, out_fit, pre=False); predB = apply_B(thB, lin(inp_eval / 255.0), False)
        thC = fit_B(inp_fit, out_fit, pre=True, warm=thB); predC = apply_B(thC, lin(inp_eval / 255.0), True)
        # pointwise ceiling uses the full eval sample as its fit set and a fresh disjoint sample to evaluate
        idx2 = rng.choice(H * W, N_EVAL, replace=False)
        predD, cover = pointwise_ceiling(base_flat[idx], out_flat[idx], base_flat[idx2], apply_B(thB, lin(base_flat[idx2] / 255.0), False))
        rmsD = float(np.sqrt(((predD - out_flat[idx2].astype(np.float32)) ** 2).mean()))
        rms = lambda pr: float(np.sqrt(((pr - out_eval) ** 2).mean()))
        M = thB[:9].reshape(3, 3)
        r = dict(label=lbl, params=p, rms=dict(engine=rms(predE), A=rms(predA), B=rms(predB), C=rms(predC), D_pointwise_ceiling=rmsD, D_coverage=cover),
                 matrixB=M.round(4).tolist(), curvesB=thB[9:].reshape(3, KNOTS).round(4).tolist(),
                 breakdown=dict(engine=breakdown(inp_eval, predE - out_eval), B=breakdown(inp_eval, predB - out_eval), C=breakdown(inp_eval, predC - out_eval)))
        # patches: camera vs model C per patch (mean of model applied to patch pixels)
        out_patch = patch_means(img, pl)
        predC_patch = np.array([apply_B(thC, lin(base[q['y0']:q['y1'], q['x0']:q['x1']].reshape(-1, 3) / 255.0), True).mean(0) for q in pl])
        predB_patch = np.array([apply_B(thB, lin(base[q['y0']:q['y1'], q['x0']:q['x1']].reshape(-1, 3) / 255.0), False).mean(0) for q in pl])
        predE_patch = np.array([engine_pred(base[q['y0']:q['y1'], q['x0']:q['x1']].reshape(-1, 3), rec['uAbs']).mean(0) for q in pl])
        r['patches'] = [dict(name=q['name'], inp=base_patch[i].round(1).tolist(), cam=out_patch[i].round(1).tolist(),
                             errB=(predB_patch[i] - out_patch[i]).round(1).tolist(), errC=(predC_patch[i] - out_patch[i]).round(1).tolist(), errE=(predE_patch[i] - out_patch[i]).round(1).tolist()) for i, q in enumerate(pl)]
        r['thetaB'] = thB.round(5).tolist()
        results[id_] = r
        print(f"{id_:9} {lbl:26} | {r['rms']['engine']:6.2f}  {r['rms']['A']:8.2f}  {r['rms']['B']:9.2f}  {r['rms']['C']:13.2f}  {rmsD:6.2f} ({cover:.2f}) | {np.array2string(M.round(3), max_line_width=200)}".replace('\n', ' '), flush=True)
    json.dump(dict(base=BASE, n_fit=N_FIT, n_eval=N_EVAL, seed=SEED, knots=KNOTS, patches=pl, results=results), open(OUT, 'w'), indent=1)
    print(f"-> {OUT}")


if __name__ == '__main__':
    main()
