"""Tests for stage 4b (re-texture a cut family's reference asset for one variant): GLB I/O, the UV atlas,
the z-buffer and visibility, the projection on a synthetic quad and cylinder seen from the exporter's own
turntable cameras (tests/fixtures/cameras_opencv.json: 8 frames, 64x112; frame 0 = front, 4 = back), the
mirrored fill, and the records. Pure Python: no numpy, PIL, Modal or GPU needed (the Modal app check
skips without `modal`).

Run from spikes/garment-engine/modal:  python -m pytest -q tests
"""
import ast
import json
import math
import os
import struct
import sys

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
MODAL_DIR = os.path.dirname(HERE)
sys.path.insert(0, MODAL_DIR)

import phase0_lib as lib  # noqa: E402
import stage4b_retexture as s4b  # noqa: E402

FIX = os.path.join(HERE, "fixtures")
RED, BLUE = (220, 30, 30), (30, 30, 220)


@pytest.fixture(scope="module")
def cams():
    with open(os.path.join(FIX, "cameras_opencv.json"), encoding="utf-8") as f:
        c = json.load(f)
    K, w2cs = lib.poses_from_opencv(c)
    return c, K, w2cs


def solid(w, h, colour):
    return bytearray(bytes(colour) * (w * h))


def quad(z, half=0.2, cy=1.0):
    """A square in the plane z = const, facing +Z (the front camera), two triangles."""
    pos = [(-half, cy - half, z), (half, cy - half, z), (half, cy + half, z), (-half, cy + half, z)]
    return pos, [(0, 1, 2), (0, 2, 3)]


def cylinder(radius=0.15, y0=0.8, y1=1.2, segments=32, rings=4):
    """Open cylinder around the turntable axis (x = z = 0); angle 0 at +Z (front), growing towards +X."""
    pos, faces = [], []
    for r in range(rings + 1):
        y = y0 + (y1 - y0) * r / rings
        for s in range(segments):
            th = 2 * math.pi * s / segments
            pos.append((radius * math.sin(th), y, radius * math.cos(th)))
    for r in range(rings):
        for s in range(segments):
            a, b = r * segments + s, r * segments + (s + 1) % segments
            c, d = a + segments, b + segments
            faces += [(a, b, d), (a, d, c)]
    return pos, faces


# --- GLB --------------------------------------------------------------------------------------------


def test_glb_round_trip_with_uvs_and_texture():
    pos, faces = quad(0.0)
    uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    png = b"\x89PNG\r\n\x1a\nnot-a-real-png"
    data = s4b.write_glb(pos, faces, uvs, png)
    assert data[:4] == b"glTF" and struct.unpack_from("<I", data, 8)[0] == len(data) and len(data) % 4 == 0
    mesh = s4b.read_glb(data)
    assert mesh["faces"] == faces
    assert all(max(abs(a - b) for a, b in zip(p, q)) < 1e-6 for p, q in zip(mesh["positions"], pos))
    assert mesh["uvs"] == [tuple(map(float, t)) for t in uvs]
    assert s4b.glb_texture(data) == png


def test_glb_without_uvs_and_with_a_node_transform():
    pos, faces = quad(0.0)
    data = bytearray(s4b.write_glb(pos, faces))
    clen = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + clen])
    gltf["nodes"][0]["translation"] = [0.0, 0.5, 0.0]
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    rebuilt = b"glTF" + struct.pack("<II", 2, 0) + struct.pack("<II", len(js), 0x4E4F534A) + js + bytes(data[20 + clen:])
    rebuilt = rebuilt[:8] + struct.pack("<I", len(rebuilt)) + rebuilt[12:]
    mesh = s4b.read_glb(rebuilt)
    assert mesh["uvs"] is None
    assert abs(mesh["positions"][0][1] - (pos[0][1] + 0.5)) < 1e-6


