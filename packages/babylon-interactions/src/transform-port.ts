/**
 * BabylonTransformPort - the read/write surface of one interactable's
 * Babylon node, honouring the core's FROM-REST semantics: the rest pose is
 * captured at construction and offsets and rotations apply relative to it,
 * so a behaviour composes with anything else animating the same node.
 *
 * Every write mutates the node's existing `Vector3`/`Quaternion` in place.
 * Babylon compares the live values against its cache to decide whether the
 * world matrix needs recomputing, so in-place writes are seen; assigning a
 * plain object in their place would break Babylon, which calls methods on
 * them.
 *
 * A node's held pose comes from one of two independent mechanisms. With
 * `options.physics` (a platform `PhysicsFacility` and the node's body id -
 * see `BabylonPhysicsFacility`), the port drives the core's held-pose rule
 * through it: `beginHold`/`endHold` suspend and resume the body there, and
 * every write that moves the node (`setWorldPose`, `setLocalOffset`,
 * `setLocalRotation`) keeps the body's own pose in step. Without it, a node
 * with a bare `node.physicsBody` and `options.physicsMotionTypes` keeps the
 * older, narrower hold this port has always had - see that option's own
 * comment. A construction never needs both.
 */
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  quatConjugate,
  quatMultiply,
  vAdd,
  vApplyQuat,
  vSub,
  type HoldRelease,
  type PhysicsFacility,
  type TransformPort,
} from "@realitycollective/webxr-interactions";
import {
  nodeWorldPose,
  parentOf,
  toQuat,
  toVec3,
  writeQuat,
  writeVec3,
  type BabylonMaterialLike,
  type BabylonQuaternionLike,
  type BabylonTransformNodeLike,
  type BabylonVector3Like,
} from "./babylon-types.js";

export interface BabylonTransformPortOptions {
  /**
   * Builds the `Quaternion` written to a node whose `rotationQuaternion` is
   * null - a node still driven by Euler `rotation`, which is Babylon's
   * default. Pass `() => Quaternion.Identity()` from `@babylonjs/core`.
   *
   * The fallback is a plain `{ x, y, z, w }` object, which carries the
   * numbers correctly but is NOT a Babylon `Quaternion` and will fail as
   * soon as Babylon calls a method on it. So: either give a node a real
   * `rotationQuaternion` before registering it, or supply this factory.
   * A node that already has one needs neither - it is mutated in place.
   */
  createQuaternion?: () => BabylonQuaternionLike;
  /**
   * The two `PhysicsMotionType` values `beginHold`/`endHold` switch a held
   * node's `physicsBody` between - pass Babylon's own
   * `{ animated: PhysicsMotionType.ANIMATED, dynamic: PhysicsMotionType.DYNAMIC }`.
   * This package holds no Babylon values, only shapes, so the app supplies
   * the actual enum members, the same idea as `createQuaternion`.
   *
   * `beginHold`/`endHold` exist on the port only when BOTH this option and
   * `node.physicsBody` are present at construction - a node with no
   * physics body, or a construction with no motion types, gets neither
   * member and behaves exactly as before. Ignored when `physics` is given.
   */
  physicsMotionTypes?: { animated: unknown; dynamic: unknown };
  /**
   * Drive the held-pose rule through the platform's physics facility
   * instead of `node.physicsBody` directly - the body id is the same
   * string id the node was registered under. Present, `beginHold`/`endHold`
   * suspend and resume the body there, and `setWorldPose`, `setLocalOffset`
   * and `setLocalRotation` all keep the body's pose in step with the node's.
   * Takes precedence over `physicsMotionTypes` when both are given.
   */
  physics?: BabylonTransformPortPhysics;
}

/** The body a port drives through the platform's `PhysicsFacility`. */
export interface BabylonTransformPortPhysics {
  facility: PhysicsFacility;
  /** The body's id in the facility - the interactable's own id. */
  bodyId: string;
}

