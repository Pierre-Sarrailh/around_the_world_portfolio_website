#!/usr/bin/env python3
"""Pull a ready-baked equirectangular texture out of a mesh and optimise it.

Use this when the projection has already been done — a UV sphere carrying the
face as an equirectangular map, exported from Blender. There is nothing to
re-project, so the texture is lifted out as-is rather than resampled, and the
only processing is the encode.

If instead you have a raw face scan — an open shell, not a sphere — you want
`bake_face_texture.py`, which does the projection.

    .venv/bin/python tools/extract_texture.py assets-raw/scan.glb --inspect
    .venv/bin/python tools/extract_texture.py assets-raw/scan.glb

Before writing anything it checks the mesh's UVs against three.js's
`SphereGeometry` convention, because a texture that does not match will put the
face somewhere other than in front of the camera.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "public" / "textures" / "face.webp"


def material_image(mesh: trimesh.Trimesh) -> Image.Image | None:
    """The mesh's colour texture, whichever material class trimesh chose."""
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


def check_sphere(mesh: trimesh.Trimesh) -> tuple[bool, str]:
    """Is this a sphere centred on the origin? Only then are the UVs meaningful."""
    centred = mesh.copy()
    centred.apply_translation(-centred.bounding_box.centroid)
    radii = np.linalg.norm(centred.vertices, axis=1)
    spread = float(radii.std() / max(radii.mean(), 1e-9))
    if spread > 0.02:
        return False, f"not a sphere (radius varies by {spread:.1%})"
    return True, f"sphere, radius {radii.mean():.3f}"


def check_uv_convention(mesh: trimesh.Trimesh) -> tuple[float, float]:
    """Compare the mesh's UVs against what three.js would assign each direction.

    three.js `SphereGeometry` lays out its UVs as:
        x = -cos(u * 2pi) * sin(theta),  y = cos(theta),  z = sin(u * 2pi) * sin(theta)
        theta = (1 - v) * pi

    Returns (median u offset, mean absolute v error). Both near zero means the
    texture can be used directly; a u offset of 0.25 means the face is a quarter
    turn away from where the camera looks, which `--roll` corrects.
    """
    centred = mesh.copy()
    centred.apply_translation(-centred.bounding_box.centroid)
    vertices = np.asarray(centred.vertices)
    direction = vertices / np.linalg.norm(vertices, axis=1)[:, None]

    uv = np.asarray(mesh.visual.uv)
    three_u = (np.arctan2(direction[:, 2], -direction[:, 0]) / (2 * np.pi)) % 1.0
    three_v = 1.0 - (np.arccos(np.clip(direction[:, 1], -1, 1)) / np.pi)

    # Wrap into [-0.5, 0.5) before taking the median, or the seam dominates.
    u_offset = (uv[:, 0] - three_u + 0.5) % 1.0 - 0.5
    return float(np.median(u_offset)), float(np.abs(uv[:, 1] - three_v).mean())


def describe(mesh: trimesh.Trimesh, image: Image.Image | None, path: Path) -> None:
    print(f"{path}")
    print(f"  vertices      {len(mesh.vertices):,}")
    is_sphere, note = check_sphere(mesh)
    print(f"  geometry      {note}")

    if image is None:
        print("  ! no texture found — this file has nothing to extract.")
        print("    If it is a raw scan with vertex colours, use bake_face_texture.py.")
        return

    ratio = image.width / image.height
    print(f"  texture       {image.width}x{image.height}  ({ratio:.2f}:1)")
    if abs(ratio - 2.0) > 0.01:
        print("  ! not 2:1 — an equirectangular map must be twice as wide as it is tall.")

    if not is_sphere or getattr(mesh.visual, "uv", None) is None:
        print("  uv check      skipped (needs a sphere with UVs)")
        return

    u_offset, v_error = check_uv_convention(mesh)
    print(f"  uv vs three.js  u offset {u_offset:+.4f}, v error {v_error:.4f}")
    if abs(u_offset) < 0.01 and v_error < 0.01:
        print("  -> matches three.js exactly; the texture can be used as-is.")
    elif v_error < 0.01:
        print(f"  -> rotated horizontally. Correct it with --roll {-u_offset:+.4f}")
    else:
        print("  -> does not match. The vertical mapping differs, so this texture")
        print("     cannot simply be copied; re-bake with bake_face_texture.py.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("mesh", type=Path, help="the textured sphere (.glb, .obj, …)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"default: {DEFAULT_OUT.relative_to(REPO_ROOT)}")
    parser.add_argument("--quality", type=int, default=88, help="encoder quality (default: 88)")
    parser.add_argument("--width", type=int, default=0, help="resize to this width, height follows (0 = keep)")
    parser.add_argument(
        "--roll",
        type=float,
        default=0.0,
        help="shift the texture horizontally, in turns; 0.25 is a quarter turn",
    )
    parser.add_argument("--inspect", action="store_true", help="report what is in the file and stop")
    args = parser.parse_args(argv)

    if not args.mesh.exists():
        raise SystemExit(f"no such file: {args.mesh}")

    mesh = trimesh.load(args.mesh, force="mesh", process=False)
    image = material_image(mesh)

    if args.inspect:
        describe(mesh, image, args.mesh)
        return 0

    if image is None:
        raise SystemExit("no texture in that file — run with --inspect, or use bake_face_texture.py")

    image = image.convert("RGB")

    if args.roll:
        # np.roll on the pixel array: an equirectangular map wraps horizontally,
        # so shifting it is exactly a rotation about the vertical axis.
        shift = int(round(args.roll * image.width)) % image.width
        image = Image.fromarray(np.roll(np.asarray(image), shift, axis=1))

    if args.width:
        image = image.resize((args.width, args.width // 2), Image.LANCZOS)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    fmt = "WEBP" if args.out.suffix.lower() == ".webp" else "JPEG"
    options = {"quality": args.quality}
    options.update({"method": 6} if fmt == "WEBP" else {"subsampling": 0, "optimize": True})

    buffer = io.BytesIO()
    image.save(buffer, fmt, **options)
    args.out.write_bytes(buffer.getvalue())

    print(f"wrote {args.out}  {image.width}x{image.height}  {len(buffer.getvalue()):,} bytes")
    print("Reload the dev server — the globe picks it up automatically.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
