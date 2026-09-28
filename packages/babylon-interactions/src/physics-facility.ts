/**
 * BabylonPhysicsFacility - the Babylon platform's physics, over Physics V2
 * (Havok, or any plugin behind the same API): `PhysicsBody`, `PhysicsShape`
 * and `PhysicsMotionType`. It implements the core `PhysicsFacility` contract
 * with the core defaults (`PHYSICS_DEFAULTS`: IWSDK's), so a body here
 * behaves as it does under Havok on IWSDK itself, and is proved by
 * `physicsFacilityContractCases()`.
 *
 * `@babylonjs/core` (and `@babylonjs/havok`) are not dependencies of this
 * package, for the same reason the rest of `babylon-types.ts` is structural:
 * the app hands over the Havok-era values it already has, through
 * `BabylonPhysicsKitLike` (`PhysicsBody`, the `PhysicsShapeXxx`
 * constructors, `PhysicsMotionType`, `Vector3`, `Quaternion`) - the same
 * "the app supplies the engine values" rule
 * `BabylonTransformPortOptions.physicsMotionTypes` already follows. An app
 * may replace this facility with its own by passing any `PhysicsFacility` to
 * `createBabylonInteractions({ physics })`.
 *
 * What is Babylon's and what is the core's:
 * - a hold is `PhysicsMotionType.ANIMATED` with `disablePreStep` true (node
 *   drives physics - see `BabylonPhysicsBodyLike`'s own comment), restored
 *   to the body's own motion type with `disablePreStep` false on resume;
 * - a teleport writes the node (through its parent, as
 *   `BabylonTransformPort.setWorldPose` resolves one) and calls the body's
 *   own `setTargetTransform` with the velocities cleared;
 * - `"auto"` shapes use `PhysicsShapeMesh` over the node's own geometry, or
 *   a 0.1 m sphere for a node with none (`getTotalVertices()` zero, or
 *   absent - a bare `TransformNode`);
 * - Babylon steps physics itself from `scene.render()`; this facility's own
 *   `step` only forwards to the physics engine's internal `_step`, so a
 *   caller with no render loop (a test, or an app ticking physics on its
 *   own) can still advance the simulation.
 */
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  PHYSICS_DEFAULTS,
  missingBody,
  quatConjugate,
  quatMultiply,
  resolvePhysicsBody,
  resolvePhysicsShape,
  vApplyQuat,
  vSub,
  type HoldRelease,
  type PhysicsBodySpec,
  type PhysicsBodyState,
  type PhysicsFacility,
  type PhysicsShapeSpec,
  type PhysicsVelocity,
} from "@realitycollective/webxr-interactions";
import {
  nodeWorldPose,
  parentOf,
  writeQuat,
  writeVec3,
  type BabylonPhysicsBodyLike,
  type BabylonPhysicsKitLike,
  type BabylonPhysicsShapeLike,
  type BabylonQuaternionLike,
  type BabylonSceneLike,
  type BabylonTransformNodeLike,
  type BabylonVector3Like,
} from "./babylon-types.js";

export interface BabylonPhysicsFacilityOptions {
  /**
   * The node behind a body id - the same registered node
   * `createBabylonInteractions` looks up, needed to place the body and, for
   * an `"auto"` shape, to read its geometry.
   */
  nodeFor(id: string): BabylonTransformNodeLike | undefined;
}

interface Entry {
  node: BabylonTransformNodeLike;
  body: BabylonPhysicsBodyLike;
  shape: BabylonPhysicsShapeLike;
  state: PhysicsBodyState;
  suspended: boolean;
}

const ZERO_VECTOR3: BabylonVector3Like = { x: 0, y: 0, z: 0 };
const IDENTITY_QUATERNION: BabylonQuaternionLike = { x: 0, y: 0, z: 0, w: 1 };

function vector3Like(v: Vec3Tuple): BabylonVector3Like {
  return { x: v[0], y: v[1], z: v[2] };
}

function quaternionLike(q: QuatTuple): BabylonQuaternionLike {
  return { x: q[0], y: q[1], z: q[2], w: q[3] };
}

