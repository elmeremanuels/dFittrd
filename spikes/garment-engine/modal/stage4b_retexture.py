"""Phase 0 stage 4b on Modal: re-texture a cut family's reference asset for one colour/print variant.

A shop sells one cut in many colours and prints (cut families: src/families.ts, data/bohohippychic/
families.json). The full pipeline (stage 1b -> 2 -> 4) runs once, for the family's reference member.
For every other member this app only swaps the print:

  1. load the reference's garment mesh (stage4/<source>/garment.glb, metres, mannequin space). If it has
     UVs (TEXCOORD_0) they are used; if not (stage 4 writes vertex colours only today) every triangle
     gets its own cell in a square atlas (`triangle_atlas`), written once as stage4b/<source>/garment_uv.glb
     and shared by all variants of the family
  2. take the variant's front and back stills ON OUR MANNEQUIN (stage1b/front.png, stage1b/back.png of
     the variant's own job, with stage1b/garment_mask_<view>.png), seen from the known turntable cameras
     at frame 0 and frame N/2 (cameras_opencv.json; the variant's cameras must equal the reference's)
  3. project: for every texel of the atlas, the 3D point on the mesh is projected into both cameras; it
     takes the still's colour (bilinear) where it is visible: inside the frame and the garment mask, not
     occluded (z-buffer of the mesh itself, `depth_eps_m`), and not seen at a grazing angle
     (|cos| >= `min_cos`). Where both views see it, the colours are blended by |cos|. Real pixels only
  4. fill what neither view sees (the sides) by continuing the print from the nearest seen texels: the
     seen texels are binned by angle around the turntable axis (the mean camera centre of
     cameras_opencv.json, `turntable_axis_xz`) and height; an unseen texel takes the
     colour MIRRORED across the nearest seen boundary in its height row (`mirror_source`), so stripes and
     motifs continue into the side instead of smearing. No generative fill, no video model
  5. write, into the reference job (the family's bundle), a variant entry:
       stage4b/<source>/variants/<variant_id>/texture.png     the baked texture (PNG, RGB)
       stage4b/<source>/variants/<variant_id>/material.json   the reference material + this texture + variant
       stage4b/<source>/variants/<variant_id>/preview.glb     garment + texture, for any glTF viewer
       stage4b/<source>/variants/<variant_id>/record.json     inputs (sha256), coverage, settings, cost
       stage4b/<source>/variants.json                         the bundle's variant index (one entry per variant)
       stage4b/<source>/garment_uv.glb                        only when the reference mesh had no UVs

Run (from the repo root), after the reference's stage 4 and the variant's stage 1b:
  modal run spikes/garment-engine/modal/stage4b_retexture.py --ref-job-dir <reference job> --source stage2 \
    --variant-job-dir <variant job> --variant-id <handle> --family-id <families.json id>
Dry run without a variant job: --synthetic-variant takes the reference job's synthetic stills, swaps the
colour channels and adds diagonal stripes inside the garment mask (a known print to check continuation).
Options: --texture-size 1024 --min-cos 0.2 --depth-eps-cm 1.0 --recon-if-missing --download-only --force-upload
         --allow-missing-mask (accept a variant without stage1b/garment_mask_<view>.png; refused by default,
         a warning in record.json when accepted)

Environment: CURTAIN_MODAL_GPU_RETEXTURE (default empty = CPU only; the projection is pure Python and
uses no GPU), CURTAIN_MODAL_REGION, CURTAIN_MODAL_TIMEOUT_RETEXTURE (s, default 1800).
Every texture is an ESTIMATE (AGENTS.md rule 3): the sides are filled, not observed.

NOT TESTED on Modal: the build container cannot reach Modal. The pure helpers below (GLB I/O, atlas,
projection, visibility, fill, records) are tested by tests/test_stage4b_retexture.py on a synthetic quad
and cylinder with the exporter's cameras.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import struct
import sys
import time
from typing import Any, Callable, Mapping, Sequence

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import phase0_lib as lib  # noqa: E402

Vec3 = tuple[float, float, float]
Mat = list[list[float]]

STAGE4B_DIR = "stage4b"
MATERIAL_FORMAT = "curtain.garment.material"
VARIANTS_FORMAT = "curtain.garment.variants"
ESTIMATE_LABEL = "re-textured from the variant's front and back stills; the sides are filled by mirroring the nearest seen print: an estimate, not a measurement (AGENTS.md rule 3)"
DEFAULTS = {"texture_size": 1024, "min_cos": 0.2, "depth_eps_m": 0.01, "theta_bins": 720, "y_bin_m": 0.005, "pad_px": 1}

# ---------------------------------------------------------------------------
# GLB (glTF 2.0 binary): read positions/indices/uvs, write mesh + uvs + texture
# ---------------------------------------------------------------------------

_COMPONENT = {5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2), 5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4)}
_NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
MAX_GLB_BYTES = 256 * 1024 * 1024


class GlbError(ValueError):
    """The .glb is malformed or uses a feature this reader does not support."""


def _accessor(gltf: Mapping[str, Any], binary: bytes, index: int) -> list[tuple]:
    acc = gltf["accessors"][index]
    if "sparse" in acc:
        raise GlbError("sparse accessors are not supported")
    fmt, size = _COMPONENT[acc["componentType"]]
    n = _NCOMP[acc["type"]]
    count = int(acc["count"])
    if "bufferView" not in acc:
        return [tuple([0] * n)] * count
    view = gltf["bufferViews"][acc["bufferView"]]
    if view.get("buffer", 0) != 0:
        raise GlbError("only the GLB's own binary buffer is supported")
    start = int(view.get("byteOffset", 0)) + int(acc.get("byteOffset", 0))
    stride = int(view.get("byteStride", 0)) or n * size
    end = start + stride * (count - 1) + n * size if count else start
    if end > len(binary) or end > int(view.get("byteOffset", 0)) + int(view["byteLength"]):
        raise GlbError(f"accessor {index} runs past its buffer view")
    unpack = struct.Struct("<" + fmt * n).unpack_from
    return [unpack(binary, start + i * stride) for i in range(count)]


def _node_matrix(node: Mapping[str, Any]) -> Mat:
    if "matrix" in node:
        m = node["matrix"]  # column-major
        return [[m[c * 4 + r] for c in range(4)] for r in range(4)]
    tx, ty, tz = node.get("translation", (0.0, 0.0, 0.0))
    qx, qy, qz, qw = node.get("rotation", (0.0, 0.0, 0.0, 1.0))
    sx, sy, sz = node.get("scale", (1.0, 1.0, 1.0))
    r = [
        [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qz * qw), 2 * (qx * qz + qy * qw)],
        [2 * (qx * qy + qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qx * qw)],
        [2 * (qx * qz - qy * qw), 2 * (qy * qz + qx * qw), 1 - 2 * (qx * qx + qy * qy)],
    ]
    return [[r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, tx], [r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, ty], [r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, tz], [0.0, 0.0, 0.0, 1.0]]


def read_glb(data: bytes) -> dict[str, Any]:
    """Triangle mesh from a .glb: every mesh primitive (mode 4) under the default scene, with node
    transforms applied. Returns {positions, faces, uvs (None unless EVERY primitive has TEXCOORD_0)}."""
    if len(data) > MAX_GLB_BYTES:
        raise GlbError(f"{len(data)} bytes is more than the {MAX_GLB_BYTES} this reader accepts")
    if len(data) < 20 or data[:4] != b"glTF":
        raise GlbError("not a GLB")
    version, length = struct.unpack_from("<II", data, 4)
    if version != 2 or length > len(data):
        raise GlbError(f"GLB version {version}, length {length} of {len(data)} bytes")
    gltf: dict[str, Any] | None = None
    binary = b""
    off = 12
    while off + 8 <= length:
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if len(chunk) != clen:
            raise GlbError("truncated chunk")
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binary = chunk
        off += 8 + clen + (-clen % 4 if ctype == 0x4E4F534A and clen % 4 else 0)
    if gltf is None:
        raise GlbError("no JSON chunk")

    positions: list[Vec3] = []
    faces: list[tuple[int, int, int]] = []
    uvs: list[tuple[float, float]] | None = []

    def visit(node_index: int, parent: Mat) -> None:
        nonlocal uvs
        node = gltf["nodes"][node_index]
        m = lib.mat_mul(parent, _node_matrix(node))
        if "mesh" in node:
            for prim in gltf["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                base = len(positions)
                for p in _accessor(gltf, binary, prim["attributes"]["POSITION"]):
                    positions.append(tuple(m[r][0] * p[0] + m[r][1] * p[1] + m[r][2] * p[2] + m[r][3] for r in range(3)))  # type: ignore[misc]
                n = len(positions) - base
                tex = prim["attributes"].get("TEXCOORD_0")
                if tex is None or uvs is None:
                    uvs = None
                else:
                    acc = gltf["accessors"][tex]
                    if acc["componentType"] != 5126:
                        raise GlbError("normalised integer TEXCOORD_0 is not supported")
                    uvs.extend((float(a), float(b)) for a, b in _accessor(gltf, binary, tex))
                idx = [i[0] for i in _accessor(gltf, binary, prim["indices"])] if "indices" in prim else list(range(n))
                if len(idx) % 3:
                    raise GlbError("index count is not a multiple of 3")
                for k in range(0, len(idx), 3):
                    a, b, c = idx[k], idx[k + 1], idx[k + 2]
                    if max(a, b, c) >= n:
                        raise GlbError("index out of range")
                    faces.append((base + a, base + b, base + c))
        for child in node.get("children", []):
            visit(child, m)

    identity = [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]
    scene = gltf.get("scenes", [{}])[gltf.get("scene", 0)] if gltf.get("scenes") else {"nodes": list(range(len(gltf.get("nodes", []))))}
    for ni in scene.get("nodes", []):
        visit(ni, identity)
    if not faces:
        raise GlbError("no triangles")
    return {"positions": positions, "faces": faces, "uvs": uvs if uvs else None}


def _pad4(b: bytes, fill: bytes = b"\x00") -> bytes:
    return b + fill * (-len(b) % 4)


def write_glb(positions: Sequence[Sequence[float]], faces: Sequence[Sequence[int]], uvs: Sequence[Sequence[float]] | None = None,
              texture_png: bytes | None = None, *, name: str = "garment", generator: str = "curtain stage4b_retexture") -> bytes:
    """Mesh as .glb: POSITION (+ TEXCOORD_0), uint32 indices, and when `texture_png` is given a PBR
    material whose baseColorTexture is that PNG (embedded). Units as given (metres)."""
    nv = len(positions)
    if uvs is not None and len(uvs) != nv:
        raise ValueError(f"{len(uvs)} uvs for {nv} vertices")
    pos_b = b"".join(struct.pack("<3f", *p) for p in positions)
    idx_b = b"".join(struct.pack("<3I", *f) for f in faces)
    blobs = [pos_b, idx_b]
    if uvs is not None:
        blobs.append(b"".join(struct.pack("<2f", *t) for t in uvs))
    if texture_png is not None:
        blobs.append(texture_png)
    views, offset, binary = [], 0, b""
    for blob in blobs:
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(blob)})
        padded = _pad4(blob)
        binary += padded
        offset += len(padded)
    lo = [min(p[i] for p in positions) for i in range(3)]
    hi = [max(p[i] for p in positions) for i in range(3)]
    views[0]["target"] = 34962
    views[1]["target"] = 34963
    accessors = [
        {"bufferView": 0, "componentType": 5126, "count": nv, "type": "VEC3", "min": lo, "max": hi},
        {"bufferView": 1, "componentType": 5125, "count": 3 * len(faces), "type": "SCALAR"},
    ]
    attributes: dict[str, int] = {"POSITION": 0}
    if uvs is not None:
        views[2]["target"] = 34962
        accessors.append({"bufferView": 2, "componentType": 5126, "count": nv, "type": "VEC2"})
        attributes["TEXCOORD_0"] = 2
    prim: dict[str, Any] = {"attributes": attributes, "indices": 1, "mode": 4}
    gltf: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": generator},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [prim]}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(binary)}],
    }
    if texture_png is not None:
        gltf["images"] = [{"bufferView": len(views) - 1, "mimeType": "image/png"}]
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]
        gltf["textures"] = [{"sampler": 0, "source": 0}]
        gltf["materials"] = [{"name": f"{name}-variant", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0.0, "roughnessFactor": 0.9}, "doubleSided": True}]
        prim["material"] = 0
    js = _pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    total = 12 + 8 + len(js) + 8 + len(binary)
    return b"glTF" + struct.pack("<II", 2, total) + struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binary), 0x004E4942) + binary


def glb_texture(data: bytes) -> bytes | None:
    """The first embedded image of a .glb written by `write_glb` (for tests and checks)."""
    clen = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20: 20 + clen].decode("utf-8"))
    if not gltf.get("images"):
        return None
    view = gltf["bufferViews"][gltf["images"][0]["bufferView"]]
    boff = 20 + clen + 8
    return data[boff + view["byteOffset"]: boff + view["byteOffset"] + view["byteLength"]]


# ---------------------------------------------------------------------------
# UV atlas for a mesh without UVs: one cell per triangle
# ---------------------------------------------------------------------------


def triangle_atlas(positions: Sequence[Vec3], faces: Sequence[Sequence[int]], size: int, pad_px: int = DEFAULTS["pad_px"]) -> dict[str, Any]:
    """Unwelds the mesh (3 vertices per triangle) and gives triangle t the lower-left half of its own
    square cell in a ceil(sqrt(T)) x ceil(sqrt(T)) grid, inset by `pad_px` texels. Simple, overlap-free
    and deterministic: every variant of a family shares the layout. glTF UV convention: (0,0) is the
    top-left of the image, v grows downwards."""
    n = len(faces)
    if n == 0:
        raise ValueError("no triangles")
    cells = math.ceil(math.sqrt(n))
    cell = size / cells
    if cell < 2 * pad_px + 3:
        raise ValueError(f"texture {size} px is too small for {n} triangles ({cell:.1f} px per cell); raise --texture-size")
    out_pos: list[Vec3] = []
    out_faces: list[tuple[int, int, int]] = []
    out_uv: list[tuple[float, float]] = []
    for t, f in enumerate(faces):
        cx, cy = (t % cells) * cell, (t // cells) * cell
        x0, y0, x1, y1 = cx + pad_px, cy + pad_px, cx + cell - pad_px, cy + cell - pad_px
        corners = ((x0, y1), (x1, y1), (x0, y0))  # right angle at the cell's lower-left
        base = len(out_pos)
        for k in range(3):
            out_pos.append(tuple(positions[f[k]]))  # type: ignore[arg-type]
            out_uv.append((corners[k][0] / size, corners[k][1] / size))
        out_faces.append((base, base + 1, base + 2))
    return {"positions": out_pos, "faces": out_faces, "uvs": out_uv, "cells": cells, "cell_px": cell}


# ---------------------------------------------------------------------------
# Cameras, z-buffer, visibility
# ---------------------------------------------------------------------------


def _sub(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Sequence[float], b: Sequence[float]) -> Vec3:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _dot(a: Sequence[float], b: Sequence[float]) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a: Sequence[float]) -> Vec3:
    n = math.sqrt(_dot(a, a))
    return (0.0, 0.0, 0.0) if n == 0 else (a[0] / n, a[1] / n, a[2] / n)


def face_normal(positions: Sequence[Vec3], f: Sequence[int]) -> Vec3:
    a, b, c = positions[f[0]], positions[f[1]], positions[f[2]]
    return _unit(_cross(_sub(b, a), _sub(c, a)))


def rasterize_depth(positions: Sequence[Vec3], faces: Sequence[Sequence[int]], K: Sequence[Sequence[float]], w2c: Sequence[Sequence[float]], width: int, height: int, near: float = 0.05) -> list[float]:
    """Z-buffer (metres along the optical axis, inf = empty) of the mesh seen from one camera. K has the
    exporter's pixel-corner origin, so pixel (x, y) is sampled at (x + 0.5, y + 0.5). Depth is
    interpolated perspective-correctly (1/z linear in screen space)."""
    zbuf = [math.inf] * (width * height)
    proj = [lib.project(K, w2c, p) for p in positions]
    for f in faces:
        (u0, v0, z0), (u1, v1, z1), (u2, v2, z2) = proj[f[0]], proj[f[1]], proj[f[2]]
        if min(z0, z1, z2) <= near:
            continue
        area = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)
        if abs(area) < 1e-12:
            continue
        xa = max(0, int(math.floor(min(u0, u1, u2) - 0.5)))
        xb = min(width - 1, int(math.ceil(max(u0, u1, u2) - 0.5)))
        ya = max(0, int(math.floor(min(v0, v1, v2) - 0.5)))
        yb = min(height - 1, int(math.ceil(max(v0, v1, v2) - 0.5)))
        iz0, iz1, iz2 = 1 / z0, 1 / z1, 1 / z2
        for y in range(ya, yb + 1):
            py = y + 0.5
            for x in range(xa, xb + 1):
                px = x + 0.5
                w0 = ((u1 - px) * (v2 - py) - (u2 - px) * (v1 - py)) / area
                w1 = ((u2 - px) * (v0 - py) - (u0 - px) * (v2 - py)) / area
                w2 = 1.0 - w0 - w1
                if w0 < -1e-9 or w1 < -1e-9 or w2 < -1e-9:
                    continue
                z = 1.0 / (w0 * iz0 + w1 * iz1 + w2 * iz2)
                i = y * width + x
                if z < zbuf[i]:
                    zbuf[i] = z
    return zbuf


def sample_bilinear(rgb: Sequence[int], width: int, height: int, u: float, v: float) -> tuple[float, float, float]:
    """RGB at continuous pixel coordinates (pixel-corner origin: pixel x covers [x, x + 1))."""
    x = min(max(u - 0.5, 0.0), width - 1.0)
    y = min(max(v - 0.5, 0.0), height - 1.0)
    x0, y0 = int(x), int(y)
    x1, y1 = min(x0 + 1, width - 1), min(y0 + 1, height - 1)
    fx, fy = x - x0, y - y0
    out = []
    for c in range(3):
        a = rgb[(y0 * width + x0) * 3 + c] * (1 - fx) + rgb[(y0 * width + x1) * 3 + c] * fx
        b = rgb[(y1 * width + x0) * 3 + c] * (1 - fx) + rgb[(y1 * width + x1) * 3 + c] * fx
        out.append(a * (1 - fy) + b * fy)
    return out[0], out[1], out[2]


class View:
    """One still on our mannequin: colours, garment mask, camera, and the mesh's z-buffer from it."""

    def __init__(self, name: str, rgb: Sequence[int], mask: Sequence[int] | None, width: int, height: int, K: Sequence[Sequence[float]], w2c: Sequence[Sequence[float]]):
        if len(rgb) != width * height * 3:
            raise ValueError(f"view {name}: {len(rgb)} RGB bytes for {width}x{height}")
        if mask is not None and len(mask) != width * height:
            raise ValueError(f"view {name}: mask has {len(mask)} values for {width}x{height}")
        self.name, self.rgb, self.mask, self.width, self.height = name, rgb, mask, width, height
        self.K, self.w2c = K, w2c
        self.centre = lib.camera_centre(w2c)
        self.zbuf: list[float] = []

    def prepare(self, positions: Sequence[Vec3], faces: Sequence[Sequence[int]]) -> None:
        self.zbuf = rasterize_depth(positions, faces, self.K, self.w2c, self.width, self.height)


