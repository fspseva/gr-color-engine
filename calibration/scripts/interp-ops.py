#!/usr/bin/env python3
"""In-between slider steps for the measured operators.

The engine only has operators at measured levels (WB shift 7/14, tone ±2/±4).
Lerping an operator's matrix and curves toward identity fails badly for WB
(Jev review 2026-10-20: A7 predicted from A14 at RMS 17, M7 at 856), because
the gain split between matrix and curves is arbitrary. This script predicts
each measured midpoint (WB 7, tone ±2) from the outer level alone with
several schemes, scores them against the camera development, and reports.

  python3 scripts/interp-ops.py
"""
import json, os, importlib.util
import numpy as np
from scipy.linalg import fractional_matrix_power

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('fo', os.path.join(ROOT, 'scripts/fit-ops.py'))
fo = importlib.util.module_from_spec(spec); spec.loader.exec_module(fo)
fs = fo.fs; KX = fo.KX; KN = fo.KN

J = json.load(open(os.path.join(ROOT, 'calibration/ops/ops.json')))
OPS = J['ops']
EPS = 1e-4


def op_lin(op, x):
    """Operator in linear light (no sRGB encode)."""
    M = np.array(op['m']).reshape(3, 3); k = np.array(op['k']).reshape(3, KN)
    y = x @ M.T
    return np.stack([np.interp(np.clip(y[:, c], 0, 1), KX, k[c]) for c in range(3)], 1)


def rms(pred8, cam8):
    return float(np.sqrt(((pred8 - cam8) ** 2).mean()))


def lerp_params(op, t):
    return fo.interp_op(fo.IDENT, op, t)


def power_op(op, t):
    """M^t, and each curve blended geometrically with identity:
    g_t(y) = y^(1-t) · g(y)^t (multiplicative, like a gain raised to t)."""
    M = np.real(fractional_matrix_power(np.array(op['m']).reshape(3, 3), t))
    k = np.array(op['k']).reshape(3, KN)
    kt = np.where(KX > 0, np.power(np.maximum(KX, EPS), 1 - t) * np.power(np.maximum(k, EPS), t), 0)
    return dict(m=M.ravel().tolist(), k=fo.monotone(kt).ravel().tolist())


def target_geometric(op, x, t):
    """Per-pixel, per-channel geometric blend of input and full operator output."""
    return np.power(np.maximum(x, EPS), 1 - t) * np.power(np.maximum(op_lin(op, x), EPS), t)


def target_linear(op, x, t):
    return (1 - t) * x + t * op_lin(op, x)


def refit(inp8, target_lin, tone_only):
    """Fit a shippable matrix+curves operator to a synthetic target."""
    return fo.fit_op(inp8, fs.srgb(np.clip(target_lin, 0, 1)) * 255, tone_only)


def main():
    base = fo.full('R0002790')
    rng = np.random.default_rng(fo.SEED); idx = rng.choice(len(base), fo.N_EVAL, replace=False)
    fit_idx = idx[:25000]
    inp_eval, inp_fit = base[idx], base[fit_idx]
    x_eval, x_fit = fs.lin(inp_eval / 255.0), fs.lin(inp_fit / 255.0)
    cases = []
    for name, (id_, tone) in fo.OPS.items():
        fam, lvl = name.split(':')
        if fam in ('key', 'contrast', 'chi', 'csh') and lvl in ('-2', '2'):
            cases.append((name, id_, f'{fam}:{int(lvl) * 2}', tone))
        elif fam == 'wb' and lvl.endswith('7'):
            cases.append((name, id_, f'wb:{lvl[0]}14', tone))
    out = {}
    print(f"{'step':10} {'direct':>7} {'lerp':>8} {'power':>8} {'geo-tgt':>8} {'geo-refit':>9} {'lin-refit':>9}")
    for name, id_, far, tone in cases:
        cam = fo.full(id_)[idx].astype(np.float32)
        op = OPS[far]
        r = dict(direct=J['scores'][name])
        r['lerp'] = rms(fo.chain([lerp_params(op, 0.5)], inp_eval), cam)
        r['power'] = rms(fo.chain([power_op(op, 0.5)], inp_eval), cam)
        r['geo_target'] = rms(fs.srgb(target_geometric(op, x_eval, 0.5)) * 255, cam)
        r['geo_refit'] = rms(fo.chain([refit(inp_fit, target_geometric(op, x_fit, 0.5), tone)], inp_eval), cam)
        r['lin_refit'] = rms(fo.chain([refit(inp_fit, target_linear(op, x_fit, 0.5), tone)], inp_eval), cam)
        out[name] = r
        print(f"{name:10} {r['direct']:7.2f} {r['lerp']:8.2f} {r['power']:8.2f} {r['geo_target']:8.2f} {r['geo_refit']:9.2f} {r['lin_refit']:9.2f}", flush=True)
    json.dump(out, open(os.path.join(ROOT, 'calibration/ops/interp-methods.json'), 'w'), indent=1)

    # validation.json predated the --canon rewrite of ops.json (2026-09-08,
    # 12:14 vs 12:16) and still showed the pre-canonical lerp failures.
    # Re-score composition and interpolation on the operators the engine ships.
    print("\n--- composition order, canonical operators ---")
    comp = {}
    for label, orders in fo.PAIRS.items():
        cam = fo.full(label.split()[0])[idx].astype(np.float32)
        res = [rms(fo.chain([OPS[n] for n in o], inp_eval), cam) for o in orders]
        comp[label] = dict(zip([' → '.join(o) for o in orders], res))
        print(f"{label:22} " + '   '.join(f"{' → '.join(o)}: {v:5.2f}" for o, v in zip(orders, res)), flush=True)
    interp = {n: dict(interpolated=r['lerp'], direct=r['direct']) for n, r in out.items()}
    json.dump(dict(canonical=True, composition=comp, interpolation=interp),
              open(os.path.join(ROOT, 'calibration/ops/validation.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
