import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import './style.css';
import { PROJECTS } from './data/projects';
import { createGlobe, GLOBE_RADIUS } from './scene/globe';
import { createLighting } from './scene/lighting';
import { createSatellites } from './scene/satellites';
import { createSky } from './scene/sky';
import { createPicker } from './interaction/picker';
import { createPanel } from './interaction/panel';
import { createTooltip } from './interaction/tooltip';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const loadingOverlay = document.getElementById('loading') as HTMLElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Only ever seen for the first frame or two — the sky dome covers everything.
renderer.setClearColor('#cfe0f0');
// ACES is built for filmic highlight rolloff and drains the colour out of a
// bright blue sky. Neutral keeps the hue and still protects the highlights.
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();

// Far plane has to clear the sky dome; distances are all in globe radii.
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
// Far enough back that the whole head reads as a head. Closer than about 3.5
// radii and the sphere overflows the frame, leaving you looking at an eye.
camera.position.set(0, GLOBE_RADIUS * 0.45, GLOBE_RADIUS * 4.3);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = GLOBE_RADIUS * 1.8;
controls.maxDistance = GLOBE_RADIUS * 7;

const loadingManager = new THREE.LoadingManager();
loadingManager.onLoad = () => loadingOverlay.classList.add('loading--done');

const sky = createSky();
const globe = createGlobe(loadingManager);
const satellites = createSatellites(PROJECTS, loadingManager);

// Light everything from the sky itself, so the planet is evenly lit all round
// rather than having a bright side and a dark side.
scene.environment = sky.buildEnvironment(renderer);

scene.add(sky.mesh, createLighting(), globe.group, satellites.group);

const panel = createPanel();
const tooltip = createTooltip();

const picker = createPicker({
  canvas,
  camera,
  system: satellites,
  onHover(satellite, screen) {
    if (satellite) tooltip.show(satellite.project.title, screen.x, screen.y);
    else tooltip.hide();
  },
  onSelect(satellite) {
    panel.open(satellite.project);
  },
});

// Nothing loads on the very first frame if there are no external assets yet, so
// give the overlay a floor to dismiss against.
window.setTimeout(() => loadingOverlay.classList.add('loading--done'), 2500);

function resize() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width === width && canvas.height === height) return;

  renderer.setSize(width, height, false);
  // Capped: a 3x DPR phone does not need 3x the fragments.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

// Respecting this keeps the page usable for anyone who gets motion sick; the
// scene still renders and stays fully interactive, it just does not drift.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Timer rather than the deprecated Clock: connecting it to the document lets it
// use the Page Visibility API, so returning to a backgrounded tab does not
// arrive with one enormous delta.
const timer = new THREE.Timer();
timer.connect(document);

// Accumulated separately from the timer so that pausing for reduced motion
// never makes the orbits jump when it is switched back off.
let simulationTime = 0;

function frame() {
  timer.update();
  const delta = reducedMotion.matches ? 0 : Math.min(timer.getDelta(), 0.1);
  simulationTime += delta;

  resize();
  sky.update(simulationTime);
  globe.update(delta);
  satellites.update(simulationTime, delta);
  picker.update();
  controls.update();
  renderer.render(scene, camera);
}

renderer.setAnimationLoop(frame);