def test_glb_rejects_garbage():
    with pytest.raises(s4b.GlbError):
        s4b.read_glb(b"not a glb at all, really")
    pos, faces = quad(0.0)
    data = s4b.write_glb(pos, faces)
    with pytest.raises(s4b.GlbError):
        s4b.read_glb(data[:40])


# --- atlas ------------------------------------------------------------------------------------------


def test_triangle_atlas_gives_every_triangle_its_own_cell():
    pos, faces = cylinder()
    at = s4b.triangle_atlas(pos, faces, 256)
    assert len(at["positions"]) == 3 * len(faces) and len(at["uvs"]) == 3 * len(faces)
    cells = set()
    for t, f in enumerate(at["faces"]):
        us = [at["uvs"][k] for k in f]
        assert all(0.0 <= u <= 1.0 and 0.0 <= v <= 1.0 for u, v in us)
        cu = sum(u for u, _ in us) / 3 * 256 // at["cell_px"]
        cv = sum(v for _, v in us) / 3 * 256 // at["cell_px"]
        cells.add((cu, cv))
        assert at["positions"][f[0]] == pos[faces[t][0]]
    assert len(cells) == len(faces)
    with pytest.raises(ValueError, match="too small"):
        s4b.triangle_atlas(pos, faces, 32)


# --- z-buffer and visibility ------------------------------------------------------------------------


def test_zbuffer_depth_matches_projection(cams):
    c, K, w2cs = cams
    pos, faces = quad(0.0)
    zb = s4b.rasterize_depth(pos, faces, K, w2cs[0], c["width"], c["height"])
    u, v, z = lib.project(K, w2cs[0], (0.0, 1.0, 0.0))
    d = zb[int(v) * c["width"] + int(u)]
    assert abs(d - z) < 0.01
    assert sum(1 for x in zb if x < math.inf) > 20
    # The back camera sees the same quad (from behind) at the same distance.
    zb_back = s4b.rasterize_depth(pos, faces, K, w2cs[4], c["width"], c["height"])
    assert sum(1 for x in zb_back if x < math.inf) > 20


def test_visibility_occlusion_grazing_and_mask(cams):
    c, K, w2cs = cams
    W, H = c["width"], c["height"]
    front_pos, front_faces = quad(0.1)
    back_pos, back_faces = quad(-0.1)
    pos = front_pos + back_pos
    faces = front_faces + [(a + 4, b + 4, d + 4) for a, b, d in back_faces]
    view = s4b.View("front", solid(W, H, RED), [1] * (W * H), W, H, K, w2cs[0])
    view.prepare(pos, faces)
    n = (0.0, 0.0, 1.0)
    assert s4b.visibility(view, (0.0, 1.0, 0.1), n, min_cos=0.2, depth_eps_m=0.01) is not None
    assert s4b.visibility(view, (0.0, 1.0, -0.1), n, min_cos=0.2, depth_eps_m=0.01) is None  # behind the front quad
    assert s4b.visibility(view, (0.0, 1.0, 0.1), (1.0, 0.0, 0.0), min_cos=0.2, depth_eps_m=0.01) is None  # grazing
    masked = s4b.View("front", solid(W, H, RED), [0] * (W * H), W, H, K, w2cs[0])
    masked.prepare(pos, faces)
    assert s4b.visibility(masked, (0.0, 1.0, 0.1), n, min_cos=0.2, depth_eps_m=0.01) is None
    # The back camera sees the back quad, not the front one.
    back = s4b.View("back", solid(W, H, BLUE), None, W, H, K, w2cs[4])
    back.prepare(pos, faces)
    assert s4b.visibility(back, (0.0, 1.0, -0.1), n, min_cos=0.2, depth_eps_m=0.01) is not None
    assert s4b.visibility(back, (0.0, 1.0, 0.1), n, min_cos=0.2, depth_eps_m=0.01) is None


