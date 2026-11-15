"""Tests of the POM v2 wear rule, the pull-on check, the gathered seam and the v2 rest profiles (need numpy).
Run: python3 -m unittest discover -s serverdrape -p 'test_*.py' (from spikes/garment-engine)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest

try:
    import numpy as np
except ImportError:  # CI has no numpy
    np = None

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def cylinder(radius_at, y0=0.0, y1=120.0, n=96, rows=61):
    """A closed-sided vertical tube body; radius_at(y) gives its radius. Returns verts, faces, arm mask."""
    ys = np.linspace(y0, y1, rows)
    a = np.arange(n) / n * 2 * np.pi
    v = np.concatenate([np.stack([radius_at(y) * np.sin(a), np.full(n, y), radius_at(y) * np.cos(a)], 1) for y in ys])
    f = []
    for r in range(rows - 1):
        for i in range(n):
            j = (i + 1) % n
            f += [(r * n + i, r * n + j, (r + 1) * n + i), (r * n + j, (r + 1) * n + j, (r + 1) * n + i)]
    return v, np.array(f), np.zeros(len(v), dtype=bool)


@unittest.skipUnless(np, "numpy not installed")
class WearRule(unittest.TestCase):
    def setUp(self):
        import wear_rule
        self.w = wear_rule

    def test_wear_level_is_a_fixed_distance_under_the_navel(self):
        lvl = self.w.wear_level(103.0)
        self.assertEqual((lvl["bandTopY"], lvl["bandMidY"], lvl["seamY"]), (101.0, 99.0, 97.0))

    def test_band_fit_states(self):
        f = self.w.band_fit
        self.assertEqual(f(67.2, 67, 94)["status"], "relaxed")
        s = f(87, 71, 100)
        self.assertEqual((s["status"], s["stretchedByCm"], s["bandGirthCm"], s["wearable"]), ("stretched", 16, 87, True))
        loose = f(80.8, 84.5, 115)
        self.assertEqual((loose["status"], loose["looseByCm"], loose["bandGirthCm"], loose["wearable"]), ("loose", 3.7, 84.5, True))
        no = f(95.7, 67, 94)
        self.assertEqual((no["status"], no["overLimitCm"], no["wearable"]), ("cannot be worn", 1.7, False))

    def test_pull_on_compares_the_stretched_band_with_the_widest_girth(self):
        self.assertFalse(self.w.pull_on(100.0, 94.0)["passes"])
        self.assertEqual(self.w.pull_on(100.0, 94.0)["marginCm"], -6.0)
        self.assertTrue(self.w.pull_on(100.0, 100.0)["passes"])

    def test_placement_sensitivity_flags_a_verdict_that_moves_with_the_assumed_level(self):
        # A body that narrows upwards by 2 cm of girth per cm of height (as Anny's does below the navel).
        v, f, arm = cylinder(lambda y: (90.0 - 2.0 * (y - 99.0)) / (2 * np.pi), y0=80.0, y1=120.0, rows=41)
        sec = self.w.BodySections(v, f, arm)
        navel = 99.0 + self.w.BELOW_NAVEL_CM + self.w.BAND_CM / 2  # the band's mid height is y = 99: girth 90
        over = self.w.placement_sensitivity(sec, navel, 67.0, 89.0)   # 1 cm over the stretched limit
        self.assertEqual(self.w.band_fit(sec.girth(99.0), 67.0, 89.0)["status"], "cannot be worn")
        self.assertAlmostEqual(over["girthPerCmUp"], -2.0, delta=0.05)
        self.assertAlmostEqual(over["flipsAtShiftCm"], 0.5, delta=0.11)   # half a cm higher and it is wearable
        self.assertEqual((over["flipsTo"], over["insideUncertainty"]), ("holds", True))
        loose = self.w.placement_sensitivity(sec, navel, 93.0, 120.0)  # 3 cm loose: holds 1.5 cm lower
        self.assertAlmostEqual(loose["flipsAtShiftCm"], -1.3, delta=0.11)  # 'loose' starts 0.5 cm under the relaxed girth
        self.assertTrue(loose["insideUncertainty"])
        firm = self.w.placement_sensitivity(sec, navel, 70.0, 110.0)   # 20 cm from either limit
        self.assertEqual((firm["flipsAtShiftCm"], firm["insideUncertainty"]), (None, False))
        self.assertEqual([a["shiftCm"] for a in firm["atShift"]], [-2.0, -1.0, 0.0, 1.0, 2.0])

    def test_render_label_gives_no_pull_on_verdict_for_a_size_on_its_own_chart_body(self):
        import render_pom2
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "bodies"))
            json.dump({"bodies": [{"id": "b", "achieved": {"hipCm": 94.0}}]}, open(os.path.join(d, "bodies", "bodies.json"), "w"))
            own = render_pom2.pull_line(d, "b", {"stretchedCm": 94.0, "marginCm": -2.0})   # AU 8 on the AU 8 chart body
            self.assertIn("+0.0 / -2.0", own)
            self.assertIn("as on its own chart body", own)
            for word in ("FAIL", "fail", "pass"):
                self.assertNotIn(word, own)
            self.assertIn("short", render_pom2.pull_line(d, "b", {"stretchedCm": 88.0, "marginCm": -8.0}))
            self.assertIn("clear", render_pom2.pull_line(d, "b", {"stretchedCm": 100.0, "marginCm": 4.0}))

    def test_body_sections_girth_and_widest(self):
        v, f, arm = cylinder(lambda y: 14.0 + 3.0 * np.exp(-((y - 88.0) / 6.0) ** 2))
        sec = self.w.BodySections(v, f, arm)
        self.assertAlmostEqual(sec.girth(40.0), 2 * np.pi * 14.0, delta=0.1)
        girth, at = sec.widest(97.0, 80.0)
        self.assertAlmostEqual(at, 88.0, delta=0.6)
        self.assertAlmostEqual(girth, 2 * np.pi * 17.0, delta=0.15)

    def test_arm_triangles_are_left_out(self):
        v, f, arm = cylinder(lambda y: 14.0)
        v2 = v + [60.0, 0.0, 0.0]  # an "arm" beside the body
        sec = self.w.BodySections(np.concatenate([v, v2]), np.concatenate([f, f + len(v)]), np.concatenate([arm, ~arm]))
        self.assertAlmostEqual(sec.girth(50.0), 2 * np.pi * 14.0, delta=0.1)

    def test_offset_adds_two_pi_delta_and_starts_at_the_centre_front(self):
        t = np.linspace(0, 2 * np.pi, 300, endpoint=False)
        hull = self.w.convex_hull(np.stack([17 * np.cos(t), 12 * np.sin(t) + 1.0], 1))
        p0 = self.w.perimeter(hull)
        self.assertAlmostEqual(self.w.perimeter(self.w.offset_curve(hull, 1.5)) - p0, 2 * np.pi * 1.5, delta=0.01)
        frac = np.arange(80) / 80
        pts, nrm = self.w.resample(self.w.offset_curve(hull, 0.6), frac)
        self.assertAlmostEqual(pts[0, 0], 0.0, delta=1e-6)       # fraction 0 = centre front
        self.assertAlmostEqual(pts[0, 1], 13.6, delta=0.01)
        self.assertGreater(pts[1, 0], 0)                          # then towards +x, as pom_rest.py's rings
        self.assertTrue(np.allclose(np.linalg.norm(nrm, axis=1), 1.0))
        self.assertTrue(((pts - [0, 1.0]) * nrm).sum(1).min() > 0)  # normals point outwards
        seg = np.linalg.norm(pts - np.roll(pts, -1, 0), axis=1)
        self.assertLess(seg.max() / seg.min(), 1.02)              # evenly spaced along the ring

    def test_pleated_ring_takes_up_the_fabric_and_stays_off_the_body(self):
        t = np.linspace(0, 2 * np.pi, 300, endpoint=False)
        hull = self.w.convex_hull(np.stack([16 * np.cos(t), 12 * np.sin(t)], 1))
        frac = np.arange(122) / 122
        r = self.w.pleated_ring(hull, 0.6, frac, 122.0, 30)
        self.assertAlmostEqual(self.w.ring_length(r["points"]), 122.0, delta=0.01)   # the top edge keeps its length
        self.assertGreater(r["amplitudeCm"], 0.3)
        self.assertLess(r["centreGirthCm"], 122.0)                                   # ... on a shorter ring: gathered
        # No particle closer to the body than the clearance (hull distance >= 0.6 up to the sampling).
        d = [min(np.linalg.norm(hull - p, axis=1)) for p in r["points"]]
        self.assertGreater(min(d), 0.55)
        folds = self.w.fold_count(r["points"])
        self.assertEqual(folds["folds"], 30)
        self.assertGreater(folds["lengthOverHull"], 1.1)

    def test_pleated_ring_without_spare_fabric_has_no_folds(self):
        t = np.linspace(0, 2 * np.pi, 300, endpoint=False)
        hull = self.w.convex_hull(np.stack([16 * np.cos(t), 16 * np.sin(t)], 1))
        r = self.w.pleated_ring(hull, 0.6, np.arange(100) / 100, 90.0, 25)   # the ring at the clearance is 104 cm
        self.assertEqual((r["amplitudeCm"], r["folds"]), (0.0, 0))
        self.assertGreater(r["fabricShortByCm"], 10)

    def test_fold_count_of_a_plain_ring_is_zero(self):
        t = np.arange(120) / 120 * 2 * np.pi
        self.assertEqual(self.w.fold_count(np.stack([20 * np.sin(t), 15 * np.cos(t)], 1))["folds"], 0)


@unittest.skipUnless(np, "numpy not installed")
class RestProfiles(unittest.TestCase):
    """pom_rest.py --profile tube | cone: the panel's top edge is longer than the band (gathered onto it)."""

    def build(self, profile):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        subprocess.run([sys.executable, os.path.join(HERE, "pom_rest.py"), tmp.name, "8,12,14", "--profile", profile, "--edge", "1.0"],
                       check=True, capture_output=True)
        with open(os.path.join(tmp.name, "rest.json")) as fh:
            meta = json.load(fh)
        out = {}
        for s in meta["sizes"]:
            p = np.fromfile(os.path.join(tmp.name, s["file"]), dtype=np.float32).reshape(-1, 3).astype(np.float64)
            rings = [p[a:a + n] for a, n in zip(meta["rings"]["start"], meta["rings"]["size"])]
            out[s["size"]] = (s, np.array([np.linalg.norm(r - np.roll(r, -1, axis=0), axis=1).sum() for r in rings]))
        return meta, out

    def test_tube_keeps_the_hip_girth_from_the_top_edge_to_the_hip_line(self):
        meta, sizes = self.build("tube")
        self.assertEqual(meta["profile"], "tube")
        hr = meta["rings"]["hipRing"]
        for s, girth in sizes.values():
            t = s["tape"]
            self.assertTrue(np.allclose(girth[:hr + 1] / t["hipCm"]["cm"], 1.0, atol=0.001))
            self.assertAlmostEqual(girth[-1] / t["hemSweepCm"]["cm"], 1.0, delta=0.001)
            self.assertGreater(s["topEdgeGirthCm"], t["stretchedGirthCm"]["cm"])   # longer than the band at its limit
            self.assertAlmostEqual(s["topY"] - s["hemY"], t["lengthCm"]["cm"], delta=3.5)  # the flare below the hip line costs 2-3 cm of height
        self.assertEqual(sizes["12"][0]["provenance"], "interpolated")

    def test_cone_runs_straight_from_the_top_edge_to_the_hem(self):
        meta, sizes = self.build("cone")
        hr = meta["rings"]["hipRing"]
        s, girth = sizes["8"]
        self.assertAlmostEqual(girth[0], 112.0, delta=0.1)
        self.assertAlmostEqual(girth[hr], 112.0 + 20.0 / 103.0 * (230.0 - 112.0), delta=0.2)  # wider than the tape hip at 20 cm
        self.assertTrue((np.diff(girth) > 0).all())

    def test_v1_profile_is_unchanged_by_default(self):
        import pom_rest
        self.assertEqual(pom_rest.PROFILE, "v1")
        self.assertEqual(pom_rest.EDGE_CM, 1.3)

    def test_a_cone_through_the_tape_hip_is_ruled_out_by_the_stretched_band(self):
        # The reason the alternative is not "one cone through hip (at 20 cm) and hem": its top edge would be shorter
        # than the band's measured stretched girth in every measured size.
        import band_model
        model = band_model.load()
        for size in ("8", "10", "14"):
            hip, hem, length, stretched = (band_model.tape_value(model, f, size)[0] for f in ("hipCm", "hemSweepCm", "lengthCm", "stretchedGirthCm"))
            self.assertLess(hip - 20.0 * (hem - hip) / (length - 20.0), stretched)


if __name__ == "__main__":
    unittest.main()
