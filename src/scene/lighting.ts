import * as THREE from 'three';
import { SUN_DIRECTION } from './sky';

/**
 * Daylight, deliberately flat.
 *
 * Most of the illumination comes from `scene.environment` — the sky baked into
 * an environment map — which lights every surface from the whole dome at once.
 * These lights only shape it: enough sun for a direction, enough sky-and-ground
 * bounce that nothing falls into darkness. A strong key light here would put
 * half the face in shadow, which is exactly what we do not want.
 */
export function createLighting(): THREE.Group {
  const group = new THREE.Group();

  const sun = new THREE.DirectionalLight('#fff4e2', 0.9);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(30);

  // Sky above, pale ground bounce below. Kept low: the environment map is
  // already supplying roughly a full unit of diffuse light from every
  // direction, and stacking lamps on top of it just clips the texture to white.
  const bounce = new THREE.HemisphereLight('#bcd8f5', '#e7ded1', 0.35);

  // A thin floor of light so the far side of the globe never goes black.
  const ambient = new THREE.AmbientLight('#ffffff', 0.12);

  group.add(sun, bounce, ambient);
  return group;
}
