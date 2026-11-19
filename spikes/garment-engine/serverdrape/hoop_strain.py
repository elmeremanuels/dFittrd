"""Hoop strain of the POM v2 drapes (step3-serverdrape-spike.md §10.9): along each mesh ring, draped length against the
size's rest length (rest-<size>.bin), at the hip-line ring (total and the most stretched single segment) and the most
stretched ring from ring 6 (below the pinned band and seam) to the hem.

python3 hoop_strain.py <root, e.g. out/pom2-avatar> [drape .bin ...]   (default: every drape of <root>/drapes/wear)
"""
import json, sys, glob, os
import numpy as np
root = sys.argv[1]
rest = json.load(open(f'{root}/rest/rest.json'))
st, sz, hr = rest['rings']['start'], rest['rings']['size'], rest['rings']['hipRing']
def ring_len(p, k):
    i = np.arange(st[k], st[k] + sz[k]); j = np.roll(i, -1)
    return np.linalg.norm(p[i] - p[j], axis=1)
pats = sys.argv[2:] or sorted(glob.glob(f'{root}/drapes/wear/t*__*[0-9].bin'))
print('drape  hipRing(cm)  hoop strain at hip ring: total / max-segment ; max ring strain rings 6..end (ring#)')
for f in pats:
    name = os.path.basename(f)[:-4]; size = name.split('__')[1]
    p = np.fromfile(f, dtype=np.float32).reshape(-1, 3)
    r = np.fromfile(f'{root}/rest/rest-{size}.bin', dtype=np.float32).reshape(-1, 3)
    L, L0 = ring_len(p, hr), ring_len(r, hr)
    worst = max((ring_len(p, k).sum() / ring_len(r, k).sum() - 1, k) for k in range(6, len(st)))
    print(f'{name:12s} {L.sum():6.1f}  {100*(L.sum()/L0.sum()-1):+5.1f}% / {100*(L/L0-1).max():+5.1f}%   {100*worst[0]:+5.1f}% (ring {worst[1]})')
