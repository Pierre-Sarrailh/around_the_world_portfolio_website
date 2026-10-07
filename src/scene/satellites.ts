import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLOBE_RADIUS } from './globe';
import type { Placeholder, Project } from '../types';

/** One orbiting project: its transform hierarchy and what a click should open. */
export interface Satellite {
  project: Project;
  /** The node that travels along the orbit. Models are parented to this. */
  pivot: THREE.Group;
  /** Child of the pivot that carries the visible model, so hover can scale it. */
  visual: THREE.Group;
  /** Meshes the raycaster may hit. */
  hitTargets: THREE.Object3D[];
  orbitLine: THREE.Line;
  /** Orbit radius in world units — `project.orbit.radius` is in globe radii. */
  worldRadius: number;
}

export interface SatelliteSystem {
  group: THREE.Group;
  satellites: Satellite[];
  /** All currently pickable objects, flattened for the raycaster. */
  pickables(): THREE.Object3D[];
  setHighlighted(satellite: Satellite | null): void;
  update(elapsed: number, delta: number): void;
}

function placeholderGeometry(p: Placeholder): THREE.BufferGeometry {
  switch (p.shape) {
    case 'torus':
      return new THREE.TorusKnotGeometry(p.size, p.size * 0.32, 96, 16);
    case 'octahedron':
      return new THREE.OctahedronGeometry(p.size, 0);
    case 'box':
      return new THREE.BoxGeometry(p.size * 1.4, p.size * 1.4, p.size * 1.4);
    case 'icosahedron':
    default:
      return new THREE.IcosahedronGeometry(p.size, 0);
  }
}

/**
 * The band the satellites travel in, drawn as one flat annulus.
 *
 * Because every project sits at a near-identical radius, their individual paths
 * would otherwise overlap into an illegible tangle. Drawing the band once and
 * letting the satellites ride slightly different lines inside it is what makes
 * the formation read as a single ring.
 */
function ringBand(inner: number, outer: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color('#9bb4cd') },
      uOpacity: { value: 0.33 },
      uInner: { value: inner },
      uOuter: { value: outer },
    },
    vertexShader: /* glsl */ `
      uniform float uInner;
      uniform float uOuter;
      varying float vRadial;
      void main() {
        // RingGeometry is built in the XY plane, so the distance from the
        // origin in object space is the radius, before any tilt is applied.
        vRadial = (length(position.xy) - uInner) / (uOuter - uInner);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vRadial;
      void main() {
        // Soft on both edges so the band has no hard rim.
        float alpha = smoothstep(0.0, 0.3, vRadial) * (1.0 - smoothstep(0.7, 1.0, vRadial));
        gl_FragColor = vec4(uColor, alpha * uOpacity);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 180, 1), material);
  // RingGeometry lies in XY; the orbits are in XZ.
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** The faint thread one satellite follows, drawn flat in its own orbital plane. */
function orbitLine(radius: number): THREE.Line {
  const points: THREE.Vector3[] = [];
  const segments = 180;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius));
  }
  return new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: '#f2f7fc', transparent: true, opacity: 0.5 }),
  );
}

/**
 * Tilt applied to the whole ring system, in degrees.
 *
 * Left flat, the ring is viewed nearly edge-on from the default camera and cuts
 * a straight line across the face at eye level. Leaning it opens the ring into
 * an ellipse that reads as orbit rather than as a bar drawn over the portrait.
 */
const RING_TILT = { lean: -14, open: 13 };

export function createSatellites(
  projects: Project[],
  loadingManager: THREE.LoadingManager,
): SatelliteSystem {
  const group = new THREE.Group();
  group.rotation.z = THREE.MathUtils.degToRad(RING_TILT.lean);
  group.rotation.x = THREE.MathUtils.degToRad(RING_TILT.open);
  const loader = new GLTFLoader(loadingManager);
  const satellites: Satellite[] = [];

  for (const project of projects) {
    const { orbit } = project;
    const worldRadius = orbit.radius * GLOBE_RADIUS;

    // The orbital plane: spun around Y by the ascending node, then tipped by
    // the inclination. Children can then think purely in flat XZ circles.
    const plane = new THREE.Group();
    plane.rotation.y = THREE.MathUtils.degToRad(orbit.ascendingNode);
    plane.rotation.x = THREE.MathUtils.degToRad(orbit.inclination);

    const pivot = new THREE.Group();
    pivot.name = project.id;

    const visual = new THREE.Group();
    pivot.add(visual);

    const line = orbitLine(worldRadius);
    plane.add(line, pivot);
    group.add(plane);

    const satellite: Satellite = {
      project,
      pivot,
      visual,
      hitTargets: [],
      orbitLine: line,
      worldRadius,
    };

    // A generous invisible sphere around the object, so small or spindly models
    // are still comfortable to click. This is what the raycaster actually hits.
    const hitbox = new THREE.Mesh(
      new THREE.SphereGeometry(Math.max(project.placeholder.size * 1.9, 0.45), 12, 12),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hitbox.userData.projectId = project.id;
    pivot.add(hitbox);
    satellite.hitTargets.push(hitbox);

    if (project.model) {
      loader.load(project.model, (gltf) => {
        gltf.scene.scale.setScalar(project.placeholder.size * 4);
        visual.add(gltf.scene);
      });
    } else {
      const mesh = new THREE.Mesh(
        placeholderGeometry(project.placeholder),
        new THREE.MeshStandardMaterial({
          color: project.placeholder.color,
          roughness: 0.4,
          metalness: 0.05,
          envMapIntensity: 1.0,
        }),
      );
      visual.add(mesh);
    }

    satellites.push(satellite);
  }

  // Size the band from how far apart the orbits actually are, plus a margin.
  // Measuring from the globe's centre instead would make the band as wide as
  // the ring is distant, which swamps the whole scene.
  const radii = satellites.map((s) => s.worldRadius);
  const innermost = Math.min(...radii);
  const outermost = Math.max(...radii);
  const margin = Math.max(outermost - innermost, GLOBE_RADIUS * 0.05) * 0.6 + GLOBE_RADIUS * 0.04;
  const band = ringBand(
    Math.max(innermost - margin, GLOBE_RADIUS * 1.04),
    outermost + margin,
  );
  group.add(band);

  let highlighted: Satellite | null = null;

  return {
    group,
    satellites,
    pickables: () => satellites.flatMap((s) => s.hitTargets),
    setHighlighted(next) {
      if (highlighted === next) return;
      for (const satellite of satellites) {
        const material = satellite.orbitLine.material as THREE.LineBasicMaterial;
        material.opacity = satellite === next ? 1.0 : 0.5;
      }
      highlighted = next;
    },
    update(elapsed, delta) {
      for (const satellite of satellites) {
        const { orbit } = satellite.project;
        const theta = ((elapsed / orbit.period + orbit.phase) % 1) * Math.PI * 2;
        satellite.pivot.position.set(
          Math.cos(theta) * satellite.worldRadius,
          0,
          Math.sin(theta) * satellite.worldRadius,
        );
        // A tumble of its own, so the models read as objects rather than sprites.
        satellite.pivot.rotation.y += delta * 0.5;
        satellite.pivot.rotation.x += delta * 0.2;

        // Eased rather than snapped, so hovering across a cluster does not pop.
        const target = satellite === highlighted ? 1.35 : 1;
        const scale = satellite.visual.scale.x;
        satellite.visual.scale.setScalar(scale + (target - scale) * Math.min(delta * 9, 1));
      }
    },
  };
}