def visibility(view: View, p: Vec3, n: Vec3, *, min_cos: float, depth_eps_m: float) -> tuple[float, float, float] | None:
    """(u, v, weight) when point p with face normal n is seen in this view's still, else None.
    Seen = in front of the camera, inside the frame, inside the garment mask, the nearest surface at
    that pixel (z-buffer within depth_eps_m; a pixel the mesh does not cover counts as not seen), and not at a grazing angle (|cos| >= min_cos; |cos|
    because stage 4's open meshes do not promise an orientation)."""
    u, v, z = lib.project(view.K, view.w2c, p)
    if z <= 0 or not (0.0 <= u < view.width and 0.0 <= v < view.height):
        return None
    i = int(v) * view.width + int(u)
    if view.mask is not None and not view.mask[i]:
        return None
    # An empty z-buffer pixel (inf) means the point projects past the mesh's own silhouette at this
    # resolution: not trusted as seen.
    if not view.zbuf or view.zbuf[i] == math.inf or z > view.zbuf[i] + depth_eps_m:
        return None
    c = abs(_dot(n, _unit(_sub(view.centre, p))))
    if c < min_cos:
        return None
    return u, v, c


# ---------------------------------------------------------------------------
# Baking the texture: projection, then the fill
# ---------------------------------------------------------------------------

