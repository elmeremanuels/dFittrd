"""Tests of band_model.py. Run: python3 -m unittest discover -s serverdrape -p 'test_*.py' (from spikes/garment-engine)."""
import copy
import json
import os
import tempfile
import unittest

import band_model

HERE = os.path.dirname(os.path.abspath(__file__))
REST = {"sizes": [{"size": s, "hemEdgeGirthCm": e, "hemSweepMaxCm": m} for s, e, m in
                  (("8", 72.2, 109.1), ("12", 80.0, 120.7), ("16", 88.0, 132.2))]}


class PerSize(unittest.TestCase):
    def setUp(self):
        self.model = band_model.load(os.path.join(HERE, "band-model.json"))

    def test_measured_sizes_come_from_the_tape_file(self):
        with open(os.path.join(HERE, "..", "data", "bohohippychic", "tape", "crimson-wildflower-maxi-skirt.json")) as fh:
            tape = json.load(fh)
        self.assertEqual(sorted(band_model.measured_sizes(self.model), key=float), tape["measuredSizes"])
        for size, row in tape["sizes"].items():
            g = band_model.band_girth(self.model, "measured", size)
            self.assertEqual((g["relaxedCm"], g["stretchedCm"], g["source"]), (row["waistRelaxedCm"], row["waistStretchedCm"], "measured"))
            self.assertEqual(band_model.tape_value(self.model, "hemSweepCm", size), (row["hemSweepCm"], "measured"))
            self.assertEqual(band_model.tape_value(self.model, "hipCm", size), (row["hipCm"], "measured"))

    def test_relaxed_and_stretched_are_both_used_per_size(self):
        g8, g14 = (band_model.band_girth(self.model, "measured", s) for s in ("8", "14"))
        self.assertAlmostEqual(g8["stretchRatio"], 94 / 67, places=4)
        self.assertAlmostEqual(g14["stretchRatio"], 110 / 80, places=4)
        # A band that stretches less is stiffer (ASSUMED linear-spring mapping).
        self.assertGreater(g14["elasticToFabricStiffness"], g8["elasticToFabricStiffness"])
        self.assertAlmostEqual(g8["elasticToFabricStiffness"], 0.08 * 0.5 / (94 / 67 - 1), places=4)

    def test_12_is_interpolated_and_labelled(self):
        g = band_model.band_girth(self.model, "measured", "12")
        self.assertEqual((g["relaxedCm"], g["stretchedCm"]), (75.5, 105.0))
        self.assertTrue(g["source"].startswith("interpolated"))
        self.assertIn("10 and 14", g["source"])
        self.assertEqual(band_model.tape_value(self.model, "hipCm", "12")[0], 124.0)
        self.assertEqual(band_model.tape_value(self.model, "hemSweepCm", "12")[0], 254.0)

    def test_16_is_extrapolated_with_the_10_to_14_slope_and_labelled(self):
        g = band_model.band_girth(self.model, "measured", "16")
        self.assertEqual((g["relaxedCm"], g["stretchedCm"]), (84.5, 115.0))
        self.assertTrue(g["source"].startswith("extrapolated"))
        self.assertIn("10-14", g["source"])
        self.assertEqual(band_model.tape_value(self.model, "hipCm", "16")[0], 128.0)
        self.assertEqual(band_model.tape_value(self.model, "hemSweepCm", "16")[0], 266.0)
        self.assertEqual(band_model.tape_value(self.model, "lengthCm", "16")[0], 104.5)

    def test_never_measured_for_an_unmeasured_size(self):
        for size in ("6", "12", "16", "18"):
            for field in ("relaxedGirthCm", "stretchedGirthCm", "hipCm", "hemSweepCm", "lengthCm"):
                self.assertNotEqual(band_model.tape_value(self.model, field, size)[1], "measured")

    def test_below_the_range_uses_the_first_slope(self):
        v, src = band_model.tape_value(self.model, "relaxedGirthCm", "6")
        self.assertEqual(v, 63.0)
        self.assertIn("8-10", src)

    def test_hem_check_per_size_with_provenance(self):
        rows = band_model.hem_check(self.model, REST)
        self.assertEqual([r["size"] for r in rows], ["8", "12", "16"])
        self.assertEqual([r["tapeCm"] for r in rows], [230.0, 254.0, 266.0])
        self.assertEqual([r["source"].split(" ")[0] for r in rows], ["measured", "interpolated", "extrapolated"])
        self.assertTrue(all(not r["ok"] for r in rows))  # the reconstructed hem is about half the real sweep
        self.assertAlmostEqual(rows[0]["diff"], 109.1 / 230 - 1, places=3)

    def test_inline_sizes_and_a_corrected_value_change_the_drape_key(self):
        m = copy.deepcopy(self.model)
        m["measured"] = {"sizes": {"8": {"relaxedGirthCm": 67, "stretchedGirthCm": 94}, "14": {"relaxedGirthCm": 80, "stretchedGirthCm": 110}}}
        g = band_model.band_girth(m, "measured", "10")
        self.assertAlmostEqual(g["relaxedCm"], 67 + 13 / 3, places=2)
        self.assertTrue(g["source"].startswith("interpolated (between AU 8 and 14)"))
        k1 = band_model.drape_key(band_model.band_girth(m, "measured", "8"), 0.8, "pushed")
        m["measured"]["sizes"]["8"]["stretchedGirthCm"] = 96
        self.assertNotEqual(k1, band_model.drape_key(band_model.band_girth(m, "measured", "8"), 0.8, "pushed"))

    def test_one_measured_size_has_no_slope(self):
        m = copy.deepcopy(self.model)
        m["measured"] = {"sizes": {"10": {"relaxedGirthCm": 71, "stretchedGirthCm": 100}}}
        g = band_model.band_girth(m, "measured", "16")
        self.assertEqual(g["relaxedCm"], 71)
        self.assertTrue(g["source"].startswith("extrapolated"))

    def test_tape_file_path_is_relative_to_the_model_file(self):
        with tempfile.TemporaryDirectory() as d:
            m = {**copy.deepcopy(self.model), "measured": {"tapeFile": "t.json"}}
            for name, doc in (("t.json", {"sizes": {"8": {"waistRelaxedCm": 60, "waistStretchedCm": 90}}}), ("m.json", {k: v for k, v in m.items() if k != "_dir"})):
                with open(os.path.join(d, name), "w") as fh:
                    json.dump(doc, fh)
            self.assertEqual(band_model.band_girth(band_model.load(os.path.join(d, "m.json")), "measured", "8")["relaxedCm"], 60)


