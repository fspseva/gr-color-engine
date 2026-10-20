#!/usr/bin/env python3
"""Measured Saturation-slider operators (2026-10-20).

The parametric saturation law left Sat ±4 at the old engine's error and
Negative Film +4 as the worst development in the real renderer. Saturation
is fitted like the other operators (3×3 matrix + per-channel curves) from
the Standard developments at ±2 and ±4. The odd steps (±1, ±3) are NOT
interpolated at runtime — averaging operator parameters fails for saturation
(S+2 predicted from S+4 at RMS 14.6) — but refitted offline to the gamma-space
blend of their two measured neighbours' outputs, which predicts the measured
±2 from 0↔±4 at 2.2 / 2.6.

Applied after the base look: Negative Film +4 composes at 2.4 that way and
8.1 the other (R0003011, never fitted on).

  python3 scripts/fit-sat-ops.py      (updates calibration/ops/ops.json and ops.generated.ts)
"""
import json, os, importlib.util
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('fo', os.path.join(ROOT, 'scripts/fit-ops.py'))
fo = importlib.util.module_from_spec(spec); spec.loader.exec_module(fo)
fs = fo.fs

MEASURED = {'sat:-4': 'R0002791', 'sat:-2': 'R0002792', 'sat:2': 'R0002793', 'sat:4': 'R0002794'}


def op_lin(op, x):
    M = np.array(op['m']).reshape(3, 3); k = np.array(op['k']).reshape(3, fo.KN)
    y = x @ M.T
    return np.stack([np.interp(np.clip(y[:, c], 0, 1), fo.KX, k[c]) for c in range(3)], 1)


def gamma_blend(a, b, x):
    """Output halfway between two operators, blended in gamma space."""
    ga = fs.srgb(np.clip(op_lin(a, x) if a else x, 0, 1))
    gb = fs.srgb(np.clip(op_lin(b, x), 0, 1))
    return (ga + gb) / 2 * 255


def main():
    path = os.path.join(ROOT, 'calibration/ops/ops.json')
    J = json.load(open(path))
    base = fo.full('R0002790')
    rng = np.random.default_rng(fo.SEED); idx = rng.choice(len(base), fo.N_EVAL, replace=False)
    fit_idx = idx[:fo.N_FIT]
    inp_fit, inp_eval = base[fit_idx], base[idx]
    x_fit = fs.lin(inp_fit / 255.0)
    ops = {}
    for name, id_ in MEASURED.items():
        out = fo.full(id_)
        ops[name] = fo.canonicalize(fo.fit_op(inp_fit, out[fit_idx], False))
        r = float(np.sqrt(((fo.chain([ops[name]], inp_eval).clip(0, 255) - out[idx]) ** 2).mean()))
        J['scores'][name] = r
        print(f"{name:8} {id_}  rms {r:5.2f}", flush=True)
    for name, lo, hi in (('sat:1', None, 'sat:2'), ('sat:3', 'sat:2', 'sat:4'),
                         ('sat:-1', None, 'sat:-2'), ('sat:-3', 'sat:-2', 'sat:-4')):
        target = gamma_blend(ops[lo] if lo else None, ops[hi], x_fit)
        ops[name] = fo.canonicalize(fo.fit_op(inp_fit, target, False))
        print(f"{name:8} refit to the blend of {lo or 'identity'} and {hi}", flush=True)
    J['ops'].update(ops)
    json.dump(J, open(path, 'w'))
    fo.emit(J['ops'])
    print('emitted src/lib/engine/ops.generated.ts')


if __name__ == '__main__':
    main()
