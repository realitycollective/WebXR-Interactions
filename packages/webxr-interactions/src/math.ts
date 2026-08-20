/**
 * Pure interaction math - the proven motion functions extracted from the
 * Pale Signal research (springs, hinge/dial normalisation, hoop scoring),
 * plus the tuple vector/quaternion helpers the binder and behaviours need.
 * No engine imports; everything is unit-tested headless.
 */
import type { QuatTuple, RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";

/** Clamp to the unit interval. */
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Normalize a measured displacement/angle against a signed range to 0..1.
 * Sign-agnostic: a range of `-π/2` maps `-π/2 → 1`.
 */
export function normalize01(value: number, range: number): number {
  if (range === 0) return 0;
  return clamp01(value / range);
}

/**
 * Did a tossed object pass *through* a hoop this frame? True when it crossed
 * the hoop plane in the scoring direction (downward - `prev` above, `curr`
 * at/below) while inside the ring (`radial <= radius`).
 */
export function passedThroughHoop(
  prevAlong: number,
  currAlong: number,
  planeAlong: number,
  radial: number,
  radius: number,
): boolean {
  const crossedDown = prevAlong > planeAlong && currAlong <= planeAlong;
  return crossedDown && radial <= radius;
}

/**
 * One step of a damped harmonic oscillator (semi-implicit Euler).
 * `out[0]` = next value, `out[1]` = next velocity. An under-damped spring
 * (damping ratio ≈ 0.3-0.5) is what gives a pressed button its bounce.
 * `dt` is clamped to 1/30 s so a long frame can't blow the integrator up.
 */
export function springStep(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
  out: Float32Array = new Float32Array(2),
): Float32Array {
  const h = Math.min(dt, 1 / 30);
  const accel = -stiffness * (value - target) - damping * velocity;
  const nextVelocity = velocity + accel * h;
  out[0] = value + nextVelocity * h;
  out[1] = nextVelocity;
  return out;
}

/** Exponential decay of `value` toward 0 over `dt` at `ratePerSec`. */
export function decay(value: number, ratePerSec: number, dt: number): number {
  const next = value * Math.exp(-ratePerSec * Math.max(dt, 0));
  return next < 1e-4 ? 0 : next;
}

/** Penner's ease-out-bounce on `t ∈ [0,1]`. */
export function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  let x = clamp01(t);
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

/** Clamp a value to the symmetric range `[-|mag|, +|mag|]`. */
export function clampSym(x: number, mag: number): number {
  const m = Math.abs(mag);
  return x < -m ? -m : x > m ? m : x;
}

/**
 * Hinge angle for a position-driven lever: given the hand's offset from the
 * pivot resolved into the hinge plane - `alongRest` (toward the arm's rest
 * direction) and `alongSwing` (the in-plane perpendicular) - the angle the
 * arm should take to point at the hand, clamped to `±|maxMag|`.
 */
export function hingeAngleToHand(alongRest: number, alongSwing: number, maxMag: number): number {
  return clampSym(Math.atan2(alongSwing, alongRest), maxMag);
}

/**
 * Map a centered hinge angle in `[-|mag|, +|mag|]` to a 0..1 analog value
 * with the rest (0) at 0.5 - a bidirectional lever as one normalized value.
 */
export function centeredUnit(angle: number, mag: number): number {
  const m = Math.abs(mag);
  if (m < 1e-6) return 0.5;
  return clamp01(0.5 + (0.5 * angle) / m);
}

// ---------------------------------------------------------------------------
// Tuple vector / quaternion helpers (allocation-light, no engine types).
// ---------------------------------------------------------------------------

export function vSub(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vAdd(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vScale(a: Vec3Tuple, s: number): Vec3Tuple {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vDot(a: Vec3Tuple, b: Vec3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vCross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vLength(a: Vec3Tuple): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function vDistance(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function vNormalize(a: Vec3Tuple): Vec3Tuple {
  const l = vLength(a);
  return l < 1e-9 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Quaternion from an axis (normalised) and an angle in radians. */
export function quatFromAxisAngle(axis: Vec3Tuple, angle: number): QuatTuple {
  const half = angle / 2;
  const s = Math.sin(half);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
}

export function quatMultiply(a: QuatTuple, b: QuatTuple): QuatTuple {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function quatConjugate(q: QuatTuple): QuatTuple {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Rotate a vector by a quaternion. */
export function vApplyQuat(v: Vec3Tuple, q: QuatTuple): Vec3Tuple {
  const [x, y, z] = v;
  const [qx, qy, qz, qw] = q;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);
  // v + qw * t + cross(q.xyz, t)
  return [
    x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx,
  ];
}

/** Transform a world-space point into the local frame of `pose`. */
export function worldToLocal(
  point: Vec3Tuple,
  posePosition: Vec3Tuple,
  poseQuaternion: QuatTuple,
): Vec3Tuple {
  return vApplyQuat(vSub(point, posePosition), quatConjugate(poseQuaternion));
}

/** Closest-approach distance from a ray to a point, and the along-ray t. */
export function rayPointDistance(ray: RayTuple, point: Vec3Tuple): { distance: number; t: number } {
  const toPoint = vSub(point, ray.origin);
  const t = vDot(toPoint, ray.direction);
  if (t <= 0) return { distance: vLength(toPoint), t: 0 };
  const closest = vAdd(ray.origin, vScale(ray.direction, t));
  return { distance: vDistance(closest, point), t };
}

/** Angular offset (radians) between a ray direction and the direction to a point. */
export function rayAngleTo(ray: RayTuple, point: Vec3Tuple): number {
  const dir = vNormalize(vSub(point, ray.origin));
  const d = vDot(vNormalize(ray.direction), dir);
  return Math.acos(Math.min(1, Math.max(-1, d)));
}