def test_sample_bilinear_uses_pixel_corner_origin():
    rgb = bytearray([0, 0, 0, 100, 100, 100])  # 2x1: black, grey
    assert s4b.sample_bilinear(rgb, 2, 1, 0.5, 0.5) == (0.0, 0.0, 0.0)
    assert s4b.sample_bilinear(rgb, 2, 1, 1.0, 0.5) == (50.0, 50.0, 50.0)
    assert s4b.sample_bilinear(rgb, 2, 1, 1.5, 0.5) == (100.0, 100.0, 100.0)


# --- projection and fill on a cylinder -------------------------------------------------------------


def _cylinder_views(cams, front=RED, back=BLUE):
    c, K, w2cs = cams
    W, H = c["width"], c["height"]
    return [s4b.View("front", solid(W, H, front), None, W, H, K, w2cs[0]), s4b.View("back", solid(W, H, back), None, W, H, K, w2cs[4])]


def test_cylinder_front_takes_the_front_still_back_the_back_and_sides_are_filled(cams):
    pos, faces = cylinder()
    res = s4b.retexture_core({"positions": pos, "faces": faces, "uvs": None}, _cylinder_views(cams), texture_size=256, min_cos=0.2, depth_eps_m=0.01)
    assert res["uv_source"] == "stage4b-triangle-atlas"
    cov = res["coverage"]
    assert 0.5 < cov["seen_share"] < 0.95, cov
    assert abs(cov["seen_share"] + cov["filled_share"] - 1.0) < 1e-6
    assert cov["seen_by"]["front"] > 0 and cov["seen_by"]["back"] > 0
    assert cov["fill"]["mean"] == 0
    tex, tm, size = res["texture"], res["mesh"], 256

    def colour_at_face(t):
        us = [tm["uvs"][k] for k in tm["faces"][t]]
        u = sum(a for a, _ in us) / 3 * 0.66 + us[0][0] * 0.34  # inside the triangle, near its right angle
        v = sum(b for _, b in us) / 3 * 0.66 + us[0][1] * 0.34
        i = int(v * size) * size + int(u * size)
        return tuple(tex[i * 3: i * 3 + 3])

    seg = 32
    # Ring 1, segment s covers angle 360*s/32 .. 360*(s+1)/32; faces 2*(seg + s) and +1.
    front = colour_at_face(2 * (seg + 0))
    back = colour_at_face(2 * (seg + 16))
    assert front == RED and back == BLUE
    # The side just past +90 deg (towards the back) mirrors the back print; just before, the front.
    assert colour_at_face(2 * (seg + 7)) == RED
    assert colour_at_face(2 * (seg + 9)) == BLUE
    assert res["base_color_hex"] is not None


def test_mesh_uvs_from_stage4_are_used_as_given(cams):
    pos, faces = quad(0.0)
    uvs = [(0.0, 1.0), (1.0, 1.0), (1.0, 0.0), (0.0, 0.0)]
    res = s4b.retexture_core({"positions": pos, "faces": faces, "uvs": uvs}, _cylinder_views(cams), texture_size=64, min_cos=0.2, depth_eps_m=0.01)
    assert res["uv_source"] == "stage4"
    assert res["coverage"]["seen_share"] > 0.9
    # Seen from both sides: a flat quad faces front and back; weights are |cos|, so purple-ish.
    assert res["coverage"]["seen_by_both"] > 0


def test_mirror_source_continues_the_pattern():
    row = [None] * 12
    for i in range(4):
        row[i] = (i * 10, 0, 0)
    assert s4b.mirror_source(row, 2) == (2, "seen")
    assert s4b.mirror_source(row, 4) == (2, "mirror")  # nearest seen 3, distance 1 -> 2
    assert s4b.mirror_source(row, 5) == (1, "mirror")  # nearest 3, distance 2 -> 1
    assert s4b.mirror_source(row, 11) == (1, "mirror")  # circular: nearest 0, distance 1 -> 1
    # Nearest 3 at distance 4: -1 = 11 is empty, walking back towards 3 finds 0.
    assert s4b.mirror_source(row, 7) == (0, "mirror")
    sparse = [None] * 12
    sparse[0], sparse[3] = (1, 1, 1), (3, 3, 3)
    assert s4b.mirror_source(sparse, 4) == (3, "nearest")  # 2 and 1 are empty, back to 3 itself
    assert s4b.mirror_source([None] * 5, 2) is None


