/**
 * RapierPhysicsFacility - the three.js platform's physics, over Rapier
 * (`@dimforge/rapier3d-compat`), the named default engine for three.js and
 * the one XR Blocks bundles. It implements the core `PhysicsFacility`
 * contract with the core defaults (`PHYSICS_DEFAULTS`: IWSDK's), so a body
 * here behaves as it does under Havok on IWSDK, and it is proved by
 * `physicsFacilityContractCases()` against the real engine.
 *
 * Rapier is reached through structural types (`RapierModuleLike`), not an
 * import: the app initialises the WASM module (`await RAPIER.init()`) and
 * hands it over, the same "the app supplies the engine value" rule
 * `BabylonTransformPortOptions.physicsMotionTypes` follows. An app may
 * replace this facility with its own by passing any `PhysicsFacility` to
 * `createThreeInteractions({ physics })`.
 *
 * What is Rapier's and what is the core's:
 * - a hold is `KinematicPositionBased` (IWSDK removes the body; Rapier keeps
 *   it so its collider still blocks), restored to the body's own type on
 *   resume with the release velocity;
 * - a teleport is `setTranslation`/`setRotation` with the velocities zeroed;
 * - restitution combines as Rapier's default (average of the two bodies);
 * - `"auto"` shapes are the object's world-space bounding box, which the
 *   facility computes from the `Object3D` the id resolves to.
 *
 * After each `step` the facility writes every dynamic body's pose back to
 * its object, so the scene follows the simulation without the app copying
 * poses itself (IWSDK's `PhysicsSystem` does the same for its entities).
 */
import { Box3, Matrix4, Quaternion, Vector3, type Object3D } from "three";
import type { PoseTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  PHYSICS_DEFAULTS,
  missingBody,
  resolvePhysicsBody,
  resolvePhysicsShape,
  type HoldRelease,
  type PhysicsBodySpec,
  type PhysicsBodyState,
  type PhysicsFacility,
  type PhysicsShapeSpec,
  type PhysicsVelocity,
} from "@realitycollective/webxr-interactions";

/** A Rapier `Vector` reading or argument. */
export interface RapierVec3Like {
  x: number;
  y: number;
  z: number;
}

/** A Rapier `Rotation` (quaternion) reading or argument. */
export interface RapierQuatLike extends RapierVec3Like {
  w: number;
}

/** The slice of a Rapier `RigidBodyDesc` builder this facility uses (each setter also returns the desc; unused here). */
export interface RapierRigidBodyDescLike {
  setTranslation(x: number, y: number, z: number): unknown;
  setRotation(rotation: RapierQuatLike): unknown;
  setLinearDamping(damping: number): unknown;
  setAngularDamping(damping: number): unknown;
  setGravityScale(scale: number): unknown;
}

/** The slice of a Rapier `ColliderDesc` builder this facility uses. */
export interface RapierColliderDescLike {
  setDensity(density: number): unknown;
  setRestitution(restitution: number): unknown;
  setFriction(friction: number): unknown;
}

/** The slice of a Rapier `RigidBody` this facility drives. */
export interface RapierBodyLike {
  translation(): RapierVec3Like;
  rotation(): RapierQuatLike;
  linvel(): RapierVec3Like;
  angvel(): RapierVec3Like;
  setTranslation(translation: RapierVec3Like, wakeUp: boolean): void;
  setRotation(rotation: RapierQuatLike, wakeUp: boolean): void;
  setLinvel(velocity: RapierVec3Like, wakeUp: boolean): void;
  setAngvel(velocity: RapierVec3Like, wakeUp: boolean): void;
  setBodyType(bodyType: number, wakeUp: boolean): void;
  setGravityScale(scale: number, wakeUp: boolean): void;
  wakeUp(): void;
}

/**
 * The slice of a Rapier `World` this facility drives. Generic over Rapier's
 * own body and descriptor classes (`B`, `D`, `C`), which the real module
 * fixes: a world creates bodies from its descriptors and takes the same
 * bodies back, and the facility never needs more of them than the `*Like`
 * slices say.
 */
export interface RapierWorldLike<B extends RapierBodyLike, D extends RapierRigidBodyDescLike, C extends RapierColliderDescLike> {
  gravity: RapierVec3Like;
  timestep: number;
  step(): void;
  createRigidBody(desc: D): B;
  createCollider(desc: C, parent: B): unknown;
  removeRigidBody(body: B): void;
  free(): void;
}

/**
 * The initialised Rapier module (`import RAPIER from "@dimforge/rapier3d-compat"`
 * after `await RAPIER.init()`), as far as this facility reads it. The real
 * module satisfies it as it is: `new RapierPhysicsFacility(RAPIER)`.
 */
