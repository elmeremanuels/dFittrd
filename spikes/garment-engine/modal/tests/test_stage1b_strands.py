"""stage1b-qa-0.12.0: thin pieces hanging below the hem (run 16b's cream hem flap).

Run 16a's azure back (FASHN) has a cut tie string, 4-6 px wide, hanging 12 rows below the hem at the mannequin's left. The
composite pasted it (`still_garment_mask` adds joined chromatic pieces outside the proxy, made for run 15's blouse shirt-tail;
the cream string is chromatic), QA did not see it, and stage 2 grew it into a cream flap swinging at the hem in 75 of 160
turntable frames. `trim_strands` leaves a few such strings outside the proxy out of the composite (recorded); `still_qa` fails
any thin hanging piece left in the pasted mask (TYPE). Synthetic scenes at 480x832 (the layout of test_stage1b_run15.py)."""
import os
import sys

import pytest

np = pytest.importorskip("numpy")

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
sys.path.insert(0, MODAL_DIR)
sys.path.insert(0, HERE)

import phase0_dress as dq  # noqa: E402
from test_stage1b_run15 import BARE4, STUDIO, box, render4, up  # noqa: E402

# a dress: bodice and a flared skirt to row 528 (azure's back hem); the proxy to the same hem
PROXY = up(box(44, 42, 76, 100)) | up(box(38, 100, 82, 132))


def dress():
    return PROXY.copy()


def string(x, y0, y1, w=5):
    m = np.zeros_like(BARE4)
    m[y0:y1, x:x + w] = True
    return m


def test_a_cut_string_below_the_hem_outside_the_proxy_is_found_and_left_out():
    """Azure 16a back: the string is 13 rows tall, 6 px wide, 12 rows below the cloth beside it."""
    g = dress() | string(160, 520, 545)
    found = dq.hanging_strands(g, PROXY)
    assert len(found["pieces"]) == 1
    p = found["pieces"][0]
    assert p["cols"] == [160, 164] and p["rows"][1] == 544 and p["hem_row"] == 527 and p["hang_rows"] == 17
    assert p["outside_share"] == round(16 / 17, 3) and p["below_px"] == 17 * 5  # the first row below the hem is within the 1 px proxy pad
    trimmed, rec = dq.trim_strands(g, PROXY)
    assert rec["trimmed_px"] == 85 and len(rec["trimmed"]) == 1
    assert not trimmed[528:, :].any() and (trimmed == dress()).all()  # the cloth above the hem untouched
    q = dq.still_qa(trimmed, BARE4 | trimmed, BARE4, PROXY, PROXY | ~PROXY, kind="dress")
    assert not any(f.startswith("thin piece hanging") for f in q["failures"]) and q["hanging_strands"]["pieces"] == []


def test_left_in_the_still_it_is_a_type_failure():
    """Before 0.12.0 the same mask passed: no check looked below the hem."""
    g = dress() | string(160, 520, 545)
    q = dq.still_qa(g, BARE4 | g, BARE4, PROXY, PROXY | ~PROXY, kind="dress")
    tf = [f for f in q["type_failures"] if f.startswith("thin piece hanging below the hem")]
    assert tf and "rows 528-544" in tf[0] and "17 rows below the cloth beside it" in tf[0]


def test_inside_the_proxy_it_is_not_trimmed_but_flagged():
    """Run 14's azure: the export's proxy ran on below the drawn hem, so its strings lie inside it: a person looks."""
    long_proxy = PROXY | up(box(38, 132, 82, 145))
    g = dress() | string(200, 520, 560)
    out, rec = dq.trim_strands(g, long_proxy)
    assert rec["trimmed_px"] == 0 and (out == g).all() and "inside the proxy" in rec["reason"]
    q = dq.still_qa(out, BARE4 | out, BARE4, long_proxy, long_proxy | ~long_proxy, kind="dress")
    assert any(f.startswith("thin piece hanging") for f in q["type_failures"])