export class BabylonTransformPort implements TransformPort {
  private readonly node: BabylonTransformNodeLike;
  private readonly createQuaternion: () => BabylonQuaternionLike;
  private restPosition: Vec3Tuple = [0, 0, 0];
  private restQuaternion: QuatTuple = [0, 0, 0, 1];
  private restScale: Vec3Tuple = [1, 1, 1];
  private held = false;
  /** The material's `emissiveColor` before any pulse, captured on first use. */
  private baseEmissiveColor: Vec3Tuple | null = null;
  /** PBRMaterial's `emissiveIntensity` before any pulse, captured on first use - StandardMaterial has none. */
  private baseEmissiveIntensity: number | null = null;
  private readonly physics: BabylonTransformPortPhysics | undefined;

  readonly beginHold?: () => void;
  readonly endHold?: (release: HoldRelease) => void;

  constructor(node: BabylonTransformNodeLike, options: BabylonTransformPortOptions = {}) {
    this.node = node;
    this.createQuaternion = options.createQuaternion ?? (() => ({ x: 0, y: 0, z: 0, w: 1 }));
    this.recaptureRest();

    this.physics = options.physics;
    if (this.physics) {
      const { facility, bodyId } = this.physics;
      this.beginHold = () => facility.suspend(bodyId);
      this.endHold = (release) => facility.resume(bodyId, release);
      return;
    }

    const body = node.physicsBody;
    const motionTypes = options.physicsMotionTypes;
    if (body && motionTypes) {
      this.beginHold = () => {
        this.held = true;
        // Node-drives-physics: our setWorldPose writes below now stick,
        // and gravity/collisions stop moving the node - see
        // BabylonPhysicsBodyLike's own comment.
        body.disablePreStep = true;
        body.setMotionType(motionTypes.animated);
      };
      this.endHold = (release) => {
        this.held = false;
        body.setMotionType(motionTypes.dynamic);
        body.disablePreStep = false;
        body.setLinearVelocity(vector3Like(release.linearVelocity));
        body.setAngularVelocity(vector3Like(release.angularVelocity));
      };
    }
  }

  /** Re-read the node's current local transform as the new rest. */
  recaptureRest(): void {
    this.restPosition = toVec3(this.node.position) ?? [0, 0, 0];
    this.restQuaternion = toQuat(this.node.rotationQuaternion);
    this.restScale = toVec3(this.node.scaling) ?? [1, 1, 1];
  }

  /** The node's LIVE world pose, from its absolute position and rotation. */
  getWorldPose(): PoseTuple {
    this.node.computeWorldMatrix?.(true);
    return nodeWorldPose(this.node);
  }

  /**
   * The captured rest pose in world space, resolved through the parent's
   * absolute position and rotation. Parent SCALE is ignored, the same
   * simplification as {@link setWorldPose}.
   */
  getRestWorldPose(): PoseTuple {
    const parent = parentOf(this.node);
    if (!parent) {
      return { position: [...this.restPosition], quaternion: [...this.restQuaternion] };
    }
    parent.computeWorldMatrix?.(true);
    const parentPose = nodeWorldPose(parent);
    return {
      position: vAdd(parentPose.position, vApplyQuat(this.restPosition, parentPose.quaternion)),
      quaternion: quatMultiply(parentPose.quaternion, this.restQuaternion),
    };
  }

  getLocalOffset(): Vec3Tuple {
    const delta = vSub(toVec3(this.node.position) ?? [0, 0, 0], this.restPosition);
    return vApplyQuat(delta, quatConjugate(this.restQuaternion));
  }

  setLocalOffset(offset: Vec3Tuple): void {
    writeVec3(this.node.position, vAdd(this.restPosition, vApplyQuat(offset, this.restQuaternion)));
    this.syncBody();
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.writeRotation(quatMultiply(this.restQuaternion, quaternion));
    this.syncBody();
  }

  /** A behaviour's write to the node reaches its facility-driven body too, as a placement (velocity cleared). */
  private syncBody(): void {
    if (!this.physics) return;
    this.physics.facility.setBodyPose(this.physics.bodyId, this.getWorldPose());
  }