export interface RapierModuleLike<B extends RapierBodyLike, D extends RapierRigidBodyDescLike, C extends RapierColliderDescLike> {
  World: new (gravity: RapierVec3Like) => RapierWorldLike<B, D, C>;
  RigidBodyDesc: {
    dynamic(): D;
    fixed(): D;
    kinematicPositionBased(): D;
  };
  ColliderDesc: {
    ball(radius: number): C;
    cuboid(halfX: number, halfY: number, halfZ: number): C;
    capsule(halfHeight: number, radius: number): C;
  };
  RigidBodyType: { Dynamic: number; Fixed: number; KinematicPositionBased: number };
}

/** A Rapier module of any body and descriptor classes: what a setup option accepts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRapierModule = RapierModuleLike<any, any, any>;

export interface RapierPhysicsFacilityOptions {
  /**
   * The scene object behind a body id, for `"auto"` shapes (its world
   * bounding box) and for writing simulated poses back after each step.
   * `createThreeInteractions` supplies the registered objects.
   */
  objectFor?: (id: string) => Object3D | undefined;
}

interface Entry<B> {
  body: B;
  state: PhysicsBodyState;
  suspended: boolean;
}

const V = new Vector3();
const Q = new Quaternion();
const M = new Matrix4();
const BOX = new Box3();

type B = RapierBodyLike;
type D = RapierRigidBodyDescLike;
type C = RapierColliderDescLike;

export class RapierPhysicsFacility implements PhysicsFacility {
  readonly engine = "rapier";
  readonly world: RapierWorldLike<B, D, C>;
  private readonly rapier: RapierModuleLike<B, D, C>;
  private readonly objectFor: (id: string) => Object3D | undefined;
  private readonly entries = new Map<string, Entry<B>>();

  /**
   * `rapier` is the initialised module. It is typed as `AnyRapierModule`
   * because TypeScript cannot match Rapier's own class-typed `World` (its
   * `createCollider(desc, parent: RigidBody)`) against the narrower slices
   * this facility reads; the slices above are still what it uses.
   */
  constructor(rapier: AnyRapierModule, options: RapierPhysicsFacilityOptions = {}) {
    this.rapier = rapier as RapierModuleLike<B, D, C>;
    this.objectFor = options.objectFor ?? (() => undefined);
    const g = PHYSICS_DEFAULTS.gravity;
    this.world = new rapier.World({ x: g[0], y: g[1], z: g[2] });
    this.world.timestep = 1 / PHYSICS_DEFAULTS.stepHz;
  }

  getGravity(): Vec3Tuple {
    const g = this.world.gravity;
    return [g.x, g.y, g.z];
  }

  setGravity(gravity: Vec3Tuple): void {
    this.world.gravity = { x: gravity[0], y: gravity[1], z: gravity[2] };
    // A body Rapier put to sleep would not notice the change.
    for (const entry of this.entries.values()) entry.body.wakeUp();
  }

  addBody(id: string, pose: PoseTuple, body: PhysicsBodySpec = {}, shape: PhysicsShapeSpec = {}): void {
    this.removeBody(id);
    const spec = resolvePhysicsBody(body);
    const shapeSpec = resolvePhysicsShape(shape);
    const desc = this.descFor(spec.state);
    desc.setTranslation(pose.position[0], pose.position[1], pose.position[2]);
    desc.setRotation({ x: pose.quaternion[0], y: pose.quaternion[1], z: pose.quaternion[2], w: pose.quaternion[3] });
    desc.setLinearDamping(spec.linearDamping);
    desc.setAngularDamping(spec.angularDamping);
    desc.setGravityScale(spec.gravityFactor);
    const rigid = this.world.createRigidBody(desc);
    const collider = this.colliderFor(id, shapeSpec);
    collider.setDensity(shapeSpec.density);
    collider.setRestitution(shapeSpec.restitution);
    collider.setFriction(shapeSpec.friction);
    this.world.createCollider(collider, rigid);
    this.entries.set(id, { body: rigid, state: spec.state, suspended: false });
  }

  removeBody(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.world.removeRigidBody(entry.body);
    this.entries.delete(id);
  }

  hasBody(id: string): boolean {
    return this.entries.has(id);
  }

  setBodyState(id: string, state: PhysicsBodyState): void {
    const entry = this.entry(id);
    entry.state = state;
    if (!entry.suspended) entry.body.setBodyType(this.typeFor(state), true);
  }

  getBodyState(id: string): PhysicsBodyState {
    return this.entry(id).state;
  }

  getBodyPose(id: string): PoseTuple {
    const body = this.entry(id).body;
    const t = body.translation();
    const r = body.rotation();
    return { position: [t.x, t.y, t.z], quaternion: [r.x, r.y, r.z, r.w] };
  }

