import * as THREE from 'three';
import type { Satellite, SatelliteSystem } from '../scene/satellites';

interface PickerOptions {
  canvas: HTMLCanvasElement;
  camera: THREE.Camera;
  system: SatelliteSystem;
  onHover(satellite: Satellite | null, screen: { x: number; y: number }): void;
  onSelect(satellite: Satellite): void;
}

/**
 * Turns pointer events into satellite hits. Hover is resolved once per frame
 * from the latest pointer position rather than on every pointermove, so a fast
 * drag does not queue up dozens of raycasts.
 */
export function createPicker({ canvas, camera, system, onHover, onSelect }: PickerOptions) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const screen = { x: 0, y: 0 };

  let pointerInside = false;
  let hovered: Satellite | null = null;
  // Distinguishes a click from the end of an orbit-controls drag.
  let downAt: { x: number; y: number } | null = null;

  const byId = new Map<string, Satellite>();
  for (const satellite of system.satellites) byId.set(satellite.project.id, satellite);

  function updatePointer(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    screen.x = event.clientX;
    screen.y = event.clientY;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  canvas.addEventListener('pointermove', (event) => {
    pointerInside = true;
    updatePointer(event);
  });

  canvas.addEventListener('pointerleave', () => {
    pointerInside = false;
  });

  canvas.addEventListener('pointerdown', (event) => {
    updatePointer(event);
    downAt = { x: event.clientX, y: event.clientY };
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!downAt) return;
    const moved = Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return; // that was a camera drag

    updatePointer(event);
    const hit = pick();
    if (hit) onSelect(hit);
  });

  function pick(): Satellite | null {
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(system.pickables(), false);
    const id = intersections[0]?.object.userData.projectId as string | undefined;
    return id ? (byId.get(id) ?? null) : null;
  }

  return {
    /** Call once per frame, after the satellites have moved. */
    update() {
      const next = pointerInside ? pick() : null;
      if (next !== hovered) {
        hovered = next;
        canvas.style.cursor = next ? 'pointer' : 'grab';
        system.setHighlighted(next);
      }
      onHover(hovered, screen);
    },
  };
}
