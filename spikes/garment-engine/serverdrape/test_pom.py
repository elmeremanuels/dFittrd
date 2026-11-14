"""Tests of pom_rest.py and pom_measure.py (need numpy; skipped without it).
Run: python3 -m unittest discover -s serverdrape -p 'test_*.py' (from spikes/garment-engine)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

try:
    import numpy as np
except ImportError:  # CI has no numpy: the pure band_model tests still run
    np = None

HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(np, "numpy not installed")
class PomRest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        subprocess.run([sys.executable, os.path.join(HERE, "pom_rest.py"), cls.tmp.name], check=True, capture_output=True)
        with open(os.path.join(cls.tmp.name, "rest.json")) as fh:
            cls.meta = json.load(fh)
        cls.idx = np.fromfile(os.path.join(cls.tmp.name, "indices.bin"), dtype=np.uint32).reshape(-1, 3)
        cls.band = np.fromfile(os.path.join(cls.tmp.name, "band.bin"), dtype=np.uint8).astype(bool)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def rings(self, size):
        p = np.fromfile(os.path.join(self.tmp.name, f"rest-{size}.bin"), dtype=np.float32).reshape(-1, 3).astype(np.float64)
        return [p[a:a + n] for a, n in zip(self.meta["rings"]["start"], self.meta["rings"]["size"])]

    @staticmethod
    def girths(rings):
        return np.array([np.linalg.norm(r - np.roll(r, -1, axis=0), axis=1).sum() for r in rings])

    def test_provenance_of_every_size(self):
        got = {s["size"]: s["provenance"] for s in self.meta["sizes"]}
        self.assertEqual(got, {"8": "measured", "10": "measured", "12": "interpolated", "14": "measured", "16": "extrapolated"})
        s12 = next(s for s in self.meta["sizes"] if s["size"] == "12")
        self.assertTrue(all(v["source"].startswith("interpolated") for v in s12["tape"].values()))

    def test_rings_carry_the_tape_girths(self):
        hr = self.meta["rings"]["hipRing"]
        for s in self.meta["sizes"]:
            r = self.rings(s["size"])
            length = self.girths(r)
            t = s["tape"]
            for k, want in ((0, t["stretchedGirthCm"]["cm"]), (hr, t["hipCm"]["cm"]), (-1, t["hemSweepCm"]["cm"])):
                self.assertAlmostEqual(length[k] / want, 1.0, delta=0.001)  # inscribed polygon: a hair under the girth
            self.assertAlmostEqual(float(r[hr][:, 1].mean()), 87.36, places=3)

    def test_meridians_carry_the_tape_length(self):
        # Every ring is the top ellipse offset by delta along its normals at height y: the meridian length between two
        # rings is hypot(d delta, d y) at every point of the ring. Summed over the rings it must be the tape length.
        for s in self.meta["sizes"]:
            r = self.rings(s["size"])
            y = np.array([x[0, 1] for x in r])
            girth = self.girths(r)
            delta = (girth - girth[0]) / (2 * np.pi)
            self.assertAlmostEqual(float(np.hypot(np.diff(delta), np.diff(y)).sum()), s["tape"]["lengthCm"]["cm"], delta=0.15)

    def test_uniform_fabric_area_per_particle(self):
        # Blender's cloth gives every particle the same mass, so the fabric area a particle stands for must not vary
        # along the skirt (the first POM mesh varied 6x from band to hem: review finding).
        for s in self.meta["sizes"]:
            a = s["areaPerParticleCm2"]
            self.assertLess(a["max"] / a["min"], 1.2)
        p = np.concatenate(self.rings("10"))
        tri = p[self.idx]
        area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
        self.assertLess(area.max() / area.min(), 2.0)

    def test_one_topology_band_and_orientation(self):
        r = self.rings("8")
        p = np.concatenate(r)
        self.assertEqual(self.meta["vertexCount"], len(p))
        self.assertEqual(len(self.idx), self.meta["triangleCount"])
        self.assertLess(self.idx.max(), 65536)  # bake.ts packs Uint16 indices
        self.assertEqual(len(np.unique(self.idx)), len(p))  # every particle is in a triangle
        e = np.sort(np.concatenate([self.idx[:, [0, 1]], self.idx[:, [1, 2]], self.idx[:, [2, 0]]]), axis=1)
        _, uses = np.unique(e, axis=0, return_counts=True)
        self.assertEqual(set(uses.tolist()), {1, 2})  # a manifold tube: interior edges twice, the two rims once
        self.assertEqual(int((uses == 1).sum()), len(r[0]) + len(r[-1]))
        self.assertTrue(np.array_equal(self.band, p[:, 1] >= p[:, 1].max() - 4.0 - 1e-3))
        nrm = np.cross(p[self.idx[:, 1]] - p[self.idx[:, 0]], p[self.idx[:, 2]] - p[self.idx[:, 0]])
        c = p[self.idx].mean(1) - np.array([0, 0, 2.5])
        self.assertTrue(((nrm[:, [0, 2]] * c[:, [0, 2]]).sum(1) > 0).all())  # every triangle faces outwards

    def test_uvs_follow_the_texture_cylinder(self):
        uv = np.fromfile(os.path.join(self.tmp.name, "uvs.bin"), dtype=np.float32).reshape(-1, 2)
        self.assertGreaterEqual(uv[:, 0].min(), 0)
        self.assertLess(uv[:, 0].max(), 1)
        self.assertAlmostEqual(float(uv[0, 1]), 0.0398, places=4)
        self.assertAlmostEqual(float(uv[-1, 1]), 0.676, places=4)


@unittest.skipUnless(np, "numpy not installed")
class Slice(unittest.TestCase):
    def test_front_profile_of_a_cone(self):
        import pom_measure
        pos, idx = self.tube(lambda i: 20.0)
        pos[:64] *= [2, 1, 2]  # radius 40 at y = 0, 20 at y = 10
        f = pom_measure.front_profile(pos, idx, 10.0, 0.0)
        self.assertAlmostEqual(f["0.5"]["widthCm"], 60.0, delta=0.5)
        self.assertAlmostEqual(f["0.5"]["overLength"], 6.0, delta=0.05)

    def test_meridian_point_on_a_ring_with_another_count(self):
        import pom_measure
        n = 8
        a = (np.arange(n) + 0.5) / n
        ring = np.stack([np.sin(2 * np.pi * a), np.zeros(n), np.cos(2 * np.pi * a)], 1)
        got = pom_measure.closed_polyline_at(ring, a, np.array([a[0], 0.0, (a[0] + a[1]) / 2]))
        self.assertTrue(np.allclose(got[0], ring[0]))
        self.assertTrue(np.allclose(got[1], (ring[0] + ring[-1]) / 2))  # wraps round the seam
        self.assertTrue(np.allclose(got[2], (ring[0] + ring[1]) / 2))

    def tube(self, radius):
        """A vertical tube with 64 columns; `radius(i)` gives the radius of column i."""
        n = 64
        a = np.arange(n) / n * 2 * np.pi
        r = np.array([radius(i) for i in range(n)])
        ring = np.stack([r * np.sin(a), np.zeros(n), r * np.cos(a)], 1)
        pos = np.concatenate([ring + [0, 0, 0], ring + [0, 10, 0]])
        tri = []
        for i in range(n):
            j = (i + 1) % n
            tri += [(i, j, n + i), (j, n + j, n + i)]
        return pos, np.array(tri)

    def test_round_tube_hull_equals_path(self):
        import pom_measure
        pos, idx = self.tube(lambda i: 20.0)
        s = pom_measure.slice_at(pos, idx, 5.0)
        self.assertAlmostEqual(s["hull"], 2 * np.pi * 20, delta=0.3)
        self.assertAlmostEqual(s["path"], s["hull"], delta=0.11)

    def test_folded_tube_path_exceeds_hull(self):
        import pom_measure
        pos, idx = self.tube(lambda i: 20.0 if i % 2 == 0 else 14.0)
        s = pom_measure.slice_at(pos, idx, 5.0)
        self.assertAlmostEqual(s["hull"], 2 * np.pi * 20, delta=1.0)   # the hull only sees the fold tips
        self.assertGreater(s["path"], 1.5 * s["hull"])                  # the path follows every fold


if __name__ == "__main__":
    unittest.main()
