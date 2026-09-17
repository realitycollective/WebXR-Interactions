/**
 * The shape of the Babylon.js API this adapter reads, written out here
 * rather than imported.
 *
 * `@babylonjs/core` is NOT a dependency of this package, in the same way
 * the XR Blocks adapter does not depend on `xrblocks`. Babylon ships one
 * large package on a fast release train, and an adapter that imported it
 * would drag a version choice into every consumer and break on an upstream
 * rename. Matching the shape instead means an app installs whatever Babylon
 * it already uses and passes its objects straight in.
 *
 * The trade for that is honesty about provenance: these declarations were
 * written from the Babylon 7 documentation, not verified against an
 * installed package, so members a version might not carry are optional and
 * read defensively. Nothing here is required to be a Babylon object - a
 * plain object with the same members works, which is what the tests use.
 *
 * Coordinates: Babylon is LEFT-handed and a node's forward is +Z, where
 * three.js and raw WebXR use -Z. That difference is applied in one place
 * (`nodeForward`) so it is stated once.
 */
import type { PoseTuple, QuatTuple, Vec3Tuple } from "@realitycollective/webxr-input";
import { vApplyQuat } from "@realitycollective/webxr-interactions";

/** Structural slice of Babylon's `Vector3`. */
export interface BabylonVector3Like {
  x: number;
  y: number;
  z: number;
}

/** Structural slice of Babylon's `Quaternion`. */
export interface BabylonQuaternionLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Structural slice of Babylon's `Ray`. */
export interface BabylonRayLike {
  origin: BabylonVector3Like;
  direction: BabylonVector3Like;
}

/**
 * Structural slice of Babylon's `Observable<T>`. The observer handle is
 * opaque - it is only ever handed straight back to `remove`.
 */
export interface BabylonObservableLike<T> {
  add(callback: (eventData: T) => void): unknown;
  remove(observer: unknown): boolean;
}

/**
 * Structural slice of Babylon's `TransformNode`, plus the one member
 * `AbstractMesh` adds that this adapter reads (`isVisible`).
 *
 * `parent` is `unknown` on purpose: Babylon types it as `Nullable<Node>`,
 * and `Node` carries none of the transform members, so anything narrower
 * would refuse a real Babylon node. Read it through `parentOf`.
 */
export interface BabylonTransformNodeLike {
  position: BabylonVector3Like;
  rotationQuaternion?: BabylonQuaternionLike | null;
  scaling?: BabylonVector3Like;
  parent?: unknown;
  getAbsolutePosition(): BabylonVector3Like;
  absoluteRotationQuaternion?: BabylonQuaternionLike;
  computeWorldMatrix?(force?: boolean): unknown;
  setEnabled?(value: boolean): void;
  isEnabled?(checkAncestors?: boolean): boolean;
  isVisible?: boolean;
}

/** Structural slice of Babylon's `Camera`. */
export interface BabylonCameraLike {
  globalPosition?: BabylonVector3Like;
  absoluteRotation?: BabylonQuaternionLike;
  position?: BabylonVector3Like;
  getForwardRay?(length?: number): BabylonRayLike;
}

/** Structural slice of Babylon's `Engine` - only the frame delta is read. */
export interface BabylonEngineLike {
  getDeltaTime(): number;
}

/** Structural slice of Babylon's `PickingInfo`. */
export interface BabylonPickingInfoLike {
  hit?: boolean;
  distance?: number;
  pickedPoint?: BabylonVector3Like | null;
  pickedMesh?: BabylonTransformNodeLike | null;
  ray?: BabylonRayLike | null;
}

/**
 * Structural slice of Babylon's `PointerInfo`. `type` is one of the
 * `PointerEventTypes` constants - see {@link POINTER_EVENT_TYPES}.
 */
export interface BabylonPointerInfoLike {
  type: number;
  event?: { clientX?: number; clientY?: number; button?: number };
  pickInfo?: BabylonPickingInfoLike | null;
}

/**
 * The `PointerEventTypes` values this adapter reacts to. Babylon defines
 * them as one bit per event; these three are unchanged across 5, 6 and 7.
 */
export const POINTER_EVENT_TYPES = {
  down: 1,
  up: 2,
  move: 4,
} as const;

/** Structural slice of Babylon's `Scene`. */
export interface BabylonSceneLike {
  /**
   * Babylon defaults to a left-handed system with forward +Z. A scene that
   * sets this flag is right-handed and its nodes face -Z; the adapter reads
   * it once at construction.
   */
  useRightHandedSystem?: boolean;
  onBeforeRenderObservable?: BabylonObservableLike<unknown>;
  onPointerObservable?: BabylonObservableLike<BabylonPointerInfoLike>;
  pick?(x: number, y: number): BabylonPickingInfoLike | null;
  activeCamera?: BabylonCameraLike | null;
  getEngine?(): BabylonEngineLike;
}

/** Structural slice of one `WebXRControllerComponent` reading. */
export interface BabylonMotionControllerComponentLike {
  value?: number;
  pressed?: boolean;
}

/** Structural slice of Babylon's `WebXRAbstractMotionController`. */
export interface BabylonMotionControllerLike {
  getComponentOfType?(type: string): BabylonMotionControllerComponentLike | null;
  getMainComponent?(): BabylonMotionControllerComponentLike | null;
  pulse?(value: number, duration: number): Promise<unknown>;
  rootMesh?: BabylonTransformNodeLike | null;
}