function copy3(v: Readonly<Vec3Tuple>): Vec3Tuple {
  return [v[0], v[1], v[2]];
}

export class BabylonPhysicsFacility implements PhysicsFacility {
  readonly engine = "havok";
  private readonly scene: BabylonSceneLike;
  private readonly kit: BabylonPhysicsKitLike;
  private readonly nodeFor: (id: string) => BabylonTransformNodeLike | undefined;
  private readonly entries = new Map<string, Entry>();
  /** Gravity for a scene with no physics engine attached yet - `scene.enablePhysics()` not called. */
  private fallbackGravity: Vec3Tuple = copy3(PHYSICS_DEFAULTS.gravity);

  constructor(scene: BabylonSceneLike, kit: BabylonPhysicsKitLike, options: BabylonPhysicsFacilityOptions) {
    this.scene = scene;
    this.kit = kit;
    this.nodeFor = options.nodeFor;
  }

  getGravity(): Vec3Tuple {
    const engine = this.physicsEngine();
    if (!engine) return copy3(this.fallbackGravity);
    return [engine.gravity.x, engine.gravity.y, engine.gravity.z];
  }

  setGravity(gravity: Vec3Tuple): void {
    const engine = this.physicsEngine();
    if (!engine) {
      this.fallbackGravity = copy3(gravity);
      return;
    }
    engine.setGravity(vector3Like(gravity));
  }

  addBody(id: string, pose: PoseTuple, body: PhysicsBodySpec = {}, shape: PhysicsShapeSpec = {}): void {
    this.removeBody(id);
    const node = this.nodeFor(id);
    if (!node) {
      throw new Error(`[babylon-interactions] no node for physics body "${id}"; pass nodeFor to BabylonPhysicsFacility`);
    }
    const spec = resolvePhysicsBody(body);
    const shapeSpec = resolvePhysicsShape(shape);
    // The node must already sit at `pose` before the body is constructed:
    // Havok reads the node's transform as the body's starting one.
    this.placeNode(node, pose);
    const physicsBody = new this.kit.PhysicsBody(node, this.motionTypeFor(spec.state), false, this.scene);
    physicsBody.disablePreStep = false;
    physicsBody.setLinearDamping(spec.linearDamping);
    physicsBody.setAngularDamping(spec.angularDamping);
    physicsBody.setGravityFactor(spec.gravityFactor);
    const physicsShape = this.shapeFor(node, shapeSpec);
    physicsShape.material = { friction: shapeSpec.friction, restitution: shapeSpec.restitution };
    physicsShape.density = shapeSpec.density;
    physicsBody.shape = physicsShape;
    this.entries.set(id, { node, body: physicsBody, shape: physicsShape, state: spec.state, suspended: false });
  }

  removeBody(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.body.dispose();
    entry.shape.dispose();
    this.entries.delete(id);
  }

  hasBody(id: string): boolean {
    return this.entries.has(id);
  }

  setBodyState(id: string, state: PhysicsBodyState): void {
    const entry = this.entry(id);
    entry.state = state;
    if (!entry.suspended) entry.body.setMotionType(this.motionTypeFor(state));
  }

  getBodyState(id: string): PhysicsBodyState {
    return this.entry(id).state;
  }

  getBodyPose(id: string): PoseTuple {
    const node = this.entry(id).node;
    node.computeWorldMatrix?.(true);
    return nodeWorldPose(node);
  }

  setBodyPose(id: string, pose: PoseTuple): void {
    const entry = this.entry(id);
    this.placeNode(entry.node, pose);
    entry.body.setTargetTransform(vector3Like(pose.position), quaternionLike(pose.quaternion));
    entry.body.setLinearVelocity(ZERO_VECTOR3);
    entry.body.setAngularVelocity(ZERO_VECTOR3);
  }

  getVelocity(id: string): PhysicsVelocity {
    const body = this.entry(id).body;
    const linear = body.getLinearVelocity();
    const angular = body.getAngularVelocity();
    return { linear: [linear.x, linear.y, linear.z], angular: [angular.x, angular.y, angular.z] };
  }

