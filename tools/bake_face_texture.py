#!/usr/bin/env python3
"""Project a 3D face scan onto a sphere as an equirectangular texture.

The website draws the face as the colour map of a plain `SphereGeometry`. This
script produces that map: for every pixel of the output it fires a ray from the
sphere's centre outwards, finds where that ray leaves the scan, and copies the
scan's colour there.

The direction for each pixel is computed with three.js's own `SphereGeometry`
formula, so the result lines up with the site without any further fiddling.

Usage
-----
    .venv/bin/python tools/bake_face_texture.py assets-raw/scan.obj --inspect
    .venv/bin/python tools/bake_face_texture.py assets-raw/scan.obj \
        --out public/textures/face.jpg --size 2048 --yaw 0

A face scan is an open shell, not a closed head, so most rays miss. What
happens to those pixels is `--fill`:

    solid    (default) one flat colour, the median colour of the scan
    nearest  the colour of the closest point on the scan, which smears the
             face outwards into a continuous planet surface. Much slower.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent


def material_image(mesh: trimesh.Trimesh) -> Image.Image | None:
    """The scan's colour texture, whichever material class trimesh chose.

    A .obj comes back as a SimpleMaterial with `.image`; a .glb comes back as a
    PBRMaterial, where the same picture lives in `.baseColorTexture`.
    """
    mat = getattr(getattr(mesh, "visual", None), "material", None)
    if mat is None:
        return None
    for attribute in ("image", "baseColorTexture"):
        image = getattr(mat, attribute, None)
        if image is not None:
            return image
    to_simple = getattr(mat, "to_simple", None)
    if to_simple is not None:
        return getattr(to_simple(), "image", None)
    return None


def load_scan(path: Path) -> trimesh.Trimesh:
    """Load the scan as a single concatenated mesh."""
    mesh = trimesh.load(path, force="mesh", process=False)
    if not isinstance(mesh, trimesh.Trimesh) or mesh.faces.shape[0] == 0:
        raise SystemExit(f"{path} did not load as a mesh with faces")
    return mesh


def describe(mesh: trimesh.Trimesh, path: Path) -> None:
    print(f"{path}")
    print(f"  vertices      {len(mesh.vertices):,}")
    print(f"  faces         {len(mesh.faces):,}")
    print(f"  watertight    {mesh.is_watertight}")
    print(f"  bounds        {np.round(mesh.bounds, 4).tolist()}")
    print(f"  extents       {np.round(mesh.extents, 4).tolist()}")
    print(f"  centroid      {np.round(mesh.centroid, 4).tolist()}")

    visual = mesh.visual
    kind = getattr(visual, "kind", None)
    print(f"  colour source {kind or 'none'}")

    # The tallest axis of a head is the one running crown-to-chin, so it is a
    # decent guess at which way up the file is — and therefore whether --up is
    # needed. It is a hint, not a measurement: say so.
    tallest = "xyz"[int(np.argmax(mesh.extents))]
    if tallest == "z":
        print("  looks Z-up     → add --up z (usual for .ply/.obj from Blender)")
    elif tallest == "y":
        print("  looks Y-up     → no --up flag needed (usual for .glb)")
    else:
        print(f"  longest axis  {tallest} — check the orientation before baking")
    if kind == "texture":
        image = material_image(mesh)
        print(f"  texture       {image.size if image else 'missing image'}")
        print(f"  uv            {'yes' if visual.uv is not None else 'no'}")
    elif kind is None:
        print("  ! no vertex colours and no texture — the bake would be flat grey.")
        print("    Re-export the scan with vertex colours or an accompanying texture.")


def recentre(mesh: trimesh.Trimesh, yaw_degrees: float, up: str) -> trimesh.Trimesh:
    """Put the scan at the origin, sized to the unit sphere, facing +Z.

    Uses the bounding-box centre rather than the centroid: scans often have a
    dense cluster of vertices around the nose that drags the centroid forward.
    """
    mesh = mesh.copy()

    if up == "z":
        # Blender is Z-up; glTF and three.js are Y-up. Exporting to .glb applies
        # this conversion already, but .ply and .obj keep Blender's axes, so a
        # face exported from them arrives lying on its back.
        mesh.apply_transform(
            trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
        )

    mesh.apply_translation(-mesh.bounding_box.centroid)

    longest = float(np.max(mesh.extents))
    if longest > 0:
        mesh.apply_scale(1.0 / longest)

    if yaw_degrees:
        rotation = trimesh.transformations.rotation_matrix(
            np.radians(yaw_degrees), [0, 1, 0]
        )
        mesh.apply_transform(rotation)

    return mesh


def sphere_directions(width: int, height: int) -> np.ndarray:
    """Unit direction for every texel, matching three.js `SphereGeometry` UVs.

    In three.js, with the default phi/theta ranges:
        x = -cos(u * 2pi) * sin(theta)
        y =  cos(theta)
        z =  sin(u * 2pi) * sin(theta),  theta = (1 - v) * pi

    v = 1 is the north pole and u = 0.25 faces +Z, which is where the default
    camera sits — so u = 0.25 is the column the viewer sees first.
    """
    # Texel centres, not edges, so the poles are not sampled exactly.
    u = (np.arange(width) + 0.5) / width
    v = (np.arange(height) + 0.5) / height

    # Image row 0 is the top of the texture, which is v = 1.
    v = v[::-1]

    uu, vv = np.meshgrid(u, v)
    phi = uu * 2.0 * np.pi
    theta = (1.0 - vv) * np.pi

    sin_theta = np.sin(theta)
    directions = np.stack(
        [-np.cos(phi) * sin_theta, np.cos(theta), np.sin(phi) * sin_theta],
        axis=-1,
    )
    return directions.reshape(-1, 3)


def sample_colours(
    mesh: trimesh.Trimesh, points: np.ndarray, face_indices: np.ndarray
) -> np.ndarray:
    """Colour of the scan at `points`, which lie on faces `face_indices`.

    Returns uint8 RGB. Falls back to flat grey when the scan carries no colour
    at all, which `--inspect` warns about up front.
    """
    visual = mesh.visual
    kind = getattr(visual, "kind", None)

    if len(points) == 0:
        return np.zeros((0, 3), dtype=np.uint8)

    triangles = mesh.triangles[face_indices]
    bary = trimesh.triangles.points_to_barycentric(triangles, points)
    bary = np.clip(bary, 0.0, 1.0)

    if kind == "texture" and visual.uv is not None:
        image = material_image(mesh)
        if image is None:
            return np.full((len(points), 3), 128, dtype=np.uint8)

        texture = np.asarray(image.convert("RGB"))
        tex_h, tex_w = texture.shape[:2]

        face_uv = np.asarray(visual.uv)[mesh.faces[face_indices]]  # (N, 3, 2)
        uv = np.einsum("nk,nkc->nc", bary, face_uv)

        # Scan textures routinely run outside [0, 1]; wrap the way a GPU would.
        px = np.clip((uv[:, 0] % 1.0) * tex_w, 0, tex_w - 1).astype(np.int32)
        # Image space runs top-down, UV space bottom-up.
        py = np.clip((1.0 - (uv[:, 1] % 1.0)) * tex_h, 0, tex_h - 1).astype(np.int32)
        return texture[py, px]

    if kind in ("vertex", "face"):
        vertex_colours = np.asarray(visual.vertex_colors)[:, :3].astype(np.float32)
        face_colours = vertex_colours[mesh.faces[face_indices]]  # (N, 3, 3)
        blended = np.einsum("nk,nkc->nc", bary, face_colours)
        return np.clip(blended, 0, 255).astype(np.uint8)

    return np.full((len(points), 3), 128, dtype=np.uint8)


def median_colour(mesh: trimesh.Trimesh) -> np.ndarray:
    """A representative colour, used to fill the texels no ray reached."""
    visual = mesh.visual
    kind = getattr(visual, "kind", None)
    if kind == "texture":
        image = material_image(mesh)
        if image is not None:
            pixels = np.asarray(image.convert("RGB")).reshape(-1, 3)
            return np.median(pixels, axis=0).astype(np.uint8)
    if kind in ("vertex", "face"):
        return np.median(np.asarray(visual.vertex_colors)[:, :3], axis=0).astype(np.uint8)
    return np.array([128, 128, 128], dtype=np.uint8)


def bake(mesh: trimesh.Trimesh, width: int, height: int, fill: str) -> Image.Image:
    directions = sphere_directions(width, height)
    origins = np.zeros_like(directions)

    print(f"casting {len(directions):,} rays (this is the slow part)…", flush=True)
    locations, ray_indices, face_indices = mesh.ray.intersects_location(
        ray_origins=origins,
        ray_directions=directions,
        multiple_hits=False,
    )

    pixels = np.tile(median_colour(mesh), (len(directions), 1))
    hit_ratio = len(ray_indices) / len(directions)
    print(f"  {len(ray_indices):,} hits ({hit_ratio:.1%} of the sphere covered)")

    if len(ray_indices):
        pixels[ray_indices] = sample_colours(mesh, locations, face_indices)

    if fill == "nearest":
        missed = np.setdiff1d(np.arange(len(directions)), ray_indices)
        if len(missed):
            print(f"  filling {len(missed):,} missed texels from the nearest surface…", flush=True)
            closest, _, nearest_faces = mesh.nearest.on_surface(directions[missed])
            pixels[missed] = sample_colours(mesh, closest, nearest_faces)

    return Image.fromarray(pixels.reshape(height, width, 3), mode="RGB")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("scan", type=Path, help="the scan mesh (.obj, .ply, .glb, …)")
    parser.add_argument(
        "--out",
        type=Path,
        default=REPO_ROOT / "public" / "textures" / "face.webp",
        help="where to write the texture (default: public/textures/face.webp)",
    )
    parser.add_argument("--size", type=int, default=2048, help="texture width; height is half (default: 2048)")
    parser.add_argument("--yaw", type=float, default=0.0, help="degrees to spin the scan around Y before baking")
    parser.add_argument(
        "--up",
        choices=("y", "z"),
        default="y",
        help="which axis is up in the file: 'y' for .glb (default), 'z' for .ply/.obj straight out of Blender",
    )
    parser.add_argument("--fill", choices=("solid", "nearest"), default="solid", help="what to do with texels no ray reached")
    parser.add_argument("--inspect", action="store_true", help="print what the scan contains and stop")
    args = parser.parse_args(argv)

    if not args.scan.exists():
        raise SystemExit(f"no such file: {args.scan}")

    mesh = load_scan(args.scan)

    if args.inspect:
        describe(mesh, args.scan)
        return 0

    mesh = recentre(mesh, args.yaw, args.up)
    image = bake(mesh, args.size, args.size // 2, args.fill)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    suffix = args.out.suffix.lower()
    if suffix == ".webp":
        image.save(args.out, quality=88, method=6)
    elif suffix in (".jpg", ".jpeg"):
        image.save(args.out, quality=92, subsampling=0, optimize=True)
    else:
        image.save(args.out)

    print(f"wrote {args.out} ({image.width}x{image.height})")
    print("Reload the dev server — the globe picks it up automatically.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