/** Structural slice of Babylon's `WebXRInputSource`. */
export interface BabylonXRControllerLike {
  uniqueId: string;
  inputSource: {
    handedness?: string;
    hand?: unknown;
    gamepad?: { hapticActuators?: readonly unknown[] } | null;
  };
  pointer: BabylonTransformNodeLike;
  grip?: BabylonTransformNodeLike | null;
  motionController?: BabylonMotionControllerLike | null;
  onMotionControllerInitObservable?: BabylonObservableLike<unknown>;
}

/** Structural slice of Babylon's `WebXRInput`. */
export interface BabylonXRInputLike {
  controllers: readonly BabylonXRControllerLike[];
  onControllerAddedObservable?: BabylonObservableLike<BabylonXRControllerLike>;
  onControllerRemovedObservable?: BabylonObservableLike<BabylonXRControllerLike>;
}

/** Structural slice of one tracked hand from the hand-tracking feature. */
export interface BabylonXRHandLike {
  getJointMesh?(jointName: string): BabylonTransformNodeLike | null | undefined;
  handMesh?: BabylonTransformNodeLike | null;
}

/**
 * Structural slice of `WebXRHandTracking`, the feature the features manager
 * registers under `"xr-hand-tracking"`.
 */
export interface BabylonHandTrackingLike {
  getHandByControllerId(id: string): BabylonXRHandLike | null | undefined;
}

/** Structural slice of Babylon's `WebXRDefaultExperience`. */
export interface BabylonXRExperienceLike {
  baseExperience?: {
    sessionManager?: {
      session?: unknown;
      onXRSessionInit?: BabylonObservableLike<unknown>;
      onXRSessionEnded?: BabylonObservableLike<unknown>;
    };
    featuresManager?: { getEnabledFeature(featureName: string): unknown };
  };
  input?: BabylonXRInputLike;
}

/** The name Babylon registers hand tracking under in the features manager. */
export const HAND_TRACKING_FEATURE = "xr-hand-tracking";

/** Index fingertip joint, as WebXR and Babylon both spell it. */
export const INDEX_TIP_JOINT = "index-finger-tip";

// ---------------------------------------------------------------------------
// Conversions. Everything below turns Babylon-shaped objects into the core's
// tuples, or writes tuples back IN PLACE.
//
// In place is deliberate. Babylon caches the previous position/rotation and
// recomputes the world matrix when the live values differ, so mutating
// `node.position.x` is seen. Replacing `node.position` with a plain object is
// not just missed, it breaks Babylon, which calls Vector3 methods on it.
// ---------------------------------------------------------------------------

/** Copy a Babylon vector into a tuple. */
export function toVec3(v: BabylonVector3Like | null | undefined): Vec3Tuple | null {
  return v ? [v.x, v.y, v.z] : null;
}

/** Copy a Babylon quaternion into a tuple, defaulting to identity. */
export function toQuat(q: BabylonQuaternionLike | null | undefined): QuatTuple {
  return q ? [q.x, q.y, q.z, q.w] : [0, 0, 0, 1];
}

/** Write a tuple into an existing Babylon vector, in place. */
export function writeVec3(target: BabylonVector3Like, value: Vec3Tuple): void {
  target.x = value[0];
  target.y = value[1];
  target.z = value[2];
}

/** Write a tuple into an existing Babylon quaternion, in place. */
export function writeQuat(target: BabylonQuaternionLike, value: QuatTuple): void {
  target.x = value[0];
  target.y = value[1];
  target.z = value[2];
  target.w = value[3];
}

/** A node's world pose: absolute position and absolute rotation. */
export function nodeWorldPose(node: BabylonTransformNodeLike): PoseTuple {
  return {
    position: toVec3(node.getAbsolutePosition()) ?? [0, 0, 0],
    quaternion: toQuat(node.absoluteRotationQuaternion),
  };
}

/**
 * The world-space forward axis for a scene: +Z in Babylon's default
 * left-handed system, the opposite of three.js and of a raw WebXR target
 * ray, and -Z when the scene sets `useRightHandedSystem`.
 */
export function defaultForward(rightHanded = false): Vec3Tuple {
  return [0, 0, rightHanded ? -1 : 1];
}

/**
 * A node's forward direction in world space, honouring the scene's
 * handedness (see {@link defaultForward}).
 */
export function nodeForward(node: BabylonTransformNodeLike, rightHanded = false): Vec3Tuple {
  return vApplyQuat(defaultForward(rightHanded), toQuat(node.absoluteRotationQuaternion));
}

/**
 * The parent of a node, when it is one this adapter can read a world pose
 * from. Babylon types `parent` as `Node`, which has no transform, so a
 * parent that is a bone or a bare node reports null and the caller treats
 * the node as unparented.
 */
export function parentOf(node: BabylonTransformNodeLike): BabylonTransformNodeLike | null {
  const parent = node.parent;
  if (!parent || typeof parent !== "object") return null;
  const candidate = parent as Partial<BabylonTransformNodeLike>;
  return typeof candidate.getAbsolutePosition === "function"
    ? (parent as BabylonTransformNodeLike)
    : null;
}

/**
 * Is this node currently showing? A node the app disabled or hid is not a
 * hit-test candidate. Absent members mean yes - a fake, or a build that does
 * not carry them, should not silently drop out of targeting.
 */
export function nodeShowing(node: BabylonTransformNodeLike): boolean {
  if (node.isVisible === false) return false;
  return node.isEnabled ? node.isEnabled() !== false : true;
}