def test_fill_mirrors_a_gradient_across_the_seen_boundary():
    """Seen texels on a ring from 0 to 60 deg carry a gradient; texels at 60 + d take the colour at 60 - d."""
    size, bins = 64, 360
    points, state, unseen = {}, bytearray(size * size), []
    tex = bytearray(size * size * 3)
    for k in range(120):
        deg = k + 0.5
        i = k
        points[i] = (0.2 * math.sin(math.radians(deg)), 1.0, 0.2 * math.cos(math.radians(deg)))
        if deg < 60:
            tex[i * 3: i * 3 + 3] = bytes((int(deg * 4), 0, 0))
            state[i] = s4b.SEEN
        else:
            unseen.append(i)
    fill = s4b.fill_unseen({"texture": tex, "state": state, "points": points, "unseen": unseen}, size, theta_bins=bins, y_bin_m=0.01)
    assert fill["mirror"] == 60 and fill["mean"] == 0
    for d in (1, 10, 40):
        i = 59 + d  # at 59.5 + d deg
        mirrored = 59 - d + 1  # at 60.5 - d deg
        assert tex[i * 3] == tex[(mirrored - 1) * 3], d
    assert all(state[i] == s4b.FILLED for i in unseen)


def test_dilate_spreads_into_unused_texels():
    size = 4
    tex = bytearray(size * size * 3)
    state = bytearray(size * size)
    tex[0:3] = bytes((9, 8, 7))
    state[0] = s4b.SEEN
    s4b.dilate_texture(tex, state, size, iterations=1)
    assert tuple(tex[3:6]) == (9, 8, 7) and tuple(tex[size * 3: size * 3 + 3]) == (9, 8, 7)
    assert tuple(tex[5 * 3: 5 * 3 + 3]) == (0, 0, 0)
    assert state[1] == s4b.UNUSED


# --- inputs, records, cost ---------------------------------------------------------------------------


def test_same_cameras_check(cams):
    c, _, _ = cams
    assert s4b.check_same_cameras(c, c, s4b.front_back_frames(c)) == []
    other = json.loads(json.dumps(c))
    other["frames"][4]["w2c"][0][3] += 0.01
    other["width"] = 65
    problems = s4b.check_same_cameras(c, other, (0, 4))
    assert any("width" in p for p in problems) and any("frame 4" in p for p in problems)
    assert s4b.front_back_frames(c) == (0, 4)


def test_turntable_axis_is_the_mean_camera_centre(cams):
    c, _, _ = cams
    ax, az = s4b.turntable_axis_xz(c)
    # The exporter's turntable orbits the mannequin's vertical axis (x = z = 0 in mannequin space).
    assert abs(ax) < 1e-3 and abs(az) < 1e-3
    # Shift every camera by (dx, dz) in the world: the axis follows (w2c translation t' = t - R @ d).
    dx, dz = 0.3, -0.2
    moved = json.loads(json.dumps(c))
    for fr in moved["frames"]:
        R = [row[:3] for row in fr["w2c"][:3]]
        for i in range(3):
            fr["w2c"][i][3] -= R[i][0] * dx + R[i][2] * dz
    mx, mz = s4b.turntable_axis_xz(moved)
    assert abs(mx - (ax + dx)) < 1e-6 and abs(mz - (az + dz)) < 1e-6


def test_a_real_variant_without_a_garment_mask_is_refused_unless_allowed():
    assert s4b.mask_check({"front": True, "back": True}, False) == []
    with pytest.raises(ValueError, match="no stage 1b garment mask for back.*--allow-missing-mask"):
        s4b.mask_check({"front": True, "back": False}, False)
    warnings = s4b.mask_check({"front": False, "back": False}, True)
    assert len(warnings) == 1 and "front, back" in warnings[0] and "bake into the texture" in warnings[0]
    src = open(os.path.join(MODAL_DIR, "stage4b_retexture.py"), encoding="utf-8").read()
    assert '"warnings": warnings' in src and "axis_xz=axis_xz" in src and '"axis_xz": [0.0, 0.0]' not in src


