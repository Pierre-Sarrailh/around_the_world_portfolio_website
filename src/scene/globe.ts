import * as THREE from 'three';

/** Where the baked face texture is expected once the scan is processed. */
const FACE_TEXTURE = '/textures/face.webp';

/**
 * Radius of the globe, and the unit the rest of the scene is measured in:
 * orbit radii and camera distances are multiples of this, so changing it here
 * rescales the whole composition without anything drifting out of frame.
 */
export const GLOBE_RADIUS = 4;

/**
 * A stand-in texture so the scene is never empty. It draws a latitude/longitude
 * grid, which also makes it obvious which way the sphere's UVs run when you
 * come to line the real face up with them.
 */
function placeholderTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#4d6d8f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += canvas.width / 24) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += canvas.height / 12) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  // The front of the globe is a quarter of the way across an equirectangular
  // map, so this is roughly where the face will end up.
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('face texture goes here', canvas.width / 4, canvas.height / 2);
  ctx.font = '400 18px system-ui, sans-serif';
  ctx.fillText('public/textures/face.webp', canvas.width / 4, canvas.height / 2 + 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * A band of haze around the limb of the planet, on a slightly larger shell.
 *
 * Against a bright sky this has to be ordinary alpha rather than additive
 * blending — adding light to an already-light background does nothing visible.
 * The shell is front-facing so the fresnel term behaves the usual way round:
 * transparent where we look straight at it, opaque at the silhouette.
 */
function atmosphere(radius: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.FrontSide,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color('#eaf3ff') },
      uIntensity: { value: 0.33 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vViewDir = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormal;
      varying vec3 vViewDir;
      void main() {
        // Facing us head-on the dot is 1 and the shell disappears; at the
        // silhouette it falls to 0 and the haze is at full strength.
        float fresnel = pow(1.0 - clamp(dot(vNormal, vViewDir), 0.0, 1.0), 2.2);
        gl_FragColor = vec4(uColor, fresnel * uIntensity);
      }
    `,
  });

  return new THREE.Mesh(new THREE.SphereGeometry(radius * 1.03, 64, 64), material);
}

export interface Globe {
  group: THREE.Group;
  /** The sphere itself — handy for raycasting and for swapping materials. */
  mesh: THREE.Mesh;
  update(delta: number): void;
}

export function createGlobe(loadingManager: THREE.LoadingManager): Globe {
  const geometry = new THREE.SphereGeometry(GLOBE_RADIUS, 128, 128);
  const material = new THREE.MeshStandardMaterial({
    map: placeholderTexture(),
    roughness: 0.9,
    metalness: 0.0,
    envMapIntensity: 0.85,
  });

  const mesh = new THREE.Mesh(geometry, material);

  // Swap in the real face the moment it is available. Failing is fine and
  // expected before the scan is baked, so it is not routed through the
  // loading manager's error path.
  new THREE.TextureLoader(loadingManager).load(
    FACE_TEXTURE,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      material.map?.dispose();
      material.map = texture;
      material.needsUpdate = true;
    },
    undefined,
    () => {
      console.info(
        `[globe] no ${FACE_TEXTURE} yet — using the placeholder grid. ` +
          'See tools/README.md for how to bake the scan.',
      );
    },
  );

  const group = new THREE.Group();
  // An axial tilt, the way a planet has one.
  group.rotation.z = THREE.MathUtils.degToRad(14);
  group.add(mesh, atmosphere(GLOBE_RADIUS));

  return {
    group,
    mesh,
    update(delta) {
      // Slow enough to read as rotation rather than motion.
      mesh.rotation.y += delta * 0.045;
    },
  };
}
