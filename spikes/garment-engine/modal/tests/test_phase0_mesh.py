"""Tests for phase0_mesh (the GPU-free half of stage 4). Skipped when numpy, scipy, Open3D or trimesh
is missing; install them with `pip install -r requirements-mesh-test.txt` (Python 3.10-3.12: Open3D
0.19.0 has no wheels for 3.13).

The key test fuses depth maps rendered with the exporter's camera conventions (K with the pixel-corner
origin, OpenCV world-to-camera from the fixture) and checks that Open3D puts the surface back where it
was: if the principal-point shift or the axis convention were wrong, the fused surface would be off.
"""
import json
import os
import sys

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("scipy")
o3d = pytest.importorskip("open3d")
trimesh = pytest.importorskip("trimesh")

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import phase0_lib as lib  # noqa: E402
import phase0_mesh as pmesh  # noqa: E402

CENTRE = np.array([0.0, 0.88, 0.0])  # the turntable look-at point (0.52 x stature), metres
RADIUS = 0.3


def sphere_depth(K, w2c, width, height, centre=CENTRE, radius=RADIUS):
    """Ray-traced depth (z along the optical axis, m) of a sphere; pixel centres at (i + 0.5) as in K's convention."""
    K, w2c = np.asarray(K, dtype=np.float64), np.asarray(w2c, dtype=np.float64)
    u, v = np.meshgrid(np.arange(width) + 0.5, np.arange(height) + 0.5)
    d_cam = np.stack([(u - K[0, 2]) / K[0, 0], (v - K[1, 2]) / K[1, 1], np.ones_like(u)], axis=-1)  # z = 1
    R, t = w2c[:3, :3], w2c[:3, 3]
    origin = -R.T @ t
    d_world = d_cam @ R  # R^T d for each row vector
    oc = origin - centre
    a = (d_world**2).sum(-1)
    b = 2 * (d_world @ oc)
    c = oc @ oc - radius**2
    disc = b * b - 4 * a * c
    s = (-b - np.sqrt(np.maximum(disc, 0))) / (2 * a)  # ray parameter = z because d_cam has z = 1
    return np.where(disc > 0, s, 0.0).astype(np.float32)


def cameras(width, height, frames=8):
    with open(os.path.join(HERE, "fixtures", "cameras_opencv.json")) as f:
        cams = json.load(f)
    K, w2cs = lib.poses_from_opencv(cams)
    scale = width / cams["width"]
    K = [[K[0][0] * scale, 0, width / 2], [0, K[1][1] * scale, height / 2], [0, 0, 1]]
    return K, [w2cs[i] for i in sorted(w2cs)][:frames]


def radial_error_cm(mesh, centre=CENTRE, radius=RADIUS):
    v = np.asarray(mesh.vertices)
    return float(np.abs(np.linalg.norm(v - centre, axis=1) - radius).mean() * 100)


def test_tsdf_fusion_with_the_exporter_cameras_recovers_the_surface():
    W, H = 128, 224
    K, w2cs = cameras(W, H)
    depths = [sphere_depth(K, w, W, H) for w in w2cs]
    assert all((d > 0).sum() > 500 for d in depths)
    mesh = pmesh.fuse_tsdf(depths, None, K, w2cs, W, H, voxel_cm=0.5)
    assert len(mesh.triangles) > 1000
    err = radial_error_cm(mesh)
    assert err < 0.35, f"fused surface is {err:.2f} cm off the sphere"
    # Sensitivity: the same depth fused with the wrong camera axes lands far away.
    wrong = [lib.opencv_w2c_to_opengl_c2w(w) for w in w2cs]
    bad = pmesh.fuse_tsdf(depths, None, K, wrong, W, H, voxel_cm=0.5)
    assert len(bad.triangles) == 0 or radial_error_cm(bad) > 5 * err


def test_remove_near_surface_keeps_only_what_is_outside_the_body(tmp_path):
    body = o3d.geometry.TriangleMesh.create_sphere(radius=0.2, resolution=40)
    body_path = str(tmp_path / "body.glb")
    trimesh.Trimesh(np.asarray(body.vertices), np.asarray(body.triangles)).export(body_path)
    skin = o3d.geometry.TriangleMesh.create_sphere(radius=0.2005, resolution=30)  # what TSDF makes of the bare body
    cloth = o3d.geometry.TriangleMesh.create_sphere(radius=0.23, resolution=30)  # 3 cm out
    both = skin + cloth
    n_cloth = len(cloth.vertices)
    removed = pmesh.remove_near_surface(both, body_path, remove_cm=0.6)
    assert removed == len(skin.vertices)
    assert len(both.vertices) == n_cloth


def test_clean_and_decimate_meets_the_triangle_budget_and_drops_islands():
    big = o3d.geometry.TriangleMesh.create_sphere(radius=0.3, resolution=120)
    speck = o3d.geometry.TriangleMesh.create_sphere(radius=0.005, resolution=4).translate((1.0, 0, 0))
    mesh = big + speck
    assert len(mesh.triangles) > 20000
    out = pmesh.clean_and_decimate(mesh, 12000)
    rep = pmesh.mesh_report(out)
    assert rep["within_budget"] and rep["triangles"] <= 12000
    assert rep["bbox_m"][1][0] < 0.31  # the speck at x = 1 m is gone
    assert pmesh.clean_and_decimate(o3d.geometry.TriangleMesh.create_sphere(radius=0.3, resolution=120), 99999).triangles.__len__() <= 15000


def test_compare_to_truth_and_glb_roundtrip(tmp_path):
    mesh = o3d.geometry.TriangleMesh.create_sphere(radius=0.3, resolution=60)
    mesh.compute_vertex_normals()
    path = str(tmp_path / "garment.glb")
    assert pmesh.write_glb(mesh, path) > 1000
    back = trimesh.load(path, force="mesh")
    assert len(back.faces) == len(mesh.triangles)
    assert np.allclose(back.bounds, [[-0.3, -0.3, -0.3], [0.3, 0.3, 0.3]], atol=1e-4)
    # Point sampling alone gives ~0.4 cm mean nearest-neighbour distance at 20k samples on this sphere.
    same = pmesh.compare_to_truth(mesh, path, samples=20000)
    assert same["chamfer_cm_mean"] < 0.6 and same["fscore_1cm"] > 0.95
    bigger = o3d.geometry.TriangleMesh.create_sphere(radius=0.32, resolution=60)
    off = pmesh.compare_to_truth(bigger, path, samples=20000)
    assert 1.8 < off["chamfer_cm_mean"] < 2.4 and off["fscore_1cm"] < 0.2


def test_foreground_mask_finds_the_figure_on_a_plain_background():
    rgb = np.full((120, 80, 3), 0.92, dtype=np.float32)
    rgb[20:100, 25:55] = [0.8, 0.2, 0.2]
    rgb[50:55, 35:40] = 0.92  # a hole the size of a button: filled
    rgb[5, 5] = [0.1, 0.1, 0.1]  # a speck: removed
    mask = pmesh.foreground_mask(rgb)
    truth = np.zeros((120, 80), dtype=np.float32)
    truth[20:100, 25:55] = 1
    assert (mask == truth).mean() > 0.995
