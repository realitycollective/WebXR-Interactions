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
 */
export interface HitTester {
  hitRay(ray: RayTuple): InteractableHit | null;
  hitProximity(point: Vec3Tuple, radius: number): InteractableHit | null;
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
 */
export interface TransformPort {
  /** Current world pose. */
  getWorldPose(): PoseTuple;
  /** Local-space pose relative to the captured rest (dragged observation). */
  getLocalOffset(): Vec3Tuple;
  /** Additive local-space offset from rest (driven press / slide). */
  setLocalOffset(offset: Vec3Tuple): void;
  /** Local rotation about the rest orientation (hinge / dial output). */
  setLocalRotation(quaternion: QuatTuple): void;
  /** Follow a world pose while grabbed (poseOnly grab fulfilment). */
  setWorldPose?(pose: PoseTuple): void;
  /** Additive presentation effect (pulse): scale multiplier & emissive boost. */
  setEffect?(effect: { scale?: number; emissive?: number }): void;
}