  /**
   * Follow a world pose while grabbed, or place the node directly the rest
   * of the time (reset / teleport) - see `TransformPort.setWorldPose`'s own
   * comment for what the two mean on a node with physics. With a parent,
   * the pose is resolved into the parent's frame through its absolute
   * position and rotation.
   *
   * Simplification: parent SCALE is ignored. A grabbed object under a scaled
   * parent tracks the hand at the wrong distance. Grabbables are expected to
   * sit under an unscaled parent, which is how the demos build them.
   */
  setWorldPose(pose: PoseTuple): void {
    // With a facility-driven body, the facility owns its pose and velocity
    // and also places the node itself; the write below runs regardless, so
    // the node never lags the body even if the facility placed it slightly
    // differently (a scaled parent, for one - see BabylonPhysicsFacility's
    // own resolution).
    if (this.physics) this.physics.facility.setBodyPose(this.physics.bodyId, pose);
    const parent = parentOf(this.node);
    if (!parent) {
      writeVec3(this.node.position, pose.position);
      this.writeRotation(pose.quaternion);
    } else {
      const parentPose = nodeWorldPose(parent);
      const inverse = quatConjugate(parentPose.quaternion);
      writeVec3(this.node.position, vApplyQuat(vSub(pose.position, parentPose.position), inverse));
      this.writeRotation(quatMultiply(inverse, pose.quaternion));
    }
    // Not held: a physics-enabled node teleports and comes to rest, rather
    // than carrying whatever velocity it had a moment before ("back to the
    // tee"). A DYNAMIC body already picks up a direct node write on its
    // next pre-step (the same sync `beginHold`'s ANIMATED switch disables),
    // so all a reset needs on top of the write above is clearing velocity.
    const body = this.node.physicsBody;
    if (body && !this.held) {
      body.setLinearVelocity(ZERO_VECTOR3);
      body.setAngularVelocity(ZERO_VECTOR3);
    }
  }

  /**
   * Uniform scale about the rest scale, and - mirroring the IWSDK and
   * three.js ports - a pulse of light: `emissiveColor` is scaled by
   * `1 + effect.emissive` about its own base colour (StandardMaterial and
   * PBRMaterial both carry it), and on a PBRMaterial `emissiveIntensity` is
   * ALSO set to its base plus `effect.emissive`, the same additive rule
   * three.js's `emissiveIntensity` follows - PBRMaterial's field is that
   * one's Babylon analogue. A node with no material, or a material with no
   * `emissiveColor`, is left alone. Base values are captured on first use,
   * so a later `recaptureRest()`-style re-read is not needed for this part.
   */
  setEffect(effect: { scale?: number; emissive?: number }): void {
    if (effect.scale !== undefined) {
      const scaling = this.node.scaling;
      if (scaling) {
        writeVec3(scaling, [
          this.restScale[0] * effect.scale,
          this.restScale[1] * effect.scale,
          this.restScale[2] * effect.scale,
        ]);
      }
    }
    if (effect.emissive !== undefined) {
      const material = this.firstMaterial();
      if (material?.emissiveColor) {
        if (this.baseEmissiveColor === null) this.baseEmissiveColor = toVec3(material.emissiveColor) ?? [0, 0, 0];
        const factor = 1 + effect.emissive;
        writeVec3(material.emissiveColor, [
          this.baseEmissiveColor[0] * factor,
          this.baseEmissiveColor[1] * factor,
          this.baseEmissiveColor[2] * factor,
        ]);
        if (material.emissiveIntensity !== undefined) {
          if (this.baseEmissiveIntensity === null) this.baseEmissiveIntensity = material.emissiveIntensity;
          material.emissiveIntensity = this.baseEmissiveIntensity + effect.emissive;
        }
      }
    }
  }

  /** The node's first material slot - `AbstractMesh.material`, single or the first of an array. */
  private firstMaterial(): BabylonMaterialLike | null {
    const material = this.node.material;
    if (!material) return null;
    return Array.isArray(material) ? (material[0] ?? null) : material;
  }

  /** Write a quaternion, creating the node's `rotationQuaternion` if needed. */
  private writeRotation(value: QuatTuple): void {
    let target = this.node.rotationQuaternion;
    if (!target) {
      target = this.createQuaternion();
      this.node.rotationQuaternion = target;
    }
    writeQuat(target, value);
  }
}

/** A fresh plain `{ x, y, z }` - `setLinearVelocity`/`setAngularVelocity` only ever read it. */
function vector3Like(v: Vec3Tuple): BabylonVector3Like {
  return { x: v[0], y: v[1], z: v[2] };
}

const ZERO_VECTOR3: BabylonVector3Like = { x: 0, y: 0, z: 0 };