UNUSED, SEEN, FILLED = 0, 1, 2


def bake_projection(positions: Sequence[Vec3], faces: Sequence[Sequence[int]], uvs: Sequence[Sequence[float]], views: Sequence[View], size: int, *,
                    min_cos: float = DEFAULTS["min_cos"], depth_eps_m: float = DEFAULTS["depth_eps_m"]) -> dict[str, Any]:
    """Rasterises every triangle in UV space at texel centres; per texel the 3D point is projected into
    the views. Returns the texture (RGB bytearray, size*size*3), the state per texel (UNUSED outside
    every triangle, SEEN, or 0 for a texel inside a triangle that no view saw, listed in `unseen`), the
    3D point of every used texel and per-view counts."""
    for view in views:
        view.prepare(positions, faces)
    tex = bytearray(size * size * 3)
    state = bytearray(size * size)
    points: dict[int, Vec3] = {}
    unseen: list[int] = []
    counts = {"texels": 0, "seen": 0, "both": 0, **{f"seen_{v.name}": 0 for v in views}}
    for f in faces:
        a, b, c = (positions[k] for k in f)
        n = face_normal(positions, f)
        (s0, t0), (s1, t1), (s2, t2) = ((uvs[k][0] * size, uvs[k][1] * size) for k in f)
        area = (s1 - s0) * (t2 - t0) - (s2 - s0) * (t1 - t0)
        if abs(area) < 1e-12:
            continue
        xa, xb = max(0, int(math.floor(min(s0, s1, s2)))), min(size - 1, int(math.ceil(max(s0, s1, s2))))
        ya, yb = max(0, int(math.floor(min(t0, t1, t2)))), min(size - 1, int(math.ceil(max(t0, t1, t2))))
        for y in range(ya, yb + 1):
            py = y + 0.5
            for x in range(xa, xb + 1):
                px = x + 0.5
                w0 = ((s1 - px) * (t2 - py) - (s2 - px) * (t1 - py)) / area
                w1 = ((s2 - px) * (t0 - py) - (s0 - px) * (t2 - py)) / area
                w2 = 1.0 - w0 - w1
                if w0 < -1e-9 or w1 < -1e-9 or w2 < -1e-9:
                    continue
                i = y * size + x
                if i in points:
                    continue  # shared edge texel: the first triangle wins
                p = (w0 * a[0] + w1 * b[0] + w2 * c[0], w0 * a[1] + w1 * b[1] + w2 * c[1], w0 * a[2] + w1 * b[2] + w2 * c[2])
                points[i] = p
                counts["texels"] += 1
                acc, wsum, hits = [0.0, 0.0, 0.0], 0.0, 0
                for view in views:
                    vis = visibility(view, p, n, min_cos=min_cos, depth_eps_m=depth_eps_m)
                    if vis is None:
                        continue
                    col = sample_bilinear(view.rgb, view.width, view.height, vis[0], vis[1])
                    for k in range(3):
                        acc[k] += col[k] * vis[2]
                    wsum += vis[2]
                    hits += 1
                    counts[f"seen_{view.name}"] += 1
                if hits:
                    tex[i * 3: i * 3 + 3] = bytes(max(0, min(255, round(acc[k] / wsum))) for k in range(3))
                    state[i] = SEEN
                    counts["seen"] += 1
                    counts["both"] += hits > 1
                else:
                    unseen.append(i)
    return {"texture": tex, "state": state, "points": points, "unseen": unseen, "counts": counts}