  setVelocity(id: string, velocity: PhysicsVelocity): void {
    const body = this.entry(id).body;
    body.setLinearVelocity(vector3Like(velocity.linear));
    body.setAngularVelocity(vector3Like(velocity.angular));
  }

  suspend(id: string): void {
    const entry = this.entry(id);
    if (entry.suspended) return;
    entry.suspended = true;
    entry.body.disablePreStep = true;
    entry.body.setMotionType(this.kit.PhysicsMotionType.ANIMATED);
    entry.body.setLinearVelocity(ZERO_VECTOR3);
    entry.body.setAngularVelocity(ZERO_VECTOR3);
  }

  resume(id: string, release: HoldRelease): void {
    const entry = this.entry(id);
    if (!entry.suspended) return;
    entry.suspended = false;
    entry.body.setMotionType(this.motionTypeFor(entry.state));
    entry.body.disablePreStep = false;
    entry.body.setLinearVelocity(vector3Like(release.linearVelocity));
    entry.body.setAngularVelocity(vector3Like(release.angularVelocity));
  }

  isSuspended(id: string): boolean {
    return this.entry(id).suspended;
  }

  step(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    this.physicsEngine()?._step?.(dtSeconds);
  }

  dispose(): void {
    for (const id of [...this.entries.keys()]) this.removeBody(id);
  }

  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw missingBody(id);
    return entry;
  }

  /** `scene.getPhysicsEngine()` - null on a scene without a method (a fake, or an old build) as well as one that has not enabled physics yet. */
  private physicsEngine() {
    return this.scene.getPhysicsEngine ? this.scene.getPhysicsEngine() : null;
  }

  private motionTypeFor(state: PhysicsBodyState): unknown {
    if (state === "static") return this.kit.PhysicsMotionType.STATIC;
    if (state === "kinematic") return this.kit.PhysicsMotionType.ANIMATED;
    return this.kit.PhysicsMotionType.DYNAMIC;
  }

  private shapeFor(node: BabylonTransformNodeLike, shapeSpec: Required<PhysicsShapeSpec>): BabylonPhysicsShapeLike {
    const [a, b] = shapeSpec.dimensions;
    switch (shapeSpec.kind) {
      case "sphere":
        return new this.kit.PhysicsShapeSphere(ZERO_VECTOR3, a, this.scene);
      case "box":
        return new this.kit.PhysicsShapeBox(ZERO_VECTOR3, IDENTITY_QUATERNION, vector3Like(shapeSpec.dimensions), this.scene);
      case "capsule": {
        // pointA/pointB are the capsule's two hemisphere centres along its
        // axis: the cylindrical part is `height - 2 * radius` long.
        const half = Math.max(0, b / 2 - a);
        return new this.kit.PhysicsShapeCapsule({ x: 0, y: half, z: 0 }, { x: 0, y: -half, z: 0 }, a, this.scene);
      }
      case "auto": {
        const vertices = node.getTotalVertices?.() ?? 0;
        if (vertices > 0) return new this.kit.PhysicsShapeMesh(node, this.scene);
        // A node with no geometry of its own (a bare TransformNode) is a
        // 10 cm sphere, the same default a bare hit-test target gets.
        return new this.kit.PhysicsShapeSphere(ZERO_VECTOR3, 0.1, this.scene);
      }
    }
  }

  /** Write a world pose into a node, through its parent's frame - the same resolution `BabylonTransformPort.setWorldPose` applies. */
  private placeNode(node: BabylonTransformNodeLike, pose: PoseTuple): void {
    const parent = parentOf(node);
    let position = pose.position;
    let quaternion = pose.quaternion;
    if (parent) {
      const parentPose = nodeWorldPose(parent);
      const inverse = quatConjugate(parentPose.quaternion);
      position = vApplyQuat(vSub(pose.position, parentPose.position), inverse);
      quaternion = quatMultiply(inverse, pose.quaternion);
    }
    writeVec3(node.position, position);
    const rotation = node.rotationQuaternion;
    if (rotation) {
      writeQuat(rotation, quaternion);
    } else {
      node.rotationQuaternion = new this.kit.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
    }
  }
}
