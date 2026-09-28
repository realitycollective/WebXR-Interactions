/**
 * MemoryPhysicsFacility - the family's in-memory reference physics: an
 * engine-free `PhysicsFacility` that runs headlessly with the core defaults,
 * so the contract suite has a correct subject to prove itself against and a
 * new binding has a reference to compare with (the same idea as
 * `MemoryInputProvider` in `@realitycollective/webxr-input`).
 *
 * It simulates exactly what the contract cases need and states its limits:
 * gravity (with per-body factor and damping) integrated per step, spheres
 * against axis-aligned static or kinematic boxes with restitution combined
 * as the average of the two bodies (Rapier's default rule), and nothing
 * else: no sphere-to-sphere contact, no friction dynamics, no rotation of
 * boxes. It is not a game engine; a platform binding names a real one.
 */
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import type { HoldRelease } from "./ports.js";
import {
  PHYSICS_DEFAULTS,
  missingBody,
  resolvePhysicsBody,
  resolvePhysicsShape,
  type PhysicsBodySpec,
  type PhysicsBodyState,
  type PhysicsFacility,
  type PhysicsShapeSpec,
  type PhysicsVelocity,
} from "./physics.js";

interface Body {
  state: PhysicsBodyState;
  spec: Required<PhysicsBodySpec>;
  shape: Required<PhysicsShapeSpec>;
  position: Vec3Tuple;
  quaternion: QuatTuple;
  linear: Vec3Tuple;
  angular: Vec3Tuple;
  suspended: boolean;
}

function copy3(v: Readonly<Vec3Tuple>): Vec3Tuple {
  return [v[0], v[1], v[2]];
}

export class MemoryPhysicsFacility implements PhysicsFacility {
  readonly engine: string = "memory";
  private gravity: Vec3Tuple = copy3(PHYSICS_DEFAULTS.gravity);
  private readonly bodies = new Map<string, Body>();

  getGravity(): Vec3Tuple {
    return copy3(this.gravity);
  }

  setGravity(gravity: Vec3Tuple): void {
    this.gravity = copy3(gravity);
  }

