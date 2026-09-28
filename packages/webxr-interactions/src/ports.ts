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
  /**
   * The nearest target along `ray` (origin in metres, direction normalised),
   * or `null`. A target counts when its centre is within its own radius of
   * the ray line and in front of the origin; `distance` is the ray parameter
   * `t` of the closest point, and `t <= 0` never hits. This is IWSDK's
   * `EntityHitTester.hitRay` (`iwsdk-interactions/src/register.ts`). A
   * mesh-accurate tester may report the surface it hit instead, within the
   * target's radius of that answer; `hitTesterContractCases()` holds both to
   * the same tolerance.
   *
   * A target hidden by its engine's own visibility flag - including one
   * inherited from an ancestor - is never a candidate, even on an engine
   * whose own raycast ignores that flag by design (three.js's `Raycaster`
   * does; see `ThreeHitTester.hitRay`). The adapter re-applies the rule
   * itself in that case.
   */
  hitRay(ray: RayTuple): InteractableHit | null;
  /**
   * The nearest target to `point` within `radius` metres of its SURFACE, or
   * `null`. `distance` is `max(0, |centre - point| - targetRadius)`: a point
   * 3 cm outside a 10 cm target reports 0.03, and a point inside reports 0.
   * Never the distance to the centre, which would put every fingertip out of
   * poke range. This is IWSDK's `EntityHitTester.hitProximity`, and a target
   * registered with no declared radius is a 0.1 m sphere - IWSDK's default,
   * and the one every adapter that lets a target omit its radius (three.js,
   * XR Blocks, Babylon) uses too. The same hidden-target rule as
   * {@link hitRay} applies here.
   */
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
  /**
   * Presentation effect (the pulse behaviour): `scale` multiplies the REST
   * scale (1 is rest size) and `emissive` is ADDED to the material's base
   * emissive intensity (0 is none). Each field replaces the previous value
   * for this object: the last write wins, and nothing accumulates across
   * calls, so a behaviour that combines effects (pulse stacking on a press)
   * computes the combined value before it writes. An omitted field is left
   * as it is. This is `IWSDKTransformPort.setEffect`.
   */
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