class DrapeKey(unittest.TestCase):
    def test_cloth_preset_is_in_the_key_only_when_not_default(self):
        g = {"relaxedCm": 67, "stretchedCm": 94, "elasticToFabricStiffness": 0.09926}
        k = band_model.drape_key(g, 0.8, "pushed")
        self.assertNotIn("cloth", k)  # drapes cached before the presets existed keep their key
        self.assertEqual(k, band_model.cached_key({"config": dict(k)}))
        self.assertEqual(band_model.drape_key(g, 0.8, "pushed", 0.0, "viscose-soft")["cloth"], "viscose-soft")


class SingleSample(unittest.TestCase):
    def setUp(self):
        self.model = band_model.load(os.path.join(HERE, "band-model.json"))
        self.model["measured"] = {"sampleSize": "12", "relaxedGirthCm": 72, "stretchedGirthCm": 108, "hemSweepCm": 250, "gradePerSizeCm": None}

    def test_chart_grade(self):
        g = band_model.band_girth(self.model, "measured", "8")
        self.assertEqual((g["relaxedCm"], g["stretchedCm"], g["source"]), (62.0, 93.0, "measured"))

    def test_explicit_grade(self):
        self.model["measured"]["gradePerSizeCm"] = 4
        self.assertEqual(band_model.band_girth(self.model, "measured", "16")["relaxedCm"], 80)

    def test_hem_check_sample_size_only(self):
        rows = band_model.hem_check(self.model, REST)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["size"], rows[0]["tapeCm"], rows[0]["ok"]), ("12", 250, False))


class Assumed(unittest.TestCase):
    def test_variants_unchanged_and_empty_measured_refused(self):
        m = band_model.load(os.path.join(HERE, "band-model.json"))
        g = band_model.band_girth(m, "W-6", "8")
        self.assertEqual((g["relaxedCm"], g["elasticToFabricStiffness"], g["source"]), (61.5, 0.08, "ASSUMED W-6"))
        m["measured"] = None
        self.assertIsNone(band_model.hem_check(m, REST))
        with self.assertRaises(SystemExit):
            band_model.band_girth(m, "measured", "8")


if __name__ == "__main__":
    unittest.main()
