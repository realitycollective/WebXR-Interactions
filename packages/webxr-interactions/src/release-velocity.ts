/**
 * The release velocity of a throw - the core rule, restated from what Meta
 * IWSDK 1.0.0 does with a held object so every platform's throw carries the
 * same speed on the same input.
 *
 * On the web a thrown object is carried by IWSDK's grab system and Havok.
 * While the object is `Grabbed`, `physics-system.js` sends the body a
 * `SetTargetTransform` command every frame with the object's pose (the pose
 * the grab pointer moved it to), so Havok drives the body kinematically to
 * that target at each 1/60 s step (`PHYSICS_DEFAULTS.stepsPerSecond`). When
 * the grab ends the tag is removed and nothing resets the body: it keeps the
 * velocity the engine gave it to reach the last target, the displacement of
 * the OBJECT over the last physics step divided by the step. So IWSDK's
 * throw is:
 *
 * - the velocity of the held OBJECT, not of the grip: for a rigid carry the
 *   two agree, but the rule is stated on the object, which every platform
 *   has, rather than on a runtime-reported hand velocity, which most do not;
 * - measured over the last physics step, `RELEASE_WINDOW_SECONDS` (1/60 s):
 *   at 72 Hz that is one frame, at 90 Hz two, at 120 Hz two;
 * - angular velocity from the orientation delta over the same window.
 *
 * `ReleaseVelocityTracker` keeps the poses the carry wrote and their frame
 * times; `release()` differentiates over the most recent frames that cover
 * the window, or over the last frame when only one has been seen. A hold
 * that never moved (or was released the frame it started) throws nothing:
 * zeros, so the object rests where it was let go. A synthesised release
 * (source lost, target unregistered, runtime disposed) never reads this: the
 * grab behaviour hands the port zeros, as `grab.ts` says.
 */
import { velocityBetween, type PoseTuple } from "@realitycollective/webxr-input";
import type { HoldRelease } from "./ports.js";

/** IWSDK's physics step, 1/60 s: the window a throw's velocity is measured over. */
export const RELEASE_WINDOW_SECONDS = 1 / 60;

/** How many past frames the tracker keeps: enough to cover the window at any refresh rate down to 30 Hz. */
const MAX_SAMPLES = 8;

interface Sample {
  pose: PoseTuple;
  /** Seconds between this pose and the one before it (0 for the first). */
  dt: number;
}

export interface ReleaseVelocityTrackerOptions {
  /** Seconds the release velocity is measured over. Default `RELEASE_WINDOW_SECONDS`. */
  windowSeconds?: number;
}

export class ReleaseVelocityTracker {
  private readonly window: number;
  private readonly samples: Sample[] = [];

  constructor(options: ReleaseVelocityTrackerOptions = {}) {
    const window = options.windowSeconds ?? RELEASE_WINDOW_SECONDS;
    if (!Number.isFinite(window) || window <= 0) {
      throw new Error(`[webxr-interactions] release window must be a positive number of seconds, got ${String(window)}`);
    }
    this.window = window;
  }

  /** Forget every pose: the hold starts afresh. */
  reset(): void {
    this.samples.length = 0;
  }

  /**
   * Record the pose the carry wrote this frame, `dt` seconds after the last
   * one. The tuples are copied, so the caller may reuse them.
   */
  record(pose: PoseTuple, dt: number): void {
    const copy: PoseTuple = {
      position: [pose.position[0], pose.position[1], pose.position[2]],
      quaternion: [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]],
    };
    const step = this.samples.length === 0 || !Number.isFinite(dt) || dt < 0 ? 0 : dt;
    this.samples.push({ pose: copy, dt: step });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  /** How many poses are recorded. */
  get size(): number {
    return this.samples.length;
  }

  /**
   * The velocity the object carries at release: linear m/s and angular
   * rad/s (axis scaled), world space, over the most recent frames that span
   * at least the window. Zeros with fewer than two poses, or no elapsed time.
   */
  release(): HoldRelease {
    const n = this.samples.length;
    if (n < 2) return { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
    let elapsed = 0;
    let start = n - 1;
    while (start > 0 && elapsed < this.window) {
      elapsed += this.samples[start]!.dt;
      start -= 1;
    }
    if (elapsed <= 0) return { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
    const velocity = velocityBetween(this.samples[start]!.pose, this.samples[n - 1]!.pose, elapsed);
    return { linearVelocity: velocity.linear, angularVelocity: velocity.angular };
  }
}
