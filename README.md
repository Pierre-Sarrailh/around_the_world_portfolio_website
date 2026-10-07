# Around the World

A portfolio that is a planet. My face, 3D-scanned and baked onto a sphere,
turning slowly in a daylight sky; the projects ride a ring around it as models
you can click.

## Running it

```bash
npm install
npm run dev
```

The scene works immediately, with a placeholder grid on the globe and
procedural shapes for the projects, so layout and motion can be tuned before
any of the real art exists.

| Command | |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run typecheck` | Types only |

## How it fits together

```
src/
  main.ts              wires everything up and owns the animation loop
  types.ts             Project / Orbit shapes
  data/projects.ts     ← the only file you edit to add a project
  scene/
    globe.ts           the sphere, the face texture, the atmosphere rim
    satellites.ts      orbital mechanics, the ring band, placeholder shapes
    sky.ts             procedural daylight dome + the environment map
    lighting.ts        sun / sky bounce / ambient floor
  interaction/
    picker.ts          raycasting: hover and click on satellites
    panel.ts           the slide-in project panel
    tooltip.ts         the label that follows the cursor
tools/                 offline Python: turns a face scan into a texture
public/                web-ready assets, served as-is
assets-raw/            raw scans and working files — git-ignored
```

### Adding a project

Append to `PROJECTS` in [`src/data/projects.ts`](src/data/projects.ts). The
scene, the raycaster and the panel all read from that one list, so nothing else
needs touching.

```ts
{
  id: 'new-thing',
  title: 'New Thing',
  tagline: 'One line that earns the click.',
  description: '…',
  tags: ['Rust'],
  links: [{ label: 'Source', href: 'https://github.com/…' }],
  orbit: { radius: 4.6, inclination: -15, ascendingNode: 200, period: 70, phase: 0.5 },
  placeholder: { shape: 'box', size: 0.2, color: '#a5b4fc' },
  // model: '/models/new-thing.glb',   ← once the model exists
}
```

`orbit` is the part worth playing with, but it is a ring, so the numbers want to
stay close together. `radius` is in globe-radii — every project sits near 1.55,
and the small spread between them is what gives the band depth. `inclination`
and `ascendingNode` are degrees; keep inclination within a few degrees of 0 or
satellites start leaving the ring. `period` is seconds per revolution, and they
are all near 60 so the formation holds instead of smearing out. `phase` (0–1)
spaces them around the ring.

The band drawn behind them sizes itself from those radii, so it always contains
whatever you set.

Leave `model` off and the project gets a procedural `placeholder` shape. That is
deliberate: the system can be complete and tuned long before the models are.

### Adding the face

The globe reads `public/textures/face.webp`: one equirectangular image, 2:1,
north pole at the top, face a quarter of the way across. Until it exists the
globe wears a labelled grid and logs a note to the console.

If Blender has already projected the face onto a sphere, lift the texture out
rather than resampling it:

```bash
.venv/bin/python tools/extract_texture.py assets-raw/scan.glb --inspect
.venv/bin/python tools/extract_texture.py assets-raw/scan.glb
```

If you have a raw face scan instead, it needs projecting first — see
[`tools/README.md`](tools/README.md) for `bake_face_texture.py`.

### Changing the scale

`GLOBE_RADIUS` in [`src/scene/globe.ts`](src/scene/globe.ts) is the unit the
whole composition is measured in — orbit radii and camera distances are all
multiples of it, so changing that one number rescales everything without
anything drifting out of frame.

### Tuning the sky

The sky is generated in a shader, not loaded from a cubemap, so there are no
assets to swap. The uniforms in [`src/scene/sky.ts`](src/scene/sky.ts) are the
dials: `uCoverage` (raise for fewer clouds, lower for overcast), `uCloudScale`,
`uZenith` / `uHorizon`, and `SUN_DIRECTION`, which the lighting reads too so the
two always agree.

That same sky is baked into an environment map and assigned to
`scene.environment`. That is what makes the lighting even — every surface picks
up colour from the whole dome rather than from a couple of lamps, so the face
stays readable all the way round instead of having a bright side and a dark
side. The lights in `lighting.ts` are deliberately weak for that reason; turning
them up just clips the face texture to white.

## Notes

- **Reduced motion** is respected — the scene still renders and stays fully
  interactive, it just stops drifting.
- **Deploying to a subpath** (GitHub Pages under a repo name) needs `base` set
  in [`vite.config.ts`](vite.config.ts).
- **Large assets** are git-ignored by default. If the `.glb` files grow past a
  few MB, move them to Git LFS or a CDN rather than committing them.