def test_synthetic_variant_rotates_channels_and_stripes_inside_the_mask_only():
    w, h = 30, 2
    rgb = bytearray(bytes((200, 100, 50)) * (w * h))
    mask = [1 if x < 20 else 0 for _ in range(h) for x in range(w)]
    out = s4b.synthetic_variant_still(rgb, mask, w, h, period_px=4)
    assert tuple(out[0:3]) == (50, 200, 100)
    assert tuple(out[4 * 3: 5 * 3]) == (round(50 * 0.45), round(200 * 0.45), round(100 * 0.45))
    assert tuple(out[25 * 3: 26 * 3]) == (200, 100, 50)


def test_variant_material_and_index():
    ref = {"format": "curtain.garment.material", "formatVersion": 1, "productId": "ref-1", "baseColorHex": "#111111", "weightGsm": 230}
    m = s4b.variant_material(ref, variant_id="v-1", family_id="tops/x", base_color_hex="#aa0000", coverage={"seen_share": 0.7}, uv_source="stage4")
    assert m["weightGsm"] == 230 and m["baseColorHex"] == "#aa0000" and m["baseColorTexture"] == "texture.png"
    assert m["variant"]["referenceProductId"] == "ref-1" and "estimate" in m["variant"]["label"]
    assert ref["baseColorHex"] == "#111111"  # the reference is not modified
    idx = s4b.update_variants_index(None, {"id": "v-2", "texture": "a"})
    idx = s4b.update_variants_index(idx, {"id": "v-1", "texture": "b"})
    idx = s4b.update_variants_index(idx, {"id": "v-2", "texture": "c"})
    assert [v["id"] for v in idx["variants"]] == ["v-1", "v-2"] and idx["variants"][1]["texture"] == "c"
    assert idx["format"] == s4b.VARIANTS_FORMAT


def test_cost_record_cpu_and_gpu():
    cpu = s4b.cost("v-1", {"gpu": None, "region": "eu"}, 42.0, 60.0)
    assert cpu["estimate"] is True and cpu["usd_estimate_low"] is None and cpu["cpu_seconds"] == 42.0
    table = lib.format_cost_table([cpu])
    assert "stage4b_retexture[v-1]" in table
    gpu = s4b.cost("v-1", {"gpu": "L4", "region": "eu"}, 3600.0)
    assert gpu["usd_estimate_low"] == round(0.80 * 1.15, 4)


def test_settings_validate_the_timeout():
    assert s4b.settings({})["gpu"] is None
    assert s4b.settings({"CURTAIN_MODAL_GPU_RETEXTURE": "L4"})["gpu"] == "L4"
    with pytest.raises(ValueError):
        s4b.settings({"CURTAIN_MODAL_TIMEOUT_RETEXTURE": "5"})


# --- static checks ---------------------------------------------------------------------------------


def test_no_generative_model_in_stage4b():
    """Stage 4b only projects real pixels: no video, diffusion or try-on model may be imported or installed."""
    src = open(os.path.join(MODAL_DIR, "stage4b_retexture.py"), encoding="utf-8").read()
    tree = ast.parse(src)
    imported = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    imported |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    assert not imported & {"torch", "diffusers", "transformers", "videox_fun", "fashn_vton", "gsplat"}
    installs = [c for c in ast.walk(tree) if isinstance(c, ast.Call) and getattr(c.func, "attr", "") in ("pip_install", "uv_pip_install")]
    pins = [a.value for c in installs for a in c.args if isinstance(a, ast.Constant)]
    assert pins == ["pillow==11.3.0"]


def test_modal_app_registers_retexture():
    pytest.importorskip("modal")
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        names = set(s4b.app.registered_functions)
    assert "retexture" in names
