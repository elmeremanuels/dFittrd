"""The GPU-free half of stage 4: depth fusion, mannequin removal, cleanup, decimation, metrics, .glb.

Needs numpy, scipy, Open3D and trimesh (imported inside the functions), never Modal or a GPU, so it
runs inside the stage 4 container and in local tests (tests/test_phase0_mesh.py, skipped when Open3D
is not installed). Units are metres in mannequin space; cameras are the exporter's K (pixel-corner
origin) and OpenCV world-to-camera matrices.
"""
from __future__ import annotations

from typing import Any, Sequence

import phase0_lib as lib


def foreground_mask(rgb, threshold: float = 0.1):
    """Foreground of a float RGB frame (0..1): differs from the median border colour; opened, closed,
    holes filled, largest component kept. A stand-in for stage 3 on generated frames."""
    import numpy as np
    from scipy import ndimage

    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    bg = np.median(border, axis=0)
    fg = np.abs(rgb - bg).max(axis=2) > threshold
    fg = ndimage.binary_opening(fg, iterations=1)
    fg = ndimage.binary_closing(fg, iterations=2)
    fg = ndimage.binary_fill_holes(fg)
    lab, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, lab, range(1, n + 1))
        fg = lab == (1 + int(np.argmax(sizes)))
    return fg.astype(np.float32)


def fuse_tsdf(depths: Sequence[Any], colors: Sequence[Any] | None, K: Sequence[Sequence[float]], w2cs: Sequence[Sequence[Sequence[float]]], width: int, height: int, voxel_cm: float = 0.4):
    """TSDF fusion of metric depth maps (metres, 0 = no data) into a triangle mesh (Open3D legacy)."""
    import numpy as np
    import open3d as o3d

    volume = o3d.pipelines.integration.ScalableTSDFVolume(
        voxel_length=voxel_cm / 100.0,
        sdf_trunc=4 * voxel_cm / 100.0,
        color_type=o3d.pipelines.integration.TSDFVolumeColorType.RGB8,
    )
    k = lib.k_integer_centres(K)  # Open3D puts the centre of pixel (0,0) at (0,0)
    intr = o3d.camera.PinholeCameraIntrinsic(width, height, k[0][0], k[1][1], k[0][2], k[1][2])
    for i, depth in enumerate(depths):
        color = colors[i] if colors is not None else np.full((height, width, 3), 128, dtype=np.uint8)
        rgbd = o3d.geometry.RGBDImage.create_from_color_and_depth(
            o3d.geometry.Image(np.ascontiguousarray(color, dtype=np.uint8)),
            o3d.geometry.Image(np.ascontiguousarray(depth, dtype=np.float32)),
            depth_scale=1.0, depth_trunc=20.0, convert_rgb_to_intensity=False,
        )
        volume.integrate(rgbd, intr, np.asarray(w2cs[i], dtype=np.float64))
    return volume.extract_triangle_mesh()


def remove_near_surface(mesh, surface_path: str, remove_cm: float):
    """Drops vertices inside, or within `remove_cm` of, the mesh at `surface_path` (the mannequin).
    Returns the number of vertices removed."""
    import numpy as np
    import open3d as o3d

    if not len(mesh.vertices):
        return 0
    scene = o3d.t.geometry.RaycastingScene()
    scene.add_triangles(o3d.t.geometry.TriangleMesh.from_legacy(o3d.io.read_triangle_mesh(surface_path)))
    sd = scene.compute_signed_distance(o3d.core.Tensor(np.asarray(mesh.vertices, dtype=np.float32))).numpy()
    drop = sd < remove_cm / 100.0
    mesh.remove_vertices_by_mask(drop)
    return int(drop.sum())


def clean_and_decimate(mesh, target_triangles: int | None = None, min_cluster_share: float = 0.01):
    """Removes degenerate and duplicate parts, non-manifold edges and small islands, then decimates to
    the triangle budget (8-15k, default 12k). Returns the new mesh."""
    import numpy as np

    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()
    if len(mesh.triangles):
        clusters, counts, _ = mesh.cluster_connected_triangles()
        clusters, counts = np.asarray(clusters), np.asarray(counts)
        mesh.remove_triangles_by_mask(counts[clusters] < min_cluster_share * len(clusters))
        mesh.remove_unreferenced_vertices()
    target = lib.triangle_target(target_triangles)
    if len(mesh.triangles) > target:
        mesh = mesh.simplify_quadric_decimation(target_number_of_triangles=target)
        mesh.remove_degenerate_triangles()
        mesh.remove_unreferenced_vertices()
    mesh.compute_vertex_normals()
    return mesh


def mesh_report(mesh) -> dict[str, Any]:
    import numpy as np

    v = np.asarray(mesh.vertices)
    n = len(mesh.triangles)
    return {
        "triangles": int(n),
        "vertices": int(len(v)),
        "budget": list(lib.TRIANGLE_BUDGET),
        "within_budget": lib.TRIANGLE_BUDGET[0] <= n <= lib.TRIANGLE_BUDGET[1],
        "watertight": bool(mesh.is_watertight()) if n else False,
        "edge_manifold": bool(mesh.is_edge_manifold()) if n else False,
        "bbox_m": [np.round(v.min(axis=0), 4).tolist(), np.round(v.max(axis=0), 4).tolist()] if len(v) else None,
    }


def compare_to_truth(mesh, truth_path: str, samples: int = 50000, seed: int = 0) -> dict[str, Any]:
    """Symmetric surface distance (cm) and F-score between `mesh` and the truth mesh."""
    import numpy as np
    import open3d as o3d

    o3d.utility.random.seed(seed)
    gt = o3d.io.read_triangle_mesh(truth_path)
    d1 = np.asarray(mesh.sample_points_uniformly(samples).compute_point_cloud_distance(gt.sample_points_uniformly(samples))) * 100
    d2 = np.asarray(gt.sample_points_uniformly(samples).compute_point_cloud_distance(mesh.sample_points_uniformly(samples))) * 100

    def fscore(t: float) -> float:
        p, r = float((d1 < t).mean()), float((d2 < t).mean())
        return 2 * p * r / max(p + r, 1e-9)

    stats = lambda d: {"mean": round(float(d.mean()), 3), "p95": round(float(np.percentile(d, 95)), 3), "max": round(float(d.max()), 3)}  # noqa: E731
    return {
        "chamfer_cm_mean": round(float((d1.mean() + d2.mean()) / 2), 3),
        "recon_to_truth_cm": stats(d1),
        "truth_to_recon_cm": stats(d2),
        "fscore_1cm": round(fscore(1.0), 4),
        "fscore_2cm": round(fscore(2.0), 4),
    }


def write_glb(mesh, path: str) -> int:
    """Writes the mesh (vertex colours if any) as .glb in metres. Returns the file size."""
    import os

    import numpy as np
    import trimesh

    vc = (np.asarray(mesh.vertex_colors) * 255).round().astype(np.uint8) if mesh.has_vertex_colors() else None
    tm = trimesh.Trimesh(vertices=np.asarray(mesh.vertices), faces=np.asarray(mesh.triangles), vertex_colors=vc, process=False)
    tm.export(path)
    return os.path.getsize(path)