def cylinder_bin(p: Sequence[float], axis_xz: Sequence[float], theta_bins: int, y0: float, y_bin_m: float) -> tuple[int, int]:
    """(angle bin, height bin) of a point around the vertical turntable axis through (x, z) = axis_xz.
    Angle 0 is the camera of frame 0 (+Z, the mannequin's front), growing towards +X."""
    th = math.atan2(p[0] - axis_xz[0], p[2] - axis_xz[1]) % (2 * math.pi)
    return min(theta_bins - 1, int(th / (2 * math.pi) * theta_bins)), max(0, int((p[1] - y0) / y_bin_m))


def mirror_source(row: Sequence[Any], i: int) -> tuple[int, str] | None:
    """For an empty bin i in a circular row, the bin to copy: the nearest filled bin i0 at distance d,
    then the bin at distance d beyond it (the pattern mirrored across the boundary). When that bin is
    empty (bins are finer than the texels, or the seen run is shorter than d), the first filled bin
    walking back from it towards i0. None when the row is empty. Ties go to the lower index side."""
    n = len(row)
    if row[i] is not None:
        return i, "seen"
    for d in range(1, n // 2 + 1):
        for i0, step in (((i - d) % n, -1), ((i + d) % n, 1)):
            if row[i0] is None:
                continue
            for back in range(d + 1):
                src = (i0 + step * (d - back)) % n
                if row[src] is not None:
                    return src, ("mirror" if src != i0 else "nearest")
    return None


def fill_unseen(bake: Mapping[str, Any], size: int, *, axis_xz: Sequence[float] = (0.0, 0.0), theta_bins: int = DEFAULTS["theta_bins"], y_bin_m: float = DEFAULTS["y_bin_m"]) -> dict[str, int]:
    """Fills the texels no view saw by continuing the print from the seen ones (in place).

    The seen texels' colours are averaged into a cylinder grid (angle around the turntable axis x
    height). An unseen texel looks in its own height row for the nearest seen angle and copies the
    colour mirrored across that boundary (`mirror_source`): the print continues into the side as its
    reflection, which keeps stripes and motifs continuous at the seam instead of smearing one colour.
    A row with nothing seen borrows the nearest row that has something; with nothing seen at all the
    texel gets the mean seen colour. Sleeves and legs share the torso's axis here: a simplification."""
    tex, state, points = bake["texture"], bake["state"], bake["points"]
    seen_idx = [i for i, p in points.items() if state[i] == SEEN]
    counts = {"seen": 0, "mirror": 0, "nearest": 0, "other_row": 0, "mean": 0}
    if not bake["unseen"]:
        return counts
    ys = [p[1] for p in points.values()]
    y0 = min(ys)
    rows_n = int((max(ys) - y0) / y_bin_m) + 1
    sums: dict[tuple[int, int], list[float]] = {}
    for i in seen_idx:
        key = cylinder_bin(points[i], axis_xz, theta_bins, y0, y_bin_m)
        s = sums.setdefault(key, [0.0, 0.0, 0.0, 0.0])
        for k in range(3):
            s[k] += tex[i * 3 + k]
        s[3] += 1
    grid: list[list[tuple[int, int, int] | None]] = [[None] * theta_bins for _ in range(rows_n)]
    for (ti, yi), s in sums.items():
        grid[yi][ti] = (round(s[0] / s[3]), round(s[1] / s[3]), round(s[2] / s[3]))
    rows_with = [r for r in range(rows_n) if any(c is not None for c in grid[r])]
    if seen_idx:
        mean = tuple(round(sum(tex[i * 3 + k] for i in seen_idx) / len(seen_idx)) for k in range(3))
    else:
        mean = (128, 128, 128)
    for i in bake["unseen"]:
        ti, yi = cylinder_bin(points[i], axis_xz, theta_bins, y0, y_bin_m)
        colour = None
        if rows_with:
            row_i = yi if any(c is not None for c in grid[yi]) else min(rows_with, key=lambda r: (abs(r - yi), r))
            src = mirror_source(grid[row_i], ti)
            if src is not None:
                colour = grid[row_i][src[0]]
                counts["other_row" if row_i != yi else src[1]] += 1
        if colour is None:
            colour = mean
            counts["mean"] += 1
        tex[i * 3: i * 3 + 3] = bytes(colour)
        state[i] = FILLED
    return counts


def dilate_texture(tex: bytearray, state: bytearray, size: int, iterations: int = 2) -> None:
    """Spreads used texels into UNUSED neighbours (in place), so texture filtering at triangle edges
    does not pull in black. Dilated texels stay UNUSED in `state`."""
    used = bytearray(1 if s != UNUSED else 0 for s in state)
    for _ in range(iterations):
        new = []
        for i in range(size * size):
            if used[i]:
                continue
            x, y = i % size, i // size
            for j in (i - 1 if x > 0 else -1, i + 1 if x < size - 1 else -1, i - size if y > 0 else -1, i + size if y < size - 1 else -1):
                if j >= 0 and used[j]:
                    new.append((i, j))
                    break
        for i, j in new:
            tex[i * 3: i * 3 + 3] = tex[j * 3: j * 3 + 3]
            used[i] = 1


def mean_colour_hex(tex: Sequence[int], state: Sequence[int]) -> str | None:
    """Mean colour of the SEEN texels, as #rrggbb (the variant's baseColorHex)."""
    s, n = [0, 0, 0], 0
    for i, st in enumerate(state):
        if st == SEEN:
            for k in range(3):
                s[k] += tex[i * 3 + k]
            n += 1
    return None if not n else "#" + "".join(f"{round(v / n):02x}" for v in s)


# ---------------------------------------------------------------------------
# Inputs and records
# ---------------------------------------------------------------------------


def front_back_frames(cameras: Mapping[str, Any]) -> tuple[int, int]:
    """Frame 0 (front) and N/2 (back) of the turntable, the frames stage 2 pins and stage 1b dresses."""
    n = len(cameras["frames"])
    return 0, n // 2


def turntable_axis_xz(cameras: Mapping[str, Any]) -> tuple[float, float]:
    """The vertical turntable axis (x, z) as the mean camera centre over all turntable frames (metres,
    the cameras' world frame). A full orbit around the axis averages to it, so the fill no longer
    assumes the axis passes through the origin."""
    _, w2cs = lib.poses_from_opencv(cameras)
    if not w2cs:
        raise ValueError("cameras_opencv.json has no frames")
    cs = [lib.camera_centre(m) for m in w2cs.values()]
    return round(sum(c[0] for c in cs) / len(cs), 6), round(sum(c[2] for c in cs) / len(cs), 6)


def mask_check(masks: Mapping[str, bool], allow_missing: bool) -> list[str]:
    """Warnings for a real variant's stage 1b garment masks (front, back). Without a mask, skin, hair or
    mannequin colour in the still bakes into the texture (the z-buffer holds only the garment mesh), so a
    missing mask is refused unless `allow_missing` (--allow-missing-mask); then it is a warning in record.json."""
    missing = [name for name, ok in masks.items() if not ok]
    if not missing:
        return []
    msg = f"no stage 1b garment mask for {', '.join(missing)}: pixels outside the garment (skin, mannequin, background) can bake into the texture"
    if not allow_missing:
        raise ValueError(f"{msg}; re-run stage 1b on the variant job, or pass --allow-missing-mask to accept it (recorded as a warning)")
    return [msg]


def check_same_cameras(ref: Mapping[str, Any], var: Mapping[str, Any], frames: Sequence[int], tol: float = 1e-6) -> list[str]:
    """Reasons the variant's stills were not shot from the reference's cameras (empty = same)."""
    problems = []
    for k in ("width", "height"):
        if ref.get(k) != var.get(k):
            problems.append(f"{k}: reference {ref.get(k)}, variant {var.get(k)}")
    if lib.max_abs_diff(ref["K"], var["K"]) > tol:
        problems.append("K differs")
    _, rw = lib.poses_from_opencv(ref)
    _, vw = lib.poses_from_opencv(var)
    for f in frames:
        if f not in rw or f not in vw:
            problems.append(f"frame {f} missing")
        elif lib.max_abs_diff(rw[f], vw[f]) > tol:
            problems.append(f"frame {f} pose differs")
    return problems


def synthetic_variant_still(rgb: Sequence[int], mask: Sequence[int], width: int, height: int, period_px: int = 12) -> bytearray:
    """A known print for a dry run: inside the garment mask the colour channels are rotated (R,G,B ->
    B,R,G) and every other diagonal band of `period_px` is darkened; outside the mask the still is kept."""
    out = bytearray(rgb)
    for y in range(height):
        for x in range(width):
            i = y * width + x
            if not mask[i]:
                continue
            r, g, b = rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]
            dark = ((x + y) // period_px) % 2 == 1
            f = 0.45 if dark else 1.0
            out[i * 3: i * 3 + 3] = bytes((round(b * f), round(r * f), round(g * f)))
    return out


def variant_material(ref_material: Mapping[str, Any] | None, *, variant_id: str, family_id: str | None, base_color_hex: str | None, coverage: Mapping[str, Any], uv_source: str) -> dict[str, Any]:
    """material.json of a variant: the reference's fabric and simulation parameters (one cut, one
    fabric: a member whose fabric differs is not a stage 4b variant, see families.json `ownAsset`),
    with this variant's colour and texture."""
    m = dict(ref_material or {"format": MATERIAL_FORMAT, "formatVersion": 1})
    if base_color_hex:
        m["baseColorHex"] = base_color_hex
    m["baseColorTexture"] = "texture.png"
    m["variant"] = {
        "id": variant_id,
        "familyId": family_id,
        "referenceProductId": (ref_material or {}).get("productId"),
        "uvSource": uv_source,
        "coverage": dict(coverage),
        "label": ESTIMATE_LABEL,
    }
    return m


def coverage_summary(counts: Mapping[str, int], fill: Mapping[str, int]) -> dict[str, Any]:
    texels = counts["texels"] or 1
    filled = sum(fill.values())
    return {
        "texels": counts["texels"],
        "seen_share": round(counts["seen"] / texels, 4),
        "filled_share": round(filled / texels, 4),
        "seen_by": {k[5:]: v for k, v in counts.items() if k.startswith("seen_")},
        "seen_by_both": counts["both"],
        "fill": dict(fill),
    }


def update_variants_index(index: Mapping[str, Any] | None, entry: Mapping[str, Any]) -> dict[str, Any]:
    """The bundle's variants.json with `entry` added or replaced (by id), sorted by id."""
    out = dict(index or {"format": VARIANTS_FORMAT, "formatVersion": 1, "variants": []})
    variants = [v for v in out.get("variants", []) if v.get("id") != entry["id"]]
    variants.append(dict(entry))
    out["variants"] = sorted(variants, key=lambda v: v["id"])
    return out


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def settings(environ: Mapping[str, str] | None = None) -> dict[str, Any]:
    env = os.environ if environ is None else environ
    gpu = (env.get("CURTAIN_MODAL_GPU_RETEXTURE") or "").strip() or None
    timeout = int((env.get("CURTAIN_MODAL_TIMEOUT_RETEXTURE") or "1800").strip())
    if not 60 <= timeout <= lib.MODAL_MAX_TIMEOUT_S:
        raise ValueError(f"CURTAIN_MODAL_TIMEOUT_RETEXTURE={timeout}: use 60..{lib.MODAL_MAX_TIMEOUT_S} seconds")
    return {"gpu": gpu, "timeout": timeout, "region": (env.get("CURTAIN_MODAL_REGION") or "").strip() or None}


def cost(variant_id: str, cfg: Mapping[str, Any], seconds: float, wall_seconds: float | None = None) -> dict[str, Any]:
    """Cost record. Without a GPU the run is CPU only; the research doc has no Modal CPU price, so the
    dollar estimate stays empty and the seconds are the record."""
    if cfg.get("gpu"):
        return lib.cost_record(f"stage4b_retexture[{variant_id}]", gpu=cfg["gpu"], region=cfg.get("region"), gpu_seconds=seconds, wall_seconds=wall_seconds)
    return {
        "stage": f"stage4b_retexture[{variant_id}]",
        "estimate": True,
        "gpu": "none (CPU)",
        "region": cfg.get("region") or "any",
        "gpu_seconds": 0.0,
        "cpu_seconds": round(seconds, 1),
        "wall_seconds": None if wall_seconds is None else round(wall_seconds, 1),
        "usd_per_hour": None,
        "usd_estimate_low": None,
        "usd_estimate_high": None,
        "price_source": lib.PRICE_SOURCE,
        "not_included": "CPU and memory seconds (no Modal CPU list price in the research doc), storage, egress, failed attempts",
        "notes": ["CPU-only run: no GPU price applies; the Modal invoice gives the CPU and memory cost"],
    }


def retexture_core(mesh: Mapping[str, Any], views: Sequence[View], *, texture_size: int, min_cos: float, depth_eps_m: float,
                   axis_xz: Sequence[float] = (0.0, 0.0), log: Callable[[str], None] = lambda s: None) -> dict[str, Any]:
    """The whole projection + fill on in-memory data. `mesh` = {positions, faces, uvs|None}. Returns the
    mesh actually textured (atlas when it had no UVs), the texture and the coverage."""
    t0 = time.time()
    if mesh.get("uvs"):
        tm = {"positions": list(mesh["positions"]), "faces": list(mesh["faces"]), "uvs": list(mesh["uvs"])}
        uv_source = "stage4"
    else:
        tm = triangle_atlas(mesh["positions"], mesh["faces"], texture_size)
        uv_source = "stage4b-triangle-atlas"
    log(f"[stage4b] {len(tm['faces'])} triangles, uvs from {uv_source}, texture {texture_size}px")
    bake = bake_projection(tm["positions"], tm["faces"], tm["uvs"], views, texture_size, min_cos=min_cos, depth_eps_m=depth_eps_m)
    log(f"[stage4b] projected: {bake['counts']} in {time.time() - t0:.1f} s")
    fill = fill_unseen(bake, texture_size, axis_xz=axis_xz)
    dilate_texture(bake["texture"], bake["state"], texture_size)
    cov = coverage_summary(bake["counts"], fill)
    log(f"[stage4b] coverage: seen {cov['seen_share']:.3f}, filled {cov['filled_share']:.3f} ({fill})")
    return {"mesh": tm, "uv_source": uv_source, "texture": bake["texture"], "state": bake["state"], "coverage": cov,
            "base_color_hex": mean_colour_hex(bake["texture"], bake["state"]), "seconds": round(time.time() - t0, 1)}


# ---------------------------------------------------------------------------
# Modal app (only when the `modal` package is installed; the helpers above never need it)
# ---------------------------------------------------------------------------

try:
    import modal
except ImportError:  # pragma: no cover - the pure helpers are importable without Modal
    modal = None  # type: ignore[assignment]

CFG = settings()

if modal is not None:
    import phase0_modal as pm

    app = modal.App("curtain-phase0-stage4b-retexture")
    image = (
        modal.Image.debian_slim(python_version="3.11")
        .pip_install("pillow==11.3.0")
        .add_local_python_source("phase0_lib", "phase0_modal")
    )

    def _png_rgb(path: str) -> tuple[bytes, int, int]:
        from PIL import Image

        im = Image.open(path).convert("RGB")
        return im.tobytes(), im.width, im.height

    def _png_mask(path: str) -> bytes:
        from PIL import Image

        return bytes(1 if v > 127 else 0 for v in Image.open(path).convert("L").tobytes())

    def _png_bytes(rgb: bytes, size: int) -> bytes:
        import io

        from PIL import Image

        buf = io.BytesIO()
        Image.frombytes("RGB", (size, size), bytes(rgb)).save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    @app.function(image=image, gpu=CFG["gpu"], volumes={pm.JOBS_DIR: pm.jobs}, timeout=CFG["timeout"], region=CFG["region"], cpu=2.0, memory=8192)
    def retexture(ref_job_id: str, source: str, variant_id: str, variant_job_id: str | None = None, family_id: str | None = None, synthetic_variant: bool = False,
                  texture_size: int = DEFAULTS["texture_size"], min_cos: float = DEFAULTS["min_cos"], depth_eps_m: float = DEFAULTS["depth_eps_m"],
                  allow_missing_mask: bool = False) -> dict:
        t_start = time.time()
        pm.jobs.reload()
        ref = f"{pm.JOBS_DIR}/{ref_job_id}"
        m = lib.load_manifest(f"{ref}/manifest.json")
        glb_path = f"{ref}/stage4/{source}/garment.glb"
        if not os.path.exists(glb_path):
            raise FileNotFoundError(f"{glb_path} is missing: run stage 4 for the reference first (or pass --recon-if-missing)")
        with open(glb_path, "rb") as f:
            glb = f.read()
        mesh = read_glb(glb)
        with open(f"{ref}/{m['camera']['opencv']}") as f:
            ref_cams = json.load(f)
        K, w2cs = lib.poses_from_opencv(ref_cams)
        fr, bk = front_back_frames(ref_cams)
        W, H = ref_cams["width"], ref_cams["height"]
        axis_xz = turntable_axis_xz(ref_cams)

        inputs: dict[str, Any] = {"reference_glb_sha256": sha256(glb)}
        warnings: list[str] = []
        views: list[View] = []
        if synthetic_variant:
            if not m.get("synthetic"):
                raise ValueError("--synthetic-variant needs a reference job exported with its synthetic frames")
            for name, frame in (("front", fr), ("back", bk)):
                rgb, w, h = _png_rgb(f"{ref}/{m['synthetic']['rgb_dir']}/{frame:04d}.png")
                mask = _png_mask(f"{ref}/{m['synthetic']['garment_mask_dir']}/{frame:04d}.png")
                views.append(View(name, synthetic_variant_still(rgb, mask, w, h), mask, w, h, K, w2cs[frame]))
            inputs["variant"] = "synthetic: reference synthetic stills, channels rotated, diagonal stripes (dry run)"
        else:
            if not variant_job_id:
                raise ValueError("give --variant-job-dir (a job with stage 1b stills) or --synthetic-variant")
            var = f"{pm.JOBS_DIR}/{variant_job_id}"
            vm = lib.load_manifest(f"{var}/manifest.json")
            with open(f"{var}/{vm['camera']['opencv']}") as f:
                problems = check_same_cameras(ref_cams, json.load(f), (fr, bk))
            if problems:
                raise ValueError(f"the variant's cameras differ from the reference's: {'; '.join(problems)}")
            inputs["variant_job_id"] = variant_job_id
            inputs["stills"] = {}
            warnings += mask_check({n: os.path.exists(f"{var}/{lib.STAGE1B_DIR}/garment_mask_{n}.png") for n in ("front", "back")}, allow_missing_mask)
            for name, frame in (("front", fr), ("back", bk)):
                still = f"{var}/{lib.STAGE1B_DIR}/{name}.png"
                if not os.path.exists(still):
                    raise FileNotFoundError(f"{still} is missing: run stage 1b on the variant job first (run_phase0.py --dress --dress-only)")
                rgb, w, h = _png_rgb(still)
                mask_path = f"{var}/{lib.STAGE1B_DIR}/garment_mask_{name}.png"
                mask = _png_mask(mask_path) if os.path.exists(mask_path) else None
                with open(still, "rb") as f:
                    inputs["stills"][name] = {"sha256": sha256(f.read()), "mask": os.path.exists(mask_path), "invented": name in lib.invented_roles(vm)}
                views.append(View(name, rgb, mask, w, h, K, w2cs[frame]))
        if any((v.width, v.height) != (W, H) for v in views):
            raise ValueError(f"stills are not {W}x{H}")

        result = retexture_core(mesh, views, texture_size=texture_size, min_cos=min_cos, depth_eps_m=depth_eps_m, axis_xz=axis_xz, log=print)
        out = f"{ref}/{STAGE4B_DIR}/{source}"
        vdir = f"{out}/variants/{variant_id}"
        os.makedirs(vdir, exist_ok=True)
        tm = result["mesh"]
        if result["uv_source"] != "stage4":
            with open(f"{out}/garment_uv.glb", "wb") as f:
                f.write(write_glb(tm["positions"], tm["faces"], tm["uvs"]))
        png = _png_bytes(result["texture"], texture_size)
        with open(f"{vdir}/texture.png", "wb") as f:
            f.write(png)
        with open(f"{vdir}/preview.glb", "wb") as f:
            f.write(write_glb(tm["positions"], tm["faces"], tm["uvs"], png, name=variant_id))
        material = variant_material(m.get("fabric"), variant_id=variant_id, family_id=family_id, base_color_hex=result["base_color_hex"], coverage=result["coverage"], uv_source=result["uv_source"])
        with open(f"{vdir}/material.json", "w") as f:
            json.dump(material, f, indent=2)
        record = {
            "format": "curtain.phase0.stage4b-record",
            "reference_job_id": ref_job_id,
            "reference_input_hash": m["input_hash"],
            "source": source,
            "variant_id": variant_id,
            "family_id": family_id,
            "inputs": inputs,
            "settings": {"texture_size": texture_size, "min_cos": min_cos, "depth_eps_m": depth_eps_m, "theta_bins": DEFAULTS["theta_bins"], "y_bin_m": DEFAULTS["y_bin_m"], "axis_xz": list(axis_xz), "axis_source": "mean camera centre of cameras_opencv.json"},
            "warnings": warnings,
            "uv_source": result["uv_source"],
            "coverage": result["coverage"],
            "texture_sha256": sha256(png),
            "seconds": {"core": result["seconds"]},
            "label": ESTIMATE_LABEL,
            "cost": cost(variant_id, CFG, time.time() - t_start),
        }
        with open(f"{vdir}/record.json", "w") as f:
            json.dump(record, f, indent=2)
        index_path = f"{out}/variants.json"
        index = None
        if os.path.exists(index_path):
            with open(index_path) as f:
                index = json.load(f)
        index = update_variants_index(index, {
            "id": variant_id, "familyId": family_id, "texture": f"variants/{variant_id}/texture.png", "material": f"variants/{variant_id}/material.json",
            "mesh": "garment_uv.glb" if result["uv_source"] != "stage4" else f"../../stage4/{source}/garment.glb",
            "seenShare": result["coverage"]["seen_share"], "filledShare": result["coverage"]["filled_share"], "estimate": True,
        })
        index["referenceJobId"] = ref_job_id
        with open(index_path, "w") as f:
            json.dump(index, f, indent=2)
        pm.jobs.commit()
        return record

    def _volume_has(job_id: str, rel: str) -> bool:
        try:
            return bool(pm.jobs.listdir(f"/{job_id}/{rel}"))
        except Exception:  # noqa: BLE001 - not found raises
            return False

    @app.local_entrypoint()
    def main(ref_job_dir: str, source: str = "stage2", variant_id: str = "", variant_job_dir: str = "", family_id: str = "", synthetic_variant: bool = False,
             texture_size: int = DEFAULTS["texture_size"], min_cos: float = DEFAULTS["min_cos"], depth_eps_cm: float = DEFAULTS["depth_eps_m"] * 100,
             recon_if_missing: bool = False, download_only: bool = False, force_upload: bool = False, allow_missing_mask: bool = False):
        import subprocess

        m = pm.load_local_job(ref_job_dir)
        ref_id = m["job_id"]
        if download_only:
            pm.download_dir(ref_job_dir, ref_id, f"{STAGE4B_DIR}/{source}")
            return
        pm.upload_job(ref_job_dir, ref_id, force=force_upload)
        var_id = None
        if variant_job_dir:
            vm = pm.load_local_job(variant_job_dir)
            var_id = vm["job_id"]
            pm.upload_job(variant_job_dir, var_id, force=force_upload)
            stills = [f"{lib.STAGE1B_DIR}/{v}.png" for v in ("front", "back")]
            for rel in stills:  # stage 1b may have run on this computer; put its stills into the Volume too
                local = os.path.join(variant_job_dir, rel)
                if os.path.exists(local) and not _volume_has(var_id, rel):
                    with pm.jobs.batch_upload(force=True) as batch:
                        for r in stills + [f"{lib.STAGE1B_DIR}/garment_mask_{v}.png" for v in ("front", "back")]:
                            if os.path.exists(os.path.join(variant_job_dir, r)):
                                batch.put_file(os.path.join(variant_job_dir, r), f"/{var_id}/{r}")
                    break
            variant_id = variant_id or vm["product_id"]
        if not variant_id:
            variant_id = f"{m['product_id']}-synthetic-variant" if synthetic_variant else ""
        if not variant_id:
            raise SystemExit("give --variant-id, --variant-job-dir or --synthetic-variant")
        if not _volume_has(ref_id, f"stage4/{source}/garment.glb"):
            if not recon_if_missing:
                raise SystemExit(f"no stage4/{source}/garment.glb for {ref_id} in the jobs Volume: run stage4_recon.py --source {source} first, or pass --recon-if-missing")
            here = os.path.dirname(os.path.abspath(__file__))
            print(f"[stage4b] reference mesh missing: running stage 4 ({source}) first")
            subprocess.run(["modal", "run", os.path.join(here, "stage4_recon.py"), "--job-dir", ref_job_dir, "--source", source], check=True)
        t = time.time()
        record = retexture.remote(ref_id, source, variant_id, variant_job_id=var_id, family_id=family_id or None, synthetic_variant=synthetic_variant,
                                  texture_size=texture_size, min_cos=min_cos, depth_eps_m=depth_eps_cm / 100.0, allow_missing_mask=allow_missing_mask)
        record["cost"] = cost(variant_id, CFG, record["cost"].get("cpu_seconds") or record["cost"]["gpu_seconds"], time.time() - t)
        print(json.dumps({k: record[k] for k in ("variant_id", "family_id", "uv_source", "coverage", "seconds", "warnings")}, indent=2))
        print(lib.format_cost_table([record["cost"]]))
        pm.download_dir(ref_job_dir, ref_id, f"{STAGE4B_DIR}/{source}")