  setBodyPose(id: string, pose: PoseTuple): void {
    const body = this.entry(id).body;
    body.setTranslation({ x: pose.position[0], y: pose.position[1], z: pose.position[2] }, true);
    body.setRotation({ x: pose.quaternion[0], y: pose.quaternion[1], z: pose.quaternion[2], w: pose.quaternion[3] }, true);
    // A teleport rests the body; a write while held carries nothing either.
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.writeObject(id, pose);
  }

  getVelocity(id: string): PhysicsVelocity {
    const body = this.entry(id).body;
    const l = body.linvel();
    const a = body.angvel();
    return { linear: [l.x, l.y, l.z], angular: [a.x, a.y, a.z] };
  }

  setVelocity(id: string, velocity: PhysicsVelocity): void {
    const body = this.entry(id).body;
    body.setLinvel({ x: velocity.linear[0], y: velocity.linear[1], z: velocity.linear[2] }, true);
    body.setAngvel({ x: velocity.angular[0], y: velocity.angular[1], z: velocity.angular[2] }, true);
  }

  suspend(id: string): void {
    const entry = this.entry(id);
    if (entry.suspended) return;
    entry.suspended = true;
    entry.body.setBodyType(this.rapier.RigidBodyType.KinematicPositionBased, true);
    entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  resume(id: string, release: HoldRelease): void {
    const entry = this.entry(id);
    if (!entry.suspended) return;
    entry.suspended = false;
    entry.body.setBodyType(this.typeFor(entry.state), true);
    this.setVelocity(id, { linear: release.linearVelocity, angular: release.angularVelocity });
  }

  isSuspended(id: string): boolean {
    return this.entry(id).suspended;
  }

  step(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    this.world.timestep = dtSeconds;
    this.world.step();
    for (const [id, entry] of this.entries) {
      if (entry.state === "dynamic" && !entry.suspended) this.writeObject(id, this.getBodyPose(id));
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) this.world.removeRigidBody(entry.body);
    this.entries.clear();
    this.world.free();
  }

  private entry(id: string): Entry<B> {
    const entry = this.entries.get(id);
    if (!entry) throw missingBody(id);
    return entry;
  }

  private descFor(state: PhysicsBodyState): D {
    if (state === "static") return this.rapier.RigidBodyDesc.fixed();
    if (state === "kinematic") return this.rapier.RigidBodyDesc.kinematicPositionBased();
    return this.rapier.RigidBodyDesc.dynamic();
  }

  private typeFor(state: PhysicsBodyState): number {
    if (state === "static") return this.rapier.RigidBodyType.Fixed;
    if (state === "kinematic") return this.rapier.RigidBodyType.KinematicPositionBased;
    return this.rapier.RigidBodyType.Dynamic;
  }

  private colliderFor(id: string, shape: Required<PhysicsShapeSpec>): C {
    const [a, b, c] = shape.dimensions;
    switch (shape.kind) {
      case "sphere":
        return this.rapier.ColliderDesc.ball(a);
      case "box":
        return this.rapier.ColliderDesc.cuboid(a / 2, b / 2, c / 2);
      case "capsule":
        return this.rapier.ColliderDesc.capsule(b / 2, a);
      case "auto": {
        const object = this.objectFor(id);
        if (!object) {
          throw new Error(`[threejs-interactions] an "auto" physics shape for "${id}" needs its scene object; pass objectFor, or an explicit shape`);
        }
        object.updateWorldMatrix(true, true);
        BOX.setFromObject(object);
        const size = BOX.getSize(V);
        // An object with no geometry (a bare Group) is a 10 cm sphere, the
        // same default a bare hit-test target gets.
        if (size.x <= 0 && size.y <= 0 && size.z <= 0) return this.rapier.ColliderDesc.ball(0.1);
        return this.rapier.ColliderDesc.cuboid(Math.max(size.x, 1e-3) / 2, Math.max(size.y, 1e-3) / 2, Math.max(size.z, 1e-3) / 2);
      }
    }
  }

  /** Write a world pose into the body's object, in its parent's frame. */
  private writeObject(id: string, pose: PoseTuple): void {
    const object = this.objectFor(id);
    if (!object) return;
    V.set(pose.position[0], pose.position[1], pose.position[2]);
    Q.set(pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]);
    const parent = object.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      M.copy(parent.matrixWorld).invert();
      V.applyMatrix4(M);
      const parentQuaternion = parent.getWorldQuaternion(new Quaternion()).invert();
      Q.premultiply(parentQuaternion);
    }
    object.position.copy(V);
    object.quaternion.copy(Q);
  }
}

