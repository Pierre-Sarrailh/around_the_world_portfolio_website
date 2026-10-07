import * as THREE from 'three';

/** Direction the sun sits in. Shared with the lighting so the two agree. */
export const SUN_DIRECTION = new THREE.Vector3(0.45, 0.72, 0.52).normalize();

const SKY_RADIUS = 60;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    // The dome is centred on the scene, so a vertex's world position and the
    // direction to it are the same thing.
    vDirection = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec3 uSunDirection;
  uniform float uCoverage;
  uniform float uCloudScale;

  varying vec3 vDirection;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    // Smoothstep the interpolant so the cell grid does not show through.
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 5; i++) {
      total += amplitude * valueNoise(p);
      // Not exactly 2.0: an irrational-ish step stops octaves lining up.
      p *= 2.03;
      amplitude *= 0.5;
    }
    return total;
  }

  void main() {
    vec3 dir = normalize(vDirection);
    float height = dir.y;
    // The planet is suspended in open sky, not standing on ground, so the
    // dome is built symmetrically: blue overhead and underfoot, pale at the
    // horizon. Working from |height| is what removes the dead grey floor.
    float elevation = abs(height);

    vec3 sky = mix(uHorizon, uZenith, pow(clamp(elevation, 0.0, 1.0), 0.38));
    // The underside stays a little hazier, so up and down are still readable.
    sky = mix(sky, uHorizon, smoothstep(0.0, -0.6, height) * 0.4);

    float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
    sky += vec3(1.0, 0.94, 0.80) * pow(sun, 350.0) * 0.8;  // the disc
    sky += vec3(1.0, 0.95, 0.86) * pow(sun, 7.0) * 0.10;   // the haze around it

    // Clouds live on flat layers rather than on the dome itself, so they
    // converge towards the horizon the way real cloud cover does.
    float shell = max(elevation, 0.035);
    // Offset the lower layer so it is not a mirror image of the upper one.
    vec2 parallel = height < 0.0 ? vec2(37.4, 19.1) : vec2(0.0);
    vec2 plane = (dir.xz / shell) * uCloudScale + parallel;
    vec2 drift = vec2(uTime * 0.0045, uTime * 0.0020);

    // One round of domain warping turns featureless fbm into billows.
    vec2 warp = vec2(fbm(plane + drift), fbm(plane + drift + 5.2));
    float density = fbm(plane + drift + warp * 0.85);

    float cover = smoothstep(uCoverage, uCoverage + 0.26, density);
    // Fade the layer out near the horizon, where it would otherwise alias into
    // a hard band of noise. Kept shallow — the camera looks roughly level, so
    // most of the sky on screen is low elevation and a steep fade erases it.
    cover *= smoothstep(0.0, 0.10, elevation);
    // Thin the lower deck so the sky above still reads as the brighter half.
    cover *= mix(0.5, 1.0, smoothstep(-0.2, 0.2, height));

    // Denser parts read as lit tops, thinner edges as shaded underside.
    vec3 cloud = mix(uCloudShade, uCloudLit, smoothstep(uCoverage, uCoverage + 0.42, density));
    vec3 color = mix(sky, cloud, cover * 0.94);

    gl_FragColor = vec4(color, 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function skyUniforms() {
  return {
    uTime: { value: 0 },
    uZenith: { value: new THREE.Color('#2f6fc4') },
    uHorizon: { value: new THREE.Color('#cfe0ee') },
    uCloudLit: { value: new THREE.Color('#ffffff') },
    uCloudShade: { value: new THREE.Color('#9db0c6') },
    uSunDirection: { value: SUN_DIRECTION.clone() },
    // Raise for fewer clouds, lower for an overcast day.
    uCoverage: { value: 0.46 },
    uCloudScale: { value: 0.75 },
  };
}

export interface Sky {
  mesh: THREE.Mesh;
  /**
   * An environment map baked from this same sky. Assigning it to
   * `scene.environment` is what makes the lighting even: every surface picks up
   * colour from the whole dome rather than from a couple of lamps.
   */
  buildEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture;
  update(elapsed: number): void;
}

export function createSky(): Sky {
  const uniforms = skyUniforms();

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: THREE.BackSide,
    // The dome is always the furthest thing away, so it neither tests nor
    // writes depth and is drawn before everything else.
    depthTest: false,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 32), material);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;

  return {
    mesh,

    buildEnvironment(renderer) {
      // Baked once, from a copy that does depth normally — PMREM renders the
      // dome from the inside and needs it to behave like ordinary geometry.
      const bakeMaterial = material.clone();
      bakeMaterial.depthTest = true;
      bakeMaterial.depthWrite = true;

      const bakeScene = new THREE.Scene();
      const bakeMesh = new THREE.Mesh(mesh.geometry, bakeMaterial);
      bakeScene.add(bakeMesh);

      const pmrem = new THREE.PMREMGenerator(renderer);
      const target = pmrem.fromScene(bakeScene, 0, 1, SKY_RADIUS * 2);

      pmrem.dispose();
      bakeMaterial.dispose();

      return target.texture;
    },

    update(elapsed) {
      uniforms.uTime.value = elapsed;
    },
  };
}
