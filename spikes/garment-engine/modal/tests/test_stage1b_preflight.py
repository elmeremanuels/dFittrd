"""stage1b_preflight.view_controls: the proxy itself passes QA v2 (positive control) and the wrong garment of the kind fails
as a TYPE failure (negative control). Synthetic masks at a quarter of 480x832, the layout of test_stage1b_kinds.py; numpy only."""
import os
import sys

import pytest

np = pytest.importorskip("numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import stage1b_preflight as pf  # noqa: E402

W, H = 120, 208


def box(x0, y0, x1, y1):
    m = np.zeros((H, W), bool)
    m[y0:y1, x0:x1] = True
    return m


BARE = box(54, 10, 66, 40) | box(46, 40, 74, 120) | box(47, 120, 57, 200) | box(63, 120, 73, 200) | box(34, 45, 42, 110) | box(78, 45, 86, 110)
TROUSERS = box(44, 80, 76, 122) | box(44, 122, 58, 196) | box(62, 122, 76, 196)
SKIRT = box(44, 80, 76, 196)


def test_trousers_positive_and_negative_control():
    rec, problems = pf.view_controls(BARE, TROUSERS, "trousers", "bottoms", "front")
    assert problems == [], problems
    assert rec["positive_control"]["pass"]
    neg = rec["negative_control"]
    assert neg["case"].startswith("legs merged") and not neg["pass"] and neg["type_failures"]


def test_skirt_positive_and_negative_control():
    rec, problems = pf.view_controls(BARE, SKIRT, "skirt", "bottoms", "back")
    assert problems == [], problems
    assert rec["negative_control"]["case"].startswith("a bodice") and rec["negative_control"]["type_failures"]


def test_trousers_without_a_leg_gap_have_no_negative_control():
    # A "trousers" proxy whose legs are joined: the gap zone is empty, so there is no negative control, and nothing is claimed.
    rec, problems = pf.view_controls(BARE, SKIRT, "trousers", "bottoms", "front")
    assert rec["negative_control"] is None
    assert all("negative control" not in p for p in problems)


def test_closed_outerwear_has_no_negative_control():
    # A buttoned jacket has no front opening zone: the QA has no TYPE check for it (a gap the preflight reports as None).
    jacket = box(44, 42, 76, 125) | box(33, 44, 43, 108) | box(77, 44, 87, 108)
    rec, problems = pf.view_controls(BARE, jacket, "outerwear", "tops", "front")
    assert rec["positive_control"]["pass"], rec["positive_control"]
    assert rec["negative_control"] is None
