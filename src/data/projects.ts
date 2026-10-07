import type { Project } from '../types';

/**
 * Every orbiting object in the scene comes from this list. To add a project,
 * append an entry — the scene, the raycaster and the panel all read from here.
 *
 * `model` is a path under public/. Leave it undefined and the project gets a
 * procedural placeholder shape, so you can lay out the whole system before any
 * of the real models exist.
 *
 * ## Keeping the ring a ring
 *
 * The satellites are meant to read as one band around the planet rather than as
 * separate orbits, so the numbers below deliberately sit close together:
 *
 *   radius       all near 1.55 — the spread is what gives the band depth
 *   inclination  within a few degrees of 0, so nothing leaves the plane
 *   period       all near 60s, so the formation holds instead of smearing out
 *   phase        evenly spaced, so they are never bunched on one side
 *
 * The small differences are the point: identical values would look mechanical.
 * Widen them and the ring stops being a ring.
 */
export const PROJECTS: Project[] = [
  {
    id: 'project-one',
    title: 'Project One',
    tagline: 'A one-line hook that makes someone want to read on.',
    description: `Two or three sentences on what this is, what problem it solves and
      what you actually built. Keep it human — the detail lives behind the links.`,
    tags: ['TypeScript', 'WebGL'],
    links: [
      { label: 'Live site', href: 'https://example.com' },
      { label: 'Source', href: 'https://github.com/' },
    ],
    orbit: {
      // Multiples of the globe's radius.
      radius: 1.52,
      // Degrees of tilt away from the ring plane.
      inclination: 3,
      // Degrees around the vertical axis.
      ascendingNode: 0,
      // Seconds for one full revolution.
      period: 58,
      // 0–1 starting position along the orbit.
      phase: 0,
    },
    placeholder: { shape: 'icosahedron', size: 0.5, color: '#d94f3d' },
  },
  {
    id: 'project-two',
    title: 'Project Two',
    tagline: 'Another hook.',
    description: `What it is and why it was interesting to build.`,
    tags: ['Python', 'Computer vision'],
    links: [{ label: 'Write-up', href: 'https://example.com' }],
    orbit: { radius: 1.58, inclination: -2.5, ascendingNode: 12, period: 62, phase: 0.34 },
    placeholder: { shape: 'torus', size: 0.34, color: '#2f8f9d' },
  },
  {
    id: 'project-three',
    title: 'Project Three',
    tagline: 'And a third.',
    description: `Swap this text and the orbit numbers until the motion feels right.`,
    tags: ['Three.js'],
    links: [{ label: 'Source', href: 'https://github.com/' }],
    orbit: { radius: 1.55, inclination: 1.5, ascendingNode: -9, period: 60, phase: 0.67 },
    placeholder: { shape: 'octahedron', size: 0.55, color: '#e8a33d' },
  },
];
