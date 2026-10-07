# Asset pipeline

Two scripts, both offline:

- `extract_texture.py` — the face is already projected onto a sphere; lift the
  texture out and optimise it.
- `bake_face_texture.py` — the face is a raw scan; project it onto a sphere.

Everything here runs offline, in the Python virtual environment at `.venv/`.
The website never imports any of it — the browser only ever sees the files that
end up in `public/`.

```bash
source .venv/bin/activate          # or prefix commands with .venv/bin/
pip install -r tools/requirements.txt
```

## Two routes, depending on what Blender gives you

The site draws the face as the colour map of a plain three.js `SphereGeometry`,
so what it ultimately needs is one equirectangular image: 2:1, north pole at the
top, and the face sitting a quarter of the way across, because that is the
column three.js points the default camera at.

**If Blender already did the projection** — you have a UV sphere carrying the
face as an equirectangular texture — there is nothing to re-project. Lift the
texture straight out, which avoids resampling an image that is already correct:

```bash
.venv/bin/python tools/extract_texture.py assets-raw/scan.glb --inspect
.venv/bin/python tools/extract_texture.py assets-raw/scan.glb
```

`--inspect` checks the sphere's UVs against three.js's own `SphereGeometry`
layout and says whether they match. They usually do if the sphere was unwrapped
with Blender's default spherical projection. If the report says the texture is
rotated, it prints the `--roll` value that corrects it.

Output goes to `public/textures/face.webp`, which is where the globe looks.
WebP at quality 88 holds full 4K resolution at under half the size of the
equivalent JPEG, and the difference is not visible even zoomed in.

**If you have a raw face scan** — an open shell of a face, not a sphere — then
the projection still has to happen, and that is what the rest of this page is
about.

## Getting the face onto the globe

The site draws the face as the colour map of a plain three.js `SphereGeometry`.
So the scan has to become one equirectangular image: 2:1, north pole at the top,
and — because of how three.js lays out sphere UVs — **the column a quarter of the
way across the image is the one facing the default camera**. That is where the
face should sit.

`bake_face_texture.py` does the projection. It fires a ray from the sphere's
centre through every texel, finds where that ray leaves the scan, and copies the
colour it finds there.

```bash
# 1. See what your scan actually contains before committing to a bake.
.venv/bin/python tools/bake_face_texture.py assets-raw/scan.glb --inspect

# 2. Bake it.
.venv/bin/python tools/bake_face_texture.py assets-raw/scan.glb --size 2048
```

## Exporting from Blender

**Export to `.glb`.** It embeds the texture in one file and the exporter applies
the Z-up to Y-up axis conversion, which is the step that most often goes wrong.

Three things have to be true:

1. **Colour is in the file.** The bake samples the scan's colour per pixel, so
   it needs vertex colours (Color Attributes) or a texture with UVs. Colour
   coming from procedural shader nodes does not export — bake it down to an
   image texture in Blender first, or the planet comes out flat grey.
2. **The face looks toward -Y, head up +Z.** That is the default orientation for
   a scan: the face is looking at you in Front view (numpad 1). glTF export
   turns that into facing +Z, up +Y, which is what the script expects.
3. Scale and polygon count do not matter. The script recentres and normalises,
   and it ray-casts rather than resampling, so a dense mesh is fine.

### If you export .ply or .obj instead

Those formats keep Blender's Z-up axes, so the head arrives lying on its back.
Pass `--up z`:

```bash
.venv/bin/python tools/bake_face_texture.py assets-raw/scan.ply --up z --size 2048
```

`--inspect` guesses which one you need by looking at the longest axis — a head
is taller than it is wide — and prints its advice. It is a hint, not a
measurement, so check the result.

### If the face is pointing the wrong way round

`--yaw` spins the scan around the vertical axis before baking. Bake small and
fast while you find the number, then do the full-size one:

```bash
.venv/bin/python tools/bake_face_texture.py assets-raw/scan.glb --size 512 --yaw 30
```

The output goes to `public/textures/face.jpg` by default, which is exactly where
the globe looks for it. Reload the dev server and the placeholder grid is gone.

### The options that matter

| Flag | What it is for |
| --- | --- |
| `--inspect` | Print the scan's stats and colour source, then stop. Run this first. |
| `--yaw 30` | Spin the scan around the vertical axis before baking, to bring the face round to the front. |
| `--up z` | The file is Z-up. Needed for `.ply`/`.obj` from Blender, not for `.glb`. |
| `--size 4096` | Bigger texture. 2048 is usually plenty; the face only occupies part of it. |
| `--fill nearest` | See below. |
| `--out path.png` | Write somewhere else. PNG if you want to retouch it before shipping. |

### About `--fill`

A face scan is an open shell — the front of a head, not a closed sphere. Most
rays miss it entirely, so most of the texture has nothing to copy from.

- `--fill solid` (default) paints the misses one flat colour, the median colour
  of the scan. The face reads as a decal on a plain planet.
- `--fill nearest` paints each miss with the colour of the closest point on the
  scan, smearing the edges of the face outward into a continuous surface. It
  looks more like a planet and less like a sticker, and it is slower.

Try both. The `--inspect` line `N hits (X% of the sphere covered)` tells you in
advance how much of the image the fill will be responsible for.

### If the bake comes out flat grey

`--inspect` prints `colour source`. If it says `none`, the scan has neither
vertex colours nor a texture, and there is nothing for the bake to sample.
Re-export from your scanning app with colour included — for most apps that means
`.obj` plus a `.jpg`/`.png` sitting next to it, or a `.glb` with everything
embedded.

## Project models

The orbiting models are loaded straight from `public/models/*.glb` by the
website, so there is no Python step. What they do need is to be small — they are
downloaded before anything can be clicked. Compress them with
[gltf-transform](https://gltf-transform.dev/):

```bash
npx @gltf-transform/cli optimize in.glb public/models/project-one.glb --texture-compress webp
```

Then point the project's `model` field at it in `src/data/projects.ts`.

## Where files live

- `assets-raw/` — raw scans, `.blend` files, anything large. **Git-ignored.**
  Keep the originals backed up somewhere that is not this repo.
- `public/textures/`, `public/models/` — the optimised, web-ready output.
  Committed, and served as-is.
