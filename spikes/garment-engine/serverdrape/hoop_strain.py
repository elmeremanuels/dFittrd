"""Hoop strain of the POM v2 drapes (step3-serverdrape-spike.md §10.9): along each mesh ring, draped length against the
size's rest length (rest-<size>.bin), at the hip-line ring (total and the most stretched single segment) and the most
stretched ring from ring 6 (below the pinned band and seam) to the hem. Next to it, what the stretch could be caused by:
the hip ease (the tape's hip C minus the body's hip) and the band against the drawn body (stretched band minus the
body's widest girth below the band, wear.pullOn of the drape JSON). Rows are sorted by hip ease.

With --start DIR: also the hip-line ring of the drape's START shape (the rest geometry pushed radially out of the body
plus 0.8 cm, drape_blender.py; Blender builds the cloth's springs from that shape, so its stretch is the springs' rest
length, not a force) and how many of its particles the push moved. DIR holds <body>__<size>.ratio, the per-particle
r_rest / r_start that drape_blender.py writes with --dumpratio, for example from a 2-frame run (3 s each):
  blender -b --factory-startup -P serverdrape/drape_blender.py -- --body out/pom2-avatar/bodies/t+1.00.obj \
    --rest out/pom2-avatar/rest --size 16 --band measured --out /tmp/x.bin --json /tmp/x.json --frames 2 \
    --cloth viscose-soft --floor -40 --wear navel --dumpratio DIR/t+1.00__16.ratio

python3 hoop_strain.py <root, e.g. out/pom2-avatar> [--start DIR] [drape .bin ...]   (default: every drape of <root>/drapes/wear)
"""
import json, sys, glob, os
import numpy as np
argv = sys.argv[1:]
start_dir = None
if '--start' in argv:
    i = argv.index('--start'); start_dir = argv[i + 1]; argv = argv[:i] + argv[i + 2:]
root = argv[0]
rest = json.load(open(f'{root}/rest/rest.json'))
st, sz, hr = rest['rings']['start'], rest['rings']['size'], rest['rings']['hipRing']
tape_hip = {s['size']: s['tape']['hipCm']['cm'] for s in rest['sizes']}
body_hip = {b['id']: b['achieved']['hipCm'] for b in json.load(open(f'{root}/bodies/bodies.json'))['bodies']}
def ring_len(p, k):
    i = np.arange(st[k], st[k] + sz[k]); j = np.roll(i, -1)
    return np.linalg.norm(p[i] - p[j], axis=1)
pats = argv[1:] or sorted(glob.glob(f'{root}/drapes/wear/t*__*[0-9].bin'))
rows = []
for f in pats:
    name = os.path.basename(f)[:-4]; body, size = name.split('__')
    p = np.fromfile(f, dtype=np.float32).reshape(-1, 3)
    r = np.fromfile(f'{root}/rest/rest-{size}.bin', dtype=np.float32).reshape(-1, 3)
    L, L0 = ring_len(p, hr), ring_len(r, hr)
    worst = max((ring_len(p, k).sum() / ring_len(r, k).sum() - 1, k) for k in range(6, len(st)))
    j = json.load(open(f[:-4] + '.json')) if os.path.exists(f[:-4] + '.json') else {}
    band = j.get('wear', {}).get('pullOn', {}).get('marginCm')
    start = ''
    ratio = f'{start_dir}/{name}.ratio' if start_dir else None
    if ratio and os.path.exists(ratio):
        q = np.fromfile(ratio, dtype=np.float32)
        s = r.astype(float).copy(); s[:, 0] /= q; s[:, 2] /= q   # radial push about the vertical axis (x, z)
        hip_ids = np.arange(st[hr], st[hr] + sz[hr])
        start = f'  {100*(ring_len(s, hr).sum()/L0.sum()-1):+5.1f}%  ({int((q[hip_ids] < 1).sum())} pushed)'
    ease = tape_hip[size] - body_hip[body]
    rows.append((ease, name, f'{name:12s} {ease:5.0f} {"" if band is None else f"{band:+6.1f}":>6s}   {L.sum():6.1f}  {100*(L.sum()/L0.sum()-1):+5.1f}% / {100*(L/L0-1).max():+5.1f}%   {100*worst[0]:+5.1f}% (ring {worst[1]}){start}'))
print('drape        hipEase band-widest  hipRing(cm)  draped hoop strain at hip ring: total / max-segment ; max ring strain rings 6..end (ring#)' + ('  ; START shape hip ring' if start_dir else ''))
for _, _, line in sorted(rows):
    print(line)
