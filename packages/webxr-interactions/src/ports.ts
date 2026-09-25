/**
 * Engine-side ports - the space queries and transform writes the core
 * cannot perform itself. Adapters implement these against their scene
 * graph; the core only ever speaks tuples and interactable ids.
 */
import type { PoseTuple, QuatTuple, RayTuple, Vec3Tuple } from "@realitycollective/webxr-input";

export interface InteractableHit {
  interactableId: string;
  /** Distance from the query origin (ray origin / probe point). */
  distance: number;
  /** World-space hit or closest point. */
  point: Vec3Tuple;
}

/**
 * Resolves which interactable a ray or a proximity probe touches.
 * Implemented by the adapter (three.js Raycaster, engine BVH, …). A
 * provider that pre-resolves targeting (IWSDK) may make this redundant -
 * provider hints always take precedence over hit-tester results.
 *
 * Each hit, and the `point` tuple in it, is a fresh value the caller owns.
 * A ray or point passed in is read during the call and not kept.
 */
export interface HitTester {
  hitRay(ray: RayTuple): InteractableHit | null;
  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null;
}

/**
 * The release velocities handed to {@link TransformPort.endHold} - the
 * grabbing source's velocity at the moment of release, so a throw carries
 * through. Linear is metres per second, angular is radians per second,
 * both in world space, both plain tuples: this crosses the same boundary
 * `PoseTuple`/`Vec3Tuple` do, so it carries no engine object either.
 */
export interface HoldRelease {
  linearVelocity: Vec3Tuple;
  angularVelocity: Vec3Tuple;
}

/**
 * The transform/effect surface of ONE interactable's scene object.
 * Behaviours write through this; the adapter owns how writes land
 * (Object3D fields, ECS components, …).
 *
 * Offsets/rotations are FROM REST: the adapter captures the rest pose at
 * registration and applies these relative to it, so behaviours compose
 * with anything else animating the same object (the pale-signal
 * non-destructive-offset rule).
 *
 * Every tuple a port returns is a fresh value the caller owns. The port
 * keeps no reference to it and never writes to it again. A tuple passed in
 * is read during the call and not kept, so the caller may reuse it.
 */
export interface TransformPort {
  /**
   * The LIVE world pose: where the object is now, after every offset,
   * rotation and world-pose write, including a write made by anything else.
   */
  getWorldPose(): PoseTuple;
  /**
   * The rest pose captured at registration, in world space. Offsets and
   * rotations are measured from it, so it stays put while the port writes.
   * It follows a parent that moves.
   */
  getRestWorldPose(): PoseTuple;
  /** Local-space pose relative to the captured rest (dragged observation). */
  getLocalOffset(): Vec3Tuple;
  /** Additive local-space offset from rest (driven press / slide). */
  setLocalOffset(offset: Vec3Tuple): void;
  /** Local rotation about the rest orientation (hinge / dial output). */
  setLocalRotation(quaternion: QuatTuple): void;
  /**
   * Follow a world pose while grabbed (poseOnly grab fulfilment), or place
   * the object directly the rest of the time (reset / teleport).
   *
   * On a host whose object has physics, the two situations mean different
   * things and a conforming port tells them apart with {@link beginHold}/
   * {@link endHold}: WHILE HELD - between a `beginHold` and its matching
   * `endHold` - the object follows every write exactly and its velocities
   * are left untouched, because physics is suspended for the hold. NOT
   * HELD, a write teleports the object there and clears its velocities, so
   * it comes to rest at the pose ("back to the tee") rather than carrying
   * whatever it was doing a moment before. A host with no physics has only
   * the one meaning: the object is simply placed there.
   */
  setWorldPose?(pose: PoseTuple): void;
  /** Additive presentation effect (pulse): scale multiplier & emissive boost. */
  setEffect?(effect: { scale?: number; emissive?: number }): void;
  /**
   * Suspend physics for this object: from here until the matching
   * `endHold`, it follows `setWorldPose` writes exactly and gravity /
   * collisions stop moving it - see {@link setWorldPose}.
   *
   * Present only on a port whose object carries a physics body; a port
   * with no physics never grows this member, so it behaves exactly as
   * before. A platform that fulfils grabs natively through its own engine
   * (`grabsNative`) must show the same three behaviours (held / released /
   * reset) through that engine - the runtime never calls `beginHold` for
   * one, because the engine, not `webxr-interactions`, already owns the
   * hold.
   */
  beginHold?(): void;
  /**
   * Resume physics, applying `release` as the body's new velocity so a
   * throw carries through. Present on the same terms as {@link beginHold}.
   */
  endHold?(release: HoldRelease): void;
}
