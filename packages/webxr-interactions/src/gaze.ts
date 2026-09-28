/**
 * Gaze support - first-class, per the design decision that gaze serves two
 * roles:
 *
 * 1. **Combination gating** (`gaze.required`): input on an interactable only
 *    counts while the viewer is looking at it.
 * 2. **Accessibility** (`gaze.dwell`): looking at an interactable fills a
 *    dwell meter; a full meter fires a synthesized press - no hands needed.
 *    Consumers render the meter from `dwellProgress` events.
 *
 * The dwell state machine is pure and headless-tested. The runtime feeds it
 * hover booleans; it never sees the engine.
 */

import type { RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { InteractableHit } from "./ports.js";

export interface DwellConfig {
  /** Seconds of sustained gaze to fire. */
  holdSeconds?: number;
  /** Drain speed multiplier when looking away. */
  decayFactor?: number;
  /** After firing, progress must fall below this before it can re-arm. */
  rearmBelow?: number;
}

export interface GazeConfig {
  /** Non-gaze input on this interactable only counts while gazed at. */
  required?: boolean;
  /** Enable dwell-to-press. `true` uses defaults. */
  dwell?: boolean | DwellConfig;
}

export const DWELL_DEFAULTS: Required<DwellConfig> = {
  holdSeconds: 1.8,
  decayFactor: 2.5,
  rearmBelow: 0.1,
};

export function resolveDwellConfig(
  config: boolean | DwellConfig | undefined,
  defaults: Required<DwellConfig> = DWELL_DEFAULTS,
): Required<DwellConfig> | null {
  if (!config) return null;
  if (config === true) return defaults;
  return {
    holdSeconds: config.holdSeconds ?? defaults.holdSeconds,
    decayFactor: config.decayFactor ?? defaults.decayFactor,
    rearmBelow: config.rearmBelow ?? defaults.rearmBelow,
  };
}

export interface DwellTick {
  /** Dwell meter 0..1. */
  progress: number;
  /** Progress moved enough to be worth re-rendering (≥ 1%). */
  changed: boolean;
  /** The meter just completed - fire the synthesized press. */
  fired: boolean;
}

export class DwellState {
  private progress = 0;
  private lastReported = 0;
  private armed = true;

  update(hovered: boolean, dt: number, config: Required<DwellConfig>): DwellTick {
    const before = this.progress;
    if (hovered) {
      this.progress = Math.min(1, this.progress + dt / config.holdSeconds);
    } else {
      this.progress = Math.max(
        0,
        this.progress - (dt * config.decayFactor) / config.holdSeconds,
      );
    }

    let fired = false;
    if (this.armed && this.progress >= 1) {
      fired = true;
      this.armed = false;
      this.progress = 0;
    } else if (!this.armed && this.progress <= config.rearmBelow) {
      this.armed = true;
    }

    const changed =
      Math.abs(this.progress - this.lastReported) >= 0.01 ||
      (this.progress === 0 && before !== 0);
    if (changed) this.lastReported = this.progress;
    return { progress: this.progress, changed, fired };
  }

  getProgress(): number {
    return this.progress;
  }
}

// ---------------------------------------------------------------------------
// Eye gaze: the targeting half of the rule `@realitycollective/webxr-input`'s
// `eye-gaze.ts` states. IWSDK's `GazeConecaster` picks the frame's best
// in-cone candidate and then holds a time-weighted vote over the dwell
// window, so a flick across a neighbour does not steal hover.
// ---------------------------------------------------------------------------


/** Comparer tolerance: angular distances within this are "the same", and distance decides. IWSDK `ANGLE_EPSILON`. */
export const GAZE_CONE_ANGLE_EPSILON = 0.5 * (Math.PI / 180);

/** A cone hit: {@link InteractableHit} plus how far off the gaze axis the target's silhouette sat, radians (0 when the ray itself hit). */
export interface GazeConeHit extends InteractableHit {
  angularDistance: number;
}

/** A sphere target, as the approximate hit testers and the native host model one. */
export interface SphereTarget {
  id: string;
  center: Vec3Tuple;
  radius: number;
}

/**
 * IWSDK's `GazeConecaster.findFrameBest` over sphere targets: the best
 * target inside a cone of `halfAngle` radians about `ray`, no farther than
 * `maxLength`. A sphere the ray passes through is hit where the ray enters
 * it, with an angular distance of 0. Otherwise the angle from the ray to the
 * sphere's silhouette (the angle to its centre less the angle it subtends)
 * must be within the cone, and the point aimed at is the point of the sphere
 * nearest the ray. Closer by angle wins; within {@link GAZE_CONE_ANGLE_EPSILON}
 * the nearer target wins. A sphere the origin is inside counts as on axis.
 */
export function coneHitForSpheres(
  ray: RayTuple,
  targets: Iterable<SphereTarget>,
  halfAngle: number,
  maxLength: number,
): GazeConeHit | null {
  const [ox, oy, oz] = ray.origin;
  const [dx, dy, dz] = ray.direction;
  let best: GazeConeHit | null = null;
  for (const target of targets) {
    const [cx, cy, cz] = target.center;
    const r = target.radius;
    const vx = cx - ox;
    const vy = cy - oy;
    const vz = cz - oz;
    const dist = Math.hypot(vx, vy, vz);
    if (dist - r > maxLength) continue;
    let hit: GazeConeHit;
    if (dist <= r) {
      // The origin is inside the sphere: fully on axis, aimed at the centre.
      hit = { interactableId: target.id, distance: dist, point: [cx, cy, cz], angularDistance: 0 };
    } else {
      const t = vx * dx + vy * dy + vz * dz;
      const missSq = Math.max(0, dist * dist - t * t);
      const miss = Math.sqrt(missSq);
      if (t > 0 && miss <= r) {
        // The ray enters the sphere: the raw ray wins, at the entry point.
        const entry = t - Math.sqrt(r * r - missSq);
        if (entry > maxLength) continue;
        hit = {
          interactableId: target.id,
          distance: entry,
          point: [ox + dx * entry, oy + dy * entry, oz + dz * entry],
          angularDistance: 0,
        };
      } else {
        const toCentre = Math.atan2(miss, t);
        const angular = Math.max(0, toCentre - Math.asin(Math.min(1, r / dist)));
        if (angular > halfAngle) continue;
        // The point of the sphere nearest the ray: from the centre toward the
        // ray's closest point (never behind the origin), out to the surface.
        const tc = Math.max(0, t);
        let nx = ox + dx * tc - cx;
        let ny = oy + dy * tc - cy;
        let nz = oz + dz * tc - cz;
        const nl = Math.hypot(nx, ny, nz);
        if (nl > 1e-9) {
          nx /= nl;
          ny /= nl;
          nz /= nl;
        } else {
          nx = -vx / dist;
          ny = -vy / dist;
          nz = -vz / dist;
        }
        const point: Vec3Tuple = [cx + nx * r, cy + ny * r, cz + nz * r];
        const distance = Math.hypot(point[0] - ox, point[1] - oy, point[2] - oz);
        if (distance > maxLength) continue;
        hit = { interactableId: target.id, distance, point, angularDistance: angular };
      }
    }
    if (best === null || compareConeHits(hit, best) < 0) best = hit;
  }
  return best;
}

/** IWSDK's default comparer: closer by angle, then closer by distance. Negative when `a` is better. */
export function compareConeHits(a: GazeConeHit, b: GazeConeHit): number {
  const dAngle = a.angularDistance - b.angularDistance;
  if (Math.abs(dAngle) > GAZE_CONE_ANGLE_EPSILON) return dAngle;
  return a.distance - b.distance;
}

/**
 * IWSDK's dwell consensus (`GazeConecaster.recordDwell` / `pruneDwell` /
 * `electDwellWinner` / `resolveDwellWinner`): each frame's best candidate is
 * recorded with its `dt`; samples older than the window are dropped; the
 * candidate with the largest cumulative `dt` inside the window wins. A winner
 * that is no longer available (unregistered, disabled, hidden) is struck
 * from the record and the next is elected. A window of 0 keeps only this
 * frame's sample, so the frame's best wins outright.
 */
export class GazeConsensus {
  private readonly samples: Array<{ id: string; time: number; dt: number }> = [];
  private time = 0;

  constructor(public windowSeconds: number = 0.15) {}

  /** Record this frame's best (or none), advance the window and elect. */
  update(frameBestId: string | null, dt: number, available: (id: string) => boolean): string | null {
    this.time += dt;
    if (frameBestId !== null) this.samples.push({ id: frameBestId, time: this.time, dt });
    this.prune();
    for (;;) {
      const elected = this.elect();
      if (elected === null) return null;
      if (available(elected)) return elected;
      this.remove(elected);
    }
  }

  /** Advance the window with nothing recorded (a frame gaze was suppressed or had no pose). */
  skip(dt: number): void {
    this.time += dt;
  }

  reset(): void {
    this.samples.length = 0;
  }

  private prune(): void {
    const cutoff = this.time - this.windowSeconds;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop]!.time < cutoff) drop += 1;
    if (drop > 0) this.samples.splice(0, drop);
  }

  private elect(): string | null {
    let bestId: string | null = null;
    let bestDt = -1;
    const sums = new Map<string, number>();
    for (const sample of this.samples) sums.set(sample.id, (sums.get(sample.id) ?? 0) + sample.dt);
    // First recorded wins a tie, as IWSDK's scan from the ring head does.
    for (const sample of this.samples) {
      const sum = sums.get(sample.id)!;
      if (sum > bestDt) {
        bestDt = sum;
        bestId = sample.id;
      }
    }
    return bestId;
  }

  private remove(id: string): void {
    for (let i = this.samples.length - 1; i >= 0; i--) {
      if (this.samples[i]!.id === id) this.samples.splice(i, 1);
    }
  }
}