def test_a_fringe_is_a_design_left_as_drawn_and_flagged():
    """More than `max_trim_pieces` strings: tassels or a fringe; never trimmed silently."""
    g = dress()
    for x in range(170, 300, 20):
        g |= string(x, 520, 545, w=4)
    out, rec = dq.trim_strands(g, PROXY)
    assert rec["trimmed_px"] == 0 and (out == g).all() and "fringe" in rec["reason"]
    assert rec["found"] == 7 > dq.STRANDS["max_trim_pieces"]
    q = dq.still_qa(out, BARE4 | out, BARE4, PROXY, PROXY | ~PROXY, kind="dress")
    assert any(f.startswith("thin piece hanging below the hem: 7 piece(s)") for f in q["type_failures"])


def test_what_is_not_a_hanging_string():
    base = dress()
    # a flap as wide as the opening survives it: cloth, not a string
    flap = base | string(160, 520, 545, w=12)
    assert dq.hanging_strands(flap, PROXY)["pieces"] == []
    # a short spur (a ragged hem: fewer rows below the hem than 0.01 of the height)
    assert dq.hanging_strands(base | string(160, 520, 533), PROXY)["pieces"] == []
    # a speck below the hem (2 rows): not a string
    speck = base.copy()
    speck[540:542, 200] = True
    assert dq.hanging_strands(speck, PROXY)["pieces"] == []
    # a sliver along the hem (wider than tall)
    sliver = base.copy()
    sliver[528:531, 200:260] = True
    assert dq.hanging_strands(sliver, PROXY)["pieces"] == []
    # a cuff tie at a sleeve end, far above the hem: the hem is the garment's lowest row, not a sleeve's
    top = up(box(44, 42, 76, 100)) | up(box(30, 44, 44, 80))
    tie = top | string(124, 300, 360, w=4)
    assert dq.hanging_strands(tie, top)["pieces"] == []


def test_compose_candidate_trims_the_string_the_composite_would_have_pasted():
    """The app path end to end: the chosen mask has no string; `still_garment_mask` adds the cream string below the hem
    (outside the proxy, chromatic, joined: the 0.9.0 shirt-tail step), and `trim_strands` takes it out again."""
    proxy = PROXY
    region = dq.edit_region(proxy, BARE4, "one-pieces")[0]
    cream = (226, 214, 196)
    strand = string(156, 520, 546) & region & ~BARE4
    gen = render4([(proxy, (214, 150, 160)), (strand, cream)], seed=3)
    _, mask, rec = dq.compose_candidate(gen, proxy & region, BARE4, render4([], seed=4), proxy, region, STUDIO, kind="dress")
    assert rec["strands"]["trimmed_px"] > 0 and not (mask & strand & (np.arange(mask.shape[0])[:, None] > 527)).any()
    assert rec["composite_mask"]["added_outside_px"] > 0  # the step that pasted it in 0.11.0 still runs


def test_a_trim_is_never_silent():
    """Review of run 17a (F3): the pixels left out reach the still's QA warnings, the stage 1b summary warnings (printed by the
    app, the recompose and the finalize) and one record key, `strands`, on the app's and the replay's candidate."""
    import phase0_lib as lib

    g = dress() | string(160, 520, 545)
    trimmed, rec = dq.trim_strands(g, PROXY)
    assert rec["note"].startswith("left out 85 px of 1 thin piece(s)") and "rows 528-544, columns 160-164" in rec["note"]
    q = dq.still_qa(trimmed, BARE4 | trimmed, BARE4, PROXY, PROXY | ~PROXY, kind="dress", trimmed=rec)
    assert rec["note"] in q["warnings"] and q["strands_trimmed"]["trimmed_px"] == 85
    s = lib.stage1b_summary([{"view": "back", "qa": q}], invented_back=False)
    assert s["warnings"] == [f"back still: {rec['note']}"] and s["pass"] == q["pass"]
    # nothing trimmed: no warning, no record
    _, none = dq.trim_strands(dress(), PROXY)
    assert none["note"] is None
    q0 = dq.still_qa(dress(), BARE4 | dress(), BARE4, PROXY, PROXY | ~PROXY, kind="dress", trimmed=none)
    assert q0["strands_trimmed"] is None and not any("thin piece" in w for w in q0["warnings"])
    assert lib.stage1b_summary([{"view": "back", "qa": q0}], invented_back=False)["warnings"] == []
