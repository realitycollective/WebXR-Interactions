/**
 * VelocityTracker - per-source linear and angular velocity, derived from
 * consecutive grip poses.
 *
 * Throw, flick and swipe all need to know how fast a hand was moving at
 * the moment it let go. WebXR does not report that, and most engines do
 * not either, so the core differentiates the poses it already samples.
 * A provider that CAN report velocity keeps its own numbers - the tracker
 * only fills gaps.
 *
 * The tracker is deliberately conservative. A source seen for the first
 * time (or seen again after dropping out of tracking) gets no velocity
 * that frame, so a reconnecting controller cannot report a metres-per-
 * second jump from wherever it was last seen.
 *
 * It keeps last frame's `position` and `quaternion` arrays by reference
 * rather than copying them. The ownership rule on `InputSourceSnapshot`
 * permits that: a provider never writes to a snapshot it has already
 * handed over, so last frame's tuples still hold last frame's numbers.
 */
import {
  velocityBetween,
  type InputSourceSnapshot,
  type PoseTuple,
  type Vec3Tuple,
} from "@realitycollective/webxr-input";

export interface VelocityTrackerOptions {
  /**
   * Exponential moving average factor in `(0, 1]`. 1 (the default) is no
   * smoothing - every frame reports the raw difference. Lower values trade
   * responsiveness for steadiness; 0.3 is a reasonable starting point when
   * the pose stream is noisy.
   */
  smoothing?: number;
}

interface Tracked {
  pose: PoseTuple;
  linear: Vec3Tuple | null;
  angular: Vec3Tuple | null;
}

const DEFAULT_SMOOTHING = 1;

export class VelocityTracker {
  private readonly smoothing: number;
  private readonly tracked = new Map<string, Tracked>();

  constructor(options: VelocityTrackerOptions = {}) {
    const smoothing = options.smoothing ?? DEFAULT_SMOOTHING;
    this.smoothing = smoothing > 0 && smoothing <= 1 ? smoothing : DEFAULT_SMOOTHING;
  }

  /**
   * Measure this frame's sources. Returns the same sources, with velocity
   * added to those the provider left without it. Sources with no grip pose
   * pass through untouched and hold no state.
   */
  update(sources: readonly InputSourceSnapshot[], dt: number): readonly InputSourceSnapshot[] {
    const seen = new Set<string>();
    const out: InputSourceSnapshot[] = [];

    for (const source of sources) {
      const pose = source.gripPose;
      if (!pose) {
        out.push(source);
        continue;
      }
      seen.add(source.id);
      const previous = this.tracked.get(source.id);
      const stored: Tracked = {
        pose: { position: pose.position, quaternion: pose.quaternion },
        linear: previous?.linear ?? null,
        angular: previous?.angular ?? null,
      };

      // First sighting, or a frame with no elapsed time: store the pose and
      // report nothing. Differentiating either would be a fabricated number.
      if (previous === undefined || !Number.isFinite(dt) || dt <= 0) {
        this.tracked.set(source.id, stored);
        out.push(source);
        continue;
      }

      const raw = velocityBetween(previous.pose, pose, dt);
      const linear = smooth(previous.linear, raw.linear, this.smoothing);
      const angular = smooth(previous.angular, raw.angular, this.smoothing);
      stored.linear = linear;
      stored.angular = angular;
      this.tracked.set(source.id, stored);

      // The provider's own numbers always win - it may have them from the
      // platform, which knows better than a difference of two samples.
      const needsLinear = source.linearVelocity === undefined;
      const needsAngular = source.angularVelocity === undefined;
      if (!needsLinear && !needsAngular) {
        out.push(source);
        continue;
      }
      out.push({
        ...source,
        ...(needsLinear ? { linearVelocity: linear } : {}),
        ...(needsAngular ? { angularVelocity: angular } : {}),
      });
    }

    // A source that stopped reporting starts fresh when it comes back.
    for (const id of [...this.tracked.keys()]) {
      if (!seen.has(id)) this.tracked.delete(id);
    }
    return out;
  }

  /** Forget every tracked source (session end, teleport, scene change). */
  reset(): void {
    this.tracked.clear();
  }
}

function smooth(previous: Vec3Tuple | null, raw: Vec3Tuple, factor: number): Vec3Tuple {
  if (previous === null || factor >= 1) return raw;
  return [
    previous[0] + (raw[0] - previous[0]) * factor,
    previous[1] + (raw[1] - previous[1]) * factor,
    previous[2] + (raw[2] - previous[2]) * factor,
  ];
}
