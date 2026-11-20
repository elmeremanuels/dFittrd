"""Stage 1b preflight on CPU: the checks a stage 1b job can pass before any GPU runs.

    python -I spikes/garment-engine/modal/stage1b_preflight.py <job_dir> [<job_dir> ...] [--json out.json]

Per job:
  1. `phase0_lib.load_manifest` (format, pins, input hash fields) and `stage1b_plan` (both views, sources, invented
     flags, the proxy-dressed target);
  2. the job's input files exist (`job_input_files`) and the shop source photos decode, with their size;
  3. the edit region per view (`edit_region`, as the GPU app builds it: front opening kept open for outerwear, the
     crotch gap for trousers) and its share of the frame;
  4. the POSITIVE CONTROL: QA v2 (`still_qa`) on the proxy-dressed render itself, i.e. a still whose garment is
     exactly the proxy. A correct garment of the right kind must be able to pass; if the proxy cannot, every engine
     output would fail for a reason in our inputs, not in the engine, and the GPU run is wasted;
  5. the NEGATIVE CONTROL where the kind has a TYPE check: trousers with the legs merged, a skirt with a bodice, an
     outerwear front with its opening closed must fail as TYPE failures (the ones `--accept-failed-dress` never
     overrides), or the QA could not stop a wrong garment before stage 2.

What it cannot check (needs the GPU models): the garment segmentation of the shop photo (Grounding DINO + SAM 2), so
no garment colour and no print fidelity; the try-on itself. No network, no Modal. numpy + Pillow only.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Any

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

import phase0_dress as dq  # noqa: E402
import phase0_lib as lib  # noqa: E402


def _mask(path: str) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(path).convert("L")) > 127


def view_controls(bare: np.ndarray, proxy: np.ndarray, kind: str, tryon_cat: str, name: str) -> tuple[dict[str, Any], list[str]]:
    """Edit region, positive control (the proxy itself) and negative control (the wrong garment of the kind) for one view."""
    problems: list[str] = []
    gap = dq.trouser_gap_zone(proxy, bare) if kind == "trousers" else None
    region, region_rec = dq.edit_region(proxy, bare, tryon_cat, keep_open=kind == "outerwear", open_crotch=gap)
    proxy_q = dq.qa_proxy(proxy, gap)
    garment = proxy_q & region
    qa = dq.still_qa(garment, bare | proxy_q, bare, proxy_q, region, kind=kind, garment_full=proxy_q)
    rec = {
        "proxy_px": int(proxy.sum()),
        "region_frac": round(float(region.mean()), 4),
        "region": {k: region_rec[k] for k in region_rec if isinstance(region_rec[k], (int, float, str, bool))},
        "gap_px": int(gap.sum()) if gap is not None else None,
        "positive_control": {"pass": bool(qa["pass"]), "failures": list(qa["failures"]), "type_failures": list(qa.get("type_failures") or []),
                             "warnings": list(qa.get("warnings") or [])},
    }
    # NEGATIVE CONTROL: the wrong garment of this kind must fail the TYPE checks, or the QA cannot tell.
    wrong = None
    if kind == "trousers" and gap is not None and gap.any():
        wrong = ("legs merged (a skirt drawn over both legs)", proxy_q | gap)
    elif kind == "skirt":
        top = int(np.argmax(proxy.any(axis=1)))
        wrong = ("a bodice above the waistband (a dress drawn)", proxy_q | (bare & (np.arange(proxy.shape[0])[:, None] < top) & (np.arange(proxy.shape[0])[:, None] > top - proxy.shape[0] // 6)))
    elif kind == "outerwear":
        zone = dq.front_opening_zone(proxy, bare)
        if zone.any() and name == "front":
            wrong = ("front opening closed (a pullover drawn)", proxy_q | zone)
    if wrong is not None:
        g = wrong[1]
        nq = dq.still_qa(g & region, bare | g, bare, proxy_q, region, kind=kind, garment_full=g)
        rec["negative_control"] = {"case": wrong[0], "pass": bool(nq["pass"]), "type_failures": list(nq.get("type_failures") or []), "failures": list(nq["failures"])}
        if nq["pass"] or not nq.get("type_failures"):
            problems.append(f"{name}: negative control '{wrong[0]}' is not caught as a TYPE failure ({nq['failures']})")
    else:
        rec["negative_control"] = None
    if not qa["pass"]:
        problems.append(f"{name}: the proxy itself fails QA v2 ({qa['failures']}): an engine output of the right garment could not pass")
    return rec, problems


def preflight(job_dir: str) -> dict[str, Any]:
    from PIL import Image

    out: dict[str, Any] = {"job_dir": job_dir, "problems": []}
    try:
        m = lib.load_manifest(os.path.join(job_dir, "manifest.json"))
    except Exception as e:  # noqa: BLE001 - reported, not raised: one bad job must not hide the others
        out["problems"].append(f"manifest: {e}")
        return out
    out["job_id"] = m.get("job_id")
    out["category"] = m.get("category")
    kind = ((m.get("control") or {}).get("proxy") or {}).get("kind") or m.get("category")
    out["kind"] = kind
    try:
        views = lib.stage1b_plan(m)
    except Exception as e:  # noqa: BLE001
        out["problems"].append(f"stage1b_plan: {e}")
        return out
    missing = [f for f in lib.job_input_files(job_dir) if not os.path.exists(os.path.join(job_dir, f))]
    if missing:
        out["problems"].append(f"{len(missing)} input files missing, e.g. {missing[:3]}")
    spec = m["stage1b"]
    out["source_kind"] = spec.get("source_kind")
    out["invented_back"] = bool(spec.get("invented_back"))
    sources = []
    for s in spec.get("sources", []):
        p = os.path.join(job_dir, s["path"])
        with Image.open(p) as im:
            w, h = im.size
            im.convert("RGB").load()
        sources.append({"role": s["role"], "path": s["path"], "size": [w, h]})
    out["sources"] = sources
    tryon_cat = lib.tryon_category(m["category"])
    out["tryon_category"] = tryon_cat
    out["views"] = {}
    for v in views:
        name = v["view"]
        bare = _mask(os.path.join(job_dir, v["bare_mask"]))
        proxy = _mask(os.path.join(job_dir, v["proxy_mask"]))
        rec, problems = view_controls(bare, proxy, kind, tryon_cat, name)
        out["problems"].extend(problems)
        out["views"][name] = rec
    out["pass"] = not out["problems"]
    return out


def main(argv: list[str] | None = None) -> int:
    import argparse

    ap = argparse.ArgumentParser(description="Stage 1b preflight on CPU (no GPU, no network)")
    ap.add_argument("job_dirs", nargs="+")
    ap.add_argument("--json", help="write all records here")
    a = ap.parse_args(argv)
    recs = [preflight(j) for j in a.job_dirs]
    for r in recs:
        views = r.get("views", {})
        pc = ", ".join(f"{n} proxy-QA {'pass' if v['positive_control']['pass'] else 'FAIL'} (region {v['region_frac']})"
                       + (f", wrong kind {'caught' if v['negative_control']['type_failures'] and not v['negative_control']['pass'] else 'NOT caught'}" if v.get('negative_control') else "")
                       for n, v in views.items())
        print(f"[preflight] {os.path.basename(r['job_dir'].rstrip('/'))}: kind {r.get('kind')}, source {r.get('source_kind')}, invented back {r.get('invented_back')}; {pc}; "
              f"{'OK' if r.get('pass') else 'PROBLEMS ' + '; '.join(r['problems'])}")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(recs, f, indent=2)
            f.write("\n")
    return 0 if all(r.get("pass") for r in recs) else 1


if __name__ == "__main__":
    raise SystemExit(main())