  addBody(id: string, pose: PoseTuple, body: PhysicsBodySpec = {}, shape: PhysicsShapeSpec = {}): void {
    const spec = resolvePhysicsBody(body);
    this.bodies.set(id, {
      state: spec.state,
      spec,
      shape: resolvePhysicsShape(shape),
      position: copy3(pose.position),
      quaternion: [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]],
      linear: [0, 0, 0],
      angular: [0, 0, 0],
      suspended: false,
    });
  }

  removeBody(id: string): void {
    this.bodies.delete(id);
  }

  hasBody(id: string): boolean {
    return this.bodies.has(id);
  }

  setBodyState(id: string, state: PhysicsBodyState): void {
    const body = this.body(id);
    body.state = state;
    if (state !== "dynamic") {
      body.linear = [0, 0, 0];
      body.angular = [0, 0, 0];
    }
  }

  getBodyState(id: string): PhysicsBodyState {
    return this.body(id).state;
  }

  getBodyPose(id: string): PoseTuple {
    const body = this.body(id);
    return { position: copy3(body.position), quaternion: [...body.quaternion] as QuatTuple };
  }

  setBodyPose(id: string, pose: PoseTuple): void {
    const body = this.body(id);
    body.position = copy3(pose.position);
    body.quaternion = [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]];
    // A teleport rests the body; a write while held carries nothing either.
    body.linear = [0, 0, 0];
    body.angular = [0, 0, 0];
  }

  getVelocity(id: string): PhysicsVelocity {
    const body = this.body(id);
    return { linear: copy3(body.linear), angular: copy3(body.angular) };
  }

  setVelocity(id: string, velocity: PhysicsVelocity): void {
    const body = this.body(id);
    body.linear = copy3(velocity.linear);
    body.angular = copy3(velocity.angular);
  }

  suspend(id: string): void {
    const body = this.body(id);
    if (body.suspended) return;
    body.suspended = true;
    body.linear = [0, 0, 0];
    body.angular = [0, 0, 0];
  }

  resume(id: string, release: HoldRelease): void {
    const body = this.body(id);
    if (!body.suspended) return;
    body.suspended = false;
    body.linear = copy3(release.linearVelocity);
    body.angular = copy3(release.angularVelocity);
  }

  isSuspended(id: string): boolean {
    return this.body(id).suspended;
  }

  step(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    for (const body of this.bodies.values()) {
      if (body.state !== "dynamic" || body.suspended) continue;
      const g = body.spec.gravityFactor;
      body.linear[0] += this.gravity[0] * g * dtSeconds;
      body.linear[1] += this.gravity[1] * g * dtSeconds;
      body.linear[2] += this.gravity[2] * g * dtSeconds;
      const linearKeep = Math.max(0, 1 - body.spec.linearDamping * dtSeconds);
      const angularKeep = Math.max(0, 1 - body.spec.angularDamping * dtSeconds);
      body.linear = [body.linear[0] * linearKeep, body.linear[1] * linearKeep, body.linear[2] * linearKeep];
      body.angular = [body.angular[0] * angularKeep, body.angular[1] * angularKeep, body.angular[2] * angularKeep];
      body.position = [
        body.position[0] + body.linear[0] * dtSeconds,
        body.position[1] + body.linear[1] * dtSeconds,
        body.position[2] + body.linear[2] * dtSeconds,
      ];
      body.quaternion = integrateRotation(body.quaternion, body.angular, dtSeconds);
      if (body.shape.kind === "sphere") this.collideSphere(body);
    }
  }

  dispose(): void {
    this.bodies.clear();
  }

  private body(id: string): Body {
    const body = this.bodies.get(id);
    if (!body) throw missingBody(id);
    return body;
  }

  /** A moving sphere against every non-dynamic axis-aligned box: push out along the least-penetrated axis and reflect the normal velocity. */
  private collideSphere(sphere: Body): void {
    const radius = sphere.shape.dimensions[0];
    for (const other of this.bodies.values()) {
      if (other === sphere || other.shape.kind !== "box" || other.state === "dynamic") continue;
      const half: Vec3Tuple = [other.shape.dimensions[0] / 2, other.shape.dimensions[1] / 2, other.shape.dimensions[2] / 2];
      let bestAxis = -1;
      let bestDepth = Number.POSITIVE_INFINITY;
      let bestSign = 1;
      for (let axis = 0; axis < 3; axis++) {
        const delta = sphere.position[axis]! - other.position[axis]!;
        const depth = half[axis]! + radius - Math.abs(delta);
        if (depth <= 0) {
          bestAxis = -1;
          break;
        }
        if (depth < bestDepth) {
          bestDepth = depth;
          bestAxis = axis;
          bestSign = delta >= 0 ? 1 : -1;
        }
      }
      if (bestAxis < 0) continue;
      sphere.position[bestAxis] = sphere.position[bestAxis]! + bestSign * bestDepth;
      const normalVelocity = sphere.linear[bestAxis]! * bestSign;
      if (normalVelocity < 0) {
        const restitution = (sphere.shape.restitution + other.shape.restitution) / 2;
        sphere.linear[bestAxis] = -normalVelocity * restitution * bestSign;
      }
    }
  }
}

/** Advance a quaternion by an angular velocity (axis scaled by rad/s) over dt, first order. */
function integrateRotation(q: QuatTuple, angular: Vec3Tuple, dt: number): QuatTuple {
  const angle = Math.hypot(angular[0], angular[1], angular[2]) * dt;
  if (angle < 1e-9) return q;
  const half = angle / 2;
  const s = Math.sin(half) / (angle / dt) * dt;
  const d: QuatTuple = [angular[0] * s, angular[1] * s, angular[2] * s, Math.cos(half)];
  // d * q
  return [
    d[3] * q[0] + d[0] * q[3] + d[1] * q[2] - d[2] * q[1],
    d[3] * q[1] - d[0] * q[2] + d[1] * q[3] + d[2] * q[0],
    d[3] * q[2] + d[0] * q[1] - d[1] * q[0] + d[2] * q[3],
    d[3] * q[3] - d[0] * q[0] - d[1] * q[1] - d[2] * q[2],
  ];
}
