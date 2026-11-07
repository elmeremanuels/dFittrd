"""Stage 1b QA for the other garment kinds (stage1b-qa-0.6.0): trousers keep two legs, a skirt or trousers grows no
bodice, an outerwear front opening stays open (and is kept out of the edit region), and FASHN labels a trouser
garment `pants`. Synthetic masks at a quarter of 480x832 (the layout of test_stage1b_qa.py); numpy only."""
import os
import sys

import pytest

np = pytest.importorskip("numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import phase0_dress as dq  # noqa: E402
import phase0_lib as lib  # noqa: E402

W, H = 120, 208


def box(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


# Head, torso, two legs apart from the crotch (row 120), arms beside the torso (as test_stage1b_qa.py).
BARE = box(54, 10, 66, 40) | box(46, 40, 74, 120) | box(47, 120, 57, 200) | box(63, 120, 73, 200) | box(34, 45, 42, 110) | box(78, 45, 86, 110)


def qa(garment, proxy, kind, region=None, cat="bottoms"):
    if region is None:
        region, _ = dq.edit_region(proxy, BARE, cat, keep_open=kind == "outerwear")
    return dq.still_qa(garment & region, BARE | garment, BARE, proxy, region, kind=kind, garment_full=garment)


# Trousers: waist (row 80) to the ankle, a seat to the crotch and two legs 4 px apart.
TROUSERS = box(44, 80, 76, 122) | box(44, 122, 58, 196) | box(62, 122, 76, 196)
SKIRT_DRAWN = box(44, 80, 76, 196)  # one closed volume: palazzo pants drawn as a maxi skirt


def test_trousers_keep_two_legs_and_a_skirt_drawn_instead_fails():
    good = qa(TROUSERS, TROUSERS, "trousers")
    assert good["pass"], good["failures"]
    assert good["merged_leg_rows"] == 0 and good["trouser_leg_rows"] > 50
    bad = qa(SKIRT_DRAWN, TROUSERS, "trousers")
    assert any("legs merged" in f for f in bad["failures"]), bad["failures"]
    # Wide legs that touch for a few rows under the crotch are still trousers.
    touching = TROUSERS | box(58, 122, 62, 132)
    assert qa(touching, TROUSERS, "trousers")["pass"]


SKIRT = box(44, 80, 76, 196)


def test_a_skirt_or_trousers_drawn_with_a_bodice_fails():
    assert qa(SKIRT, SKIRT, "skirt")["pass"]
    dress = SKIRT | box(46, 42, 74, 80)
    r = qa(dress, SKIRT, "skirt")
    assert r["above_waist_fraction"] > 0.2
    assert any("above the waistband" in f for f in r["failures"]), r["failures"]
    # A waistband drawn a few rows higher than the proxy's top edge is fine.
    assert qa(SKIRT | box(44, 76, 76, 80), SKIRT, "skirt")["pass"]
    r2 = qa(TROUSERS | box(46, 42, 74, 80), TROUSERS, "trousers")
    assert any("above the waistband" in f for f in r2["failures"])


# Cardigan: torso shell from row 42 to the hip (row 125) with a V between the fronts from the top to row 85, sleeves.
V = np.zeros((H, W), bool)
for y in range(42, 85):
    half = round(8 * (85 - y) / 43)
    V[y, 60 - half:60 + half] = True
CARDI = (box(44, 42, 76, 125) & ~V) | box(33, 44, 43, 108) | box(77, 44, 87, 108)


def test_front_opening_zone_is_the_mannequin_between_the_fronts_only():
    zone = dq.front_opening_zone(CARDI, BARE)
    assert zone.sum() > 0 and (zone <= V).all()
    assert zone.sum() >= 0.9 * (V & BARE).sum()
    # A closed proxy (a dress, a back view) has none; nor does the head above the proxy.
    assert dq.front_opening_zone(box(44, 42, 76, 160), BARE).sum() == 0


def test_outerwear_opening_stays_open_in_the_region_and_a_closed_front_fails():
    region, rec = dq.edit_region(CARDI, BARE, "tops", keep_open=True)
    assert rec["kept_open_px"] > 0
    assert not region[50, 60]  # the middle of the V near its top is never repainted
    plain, _ = dq.edit_region(CARDI, BARE, "tops")
    assert plain[50, 60]  # without keep_open the margin closes it
    good = qa(CARDI, CARDI, "outerwear", cat="tops")
    assert good["pass"], good["failures"]
    assert good["front_opening_cover"] == 0.0
    closed = CARDI | V
    bad = qa(closed, CARDI, "outerwear", region=plain, cat="tops")
    assert any("front opening closed" in f for f in bad["failures"]), bad["failures"]
    # Not checked at the back camera (no zone) or for a closed outerwear proxy.
    assert qa(box(44, 42, 76, 125), box(44, 42, 76, 125), "outerwear", cat="tops")["front_opening_cover"] is None


def test_fashn_labels_trousers_as_pants_and_keeps_the_other_categories():
    assert lib.fashn_garment_label("bottoms", "trousers") == "pants"
    assert lib.fashn_garment_label("bottoms", "skirt") == "skirt"
    assert lib.fashn_garment_label("tops", "outerwear") == "top"
    assert lib.fashn_garment_label("one-pieces") == "dress"
    pants = lib.FASHN_LABEL_IDS["pants"]
    assert list(lib.fashn_label_map([1, 0, 1], "bottoms", "trousers")) == [pants, 0, pants]
    assert "pants" in lib.FASHN_BODY_COVERAGE_TO_LABELS[lib.FASHN_CATEGORY_TO_BODY_COVERAGE["bottoms"]]
