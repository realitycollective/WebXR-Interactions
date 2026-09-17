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
 */
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import {
  quatConjugate,
  quatMultiply,
  vAdd,
  vApplyQuat,
  vSub,
  type TransformPort,
} from "@realitycollective/webxr-interactions";
import {
  nodeWorldPose,
  parentOf,
  toQuat,
  toVec3,
  writeQuat,
  writeVec3,
  type BabylonQuaternionLike,
  type BabylonTransformNodeLike,
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
}

export class BabylonTransformPort implements TransformPort {
  private readonly node: BabylonTransformNodeLike;
  private readonly createQuaternion: () => BabylonQuaternionLike;
  private restPosition: Vec3Tuple = [0, 0, 0];
  private restQuaternion: QuatTuple = [0, 0, 0, 1];
  private restScale: Vec3Tuple = [1, 1, 1];

  constructor(node: BabylonTransformNodeLike, options: BabylonTransformPortOptions = {}) {
    this.node = node;
    this.createQuaternion = options.createQuaternion ?? (() => ({ x: 0, y: 0, z: 0, w: 1 }));
    this.recaptureRest();
  }

  /** Re-read the node's current local transform as the new rest. */
  recaptureRest(): void {
    this.restPosition = toVec3(this.node.position) ?? [0, 0, 0];
    this.restQuaternion = toQuat(this.node.rotationQuaternion);
    this.restScale = toVec3(this.node.scaling) ?? [1, 1, 1];
  }

  /**
   * The node's LIVE world pose, from its absolute position and rotation.
   *
   * This differs from the three.js port, which reports the rest pose in
   * world space. Babylon computes absolutes for its own render anyway, so
   * reading them costs nothing and a grab starts from where the object
   * actually is rather than from where it was registered.
   */
  getWorldPose(): PoseTuple {
    this.node.computeWorldMatrix?.(true);
    return nodeWorldPose(this.node);
  }

  getLocalOffset(): Vec3Tuple {
    const delta = vSub(toVec3(this.node.position) ?? [0, 0, 0], this.restPosition);
    return vApplyQuat(delta, quatConjugate(this.restQuaternion));
  }

  setLocalOffset(offset: Vec3Tuple): void {
    writeVec3(this.node.position, vAdd(this.restPosition, vApplyQuat(offset, this.restQuaternion)));
  }

  setLocalRotation(quaternion: QuatTuple): void {
    this.writeRotation(quatMultiply(this.restQuaternion, quaternion));
  }

  /**
   * Follow a world pose while grabbed. With a parent, the pose is resolved
   * into the parent's frame through its absolute position and rotation.
   *
   * Simplification: parent SCALE is ignored. A grabbed object under a scaled
   * parent tracks the hand at the wrong distance. Grabbables are expected to
   * sit under an unscaled parent, which is how the demos build them.
   */
  setWorldPose(pose: PoseTuple): void {
    const parent = parentOf(this.node);
    if (!parent) {
      writeVec3(this.node.position, pose.position);
      this.writeRotation(pose.quaternion);
      return;
    }
    const parentPose = nodeWorldPose(parent);
    const inverse = quatConjugate(parentPose.quaternion);
    writeVec3(this.node.position, vApplyQuat(vSub(pose.position, parentPose.position), inverse));
    this.writeRotation(quatMultiply(inverse, pose.quaternion));
  }

  /**
   * Uniform scale about the rest scale. The emissive part of the intent is
   * not applied: reaching a material's emissive colour means knowing which
   * Babylon material the node carries, and this package holds no Babylon
   * types. Apps that want the glow subscribe to the core's feedback intents.
   */
  setEffect(effect: { scale?: number; emissive?: number }): void {
    if (effect.scale === undefined) return;
    const scaling = this.node.scaling;
    if (!scaling) return;
    writeVec3(scaling, [
      this.restScale[0] * effect.scale,
      this.restScale[1] * effect.scale,
      this.restScale[2] * effect.scale,
    ]);
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
