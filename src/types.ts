export interface ProjectLink {
  label: string;
  href: string;
}

/** Keplerian-ish parameters — enough to place a satellite, not to fly one. */
export interface Orbit {
  /**
   * Distance from the globe's centre, as a multiple of the globe's radius.
   * 1.0 is the surface. Keep every project close to the same value or the ring
   * stops reading as a ring.
   */
  radius: number;
  /**
   * Tilt of the orbital plane away from the ring plane, in degrees. A few
   * degrees gives the band depth; more than about ten breaks the formation.
   */
  inclination: number;
  /** Rotation of the orbital plane around the vertical axis, in degrees. */
  ascendingNode: number;
  /** Seconds for one full revolution. */
  period: number;
  /** Where along the orbit the satellite starts, 0–1. */
  phase: number;
}

export interface Placeholder {
  shape: 'icosahedron' | 'torus' | 'octahedron' | 'box';
  size: number;
  color: string;
}

export interface Project {
  id: string;
  title: string;
  tagline: string;
  description: string;
  tags: string[];
  links: ProjectLink[];
  orbit: Orbit;
  /** Path to a .glb under public/, e.g. '/models/project-one.glb'. */
  model?: string;
  /** Used when `model` is absent, so the scene is complete before the art is. */
  placeholder: Placeholder;
}
