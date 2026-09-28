/**
 * The `input` and `interactions` slices a native host (OpenXR on Quest,
 * CompositorServices on visionOS, or any other shell embedding a JavaScript
 * engine such as Hermes) installs on `globalThis.__rcHost`.
 *
 * A HOST IS HANDED RESULTS, NOT RULES. Every rule the IWSDK binding applies
 * in its provider runs in this package from the same inputs: capabilities
 * are derived here from the facts the host reports, the presence modality
 * is decided here and handed to the host per side, and a target's radius is
 * handed to the host at registration. The host measures, renders and
 * reports. Each member below states what the host does, in what units and
 * with what sign, and which IWSDK line it stands in for.
 *
 * `NativeInteractionHost` is `HitTester` plus `TransformPort` from
 * `@realitycollective/webxr-interactions`, with a `targetId` added to every
 * `TransformPort` member because that port is per object and the host is one
 * object serving every registered interactable. Declaring the shapes here,
 * rather than reusing the originals by reference, is deliberate: this file is
 * the one place that states what crosses the native boundary, in the same
 * structural-typing style as `babylon-types.ts` and the XR Blocks `XB*Like`
 * types.
 *
 * Values that cross are plain: numbers, strings, booleans and tuples. No
 * engine objects in either direction, and assets stay on the native side.
 * Units are metres, seconds and radians; poses are world space, quaternions
 * `[x, y, z, w]`, right handed, +Y up.
 */
import type {
  HeadPose,
  InputHitHint,
  InputSourceSnapshot,
  PoseTuple,
  QuatTuple,
  RayTuple,
  Unsubscribe,
  Vec3Tuple,
} from "@realitycollective/webxr-input";
import type { HoldRelease } from "@realitycollective/webxr-interactions";

/**
 * What the host knows about its session, from which this package derives
 * `InputCapabilities` exactly as `IWSDKInputProvider.refreshCapabilities`
 * does from the WebXR session.
 */
export interface NativeInputFacts {
  /** A session is presenting: OpenXR `SYNCHRONIZED`, `VISIBLE` or `FOCUSED`. IWSDK: `world.session` exists. */
  immersive: boolean;
  /**
   * The session has input focus: OpenXR `FOCUSED`. While false no sources are
   * sampled, as IWSDK's provider returns none unless the visibility state is
   * `Visible`.
   */
  focused: boolean;
  /**
   * Hand tracking is enabled on the session (`XR_EXT_hand_tracking` and the
   * system supports it). IWSDK: `session.enabledFeatures` includes
   * `"hand-tracking"`. A tracked hand source also counts, without this.
   */
  handTracking: boolean;
  /**
   * An eye-gaze source is present: OpenXR `XR_EXT_eye_gaze_interaction` is
   * bound and its action is active (`isActive`), on a device with eye
   * tracking and the eye-tracking permission granted; visionOS never
   * reports one (gaze reaches an app only at the moment of a pinch). IWSDK:
   * an `XRInputSource` with `targetRayMode === "gaze"`. While true the
   * binding applies the eye-gaze rule (`@realitycollective/webxr-input`
   * `eye-gaze.ts`): `capabilities.eyeGaze` is true, hand and controller far
   * rays are dropped once a valid gaze pose has been seen, and a pinch
   * selects what is gazed at. The host draws none of this; it reports.
   */
  eyeTracking: boolean;
}

/**
 * What one side's presence visuals should show, handed to the host. The host
 * draws exactly this and decides nothing: which family is shown for
 * `"auto"`, and which side a request targets, are this package's.
 */
export interface NativePresenceShown {
  /** Draw this side's hand mesh. */
  hand: boolean;
  /** Draw this side's controller model. */
  controller: boolean;
}

/**
 * The native host's `input` slice. The host reports facts, sources and
 * signals; `NativeInputProvider` turns them into the `InputProvider`
 * contract.
 */
export interface NativeInputHost {
  /** This moment's session facts. Read at construction and on every signal. */
  getFacts(): NativeInputFacts;
  /** The facts changed: session start or end, focus gained or lost. */
  onFactsChanged(listener: () => void): Unsubscribe;
  /** A source connected or disconnected (WebXR `inputsourceschange`). Capabilities re-derive on it. */
  onSourcesChanged(listener: () => void): Unsubscribe;
  /**
   * This frame's tracked sources, in the `InputSourceSnapshot` shape. `kind`
   * is `"hand"` while hand joints are tracked, else `"controller"`.
   * `select` is the trigger value, or 1 while the runtime reports selecting
   * (a hand pinch), 0..1; `squeeze` is the grip value, 0 for hands.
   * `gripPose` is the WebXR GRIP frame, not a hand joint - see
   * `InputSourceSnapshot.gripPose`. `indexTip` is the index fingertip for a
   * hand and the ray origin for a controller. `hapticsAvailable` is true when
   * the source has an actuator. The host may reuse its buffers: this package
   * copies every snapshot.
   */
  sample(): readonly InputSourceSnapshot[];
  /** The viewer's head pose this frame. Present on any host that tracks a head; capabilities `gaze` and `headPose` follow it. */
  getHeadPose?(): HeadPose;
  /**
   * This frame's gaze target-ray pose, world space (`-Z` along the gaze),
   * or null when the runtime has no valid pose this frame (a blink, an
   * uncalibrated headset: OpenXR `XrEyeGazeSampleTimeEXT` not current, or
   * the pose's `XR_SPACE_LOCATION_ORIENTATION_TRACKED_BIT` clear). Raw: the
   * binding filters it, as IWSDK's `GazePointer` filters
   * `xrOrigin.eyeSpace`. Read every frame while `eyeTracking` is true.
   * Required when `eyeTracking` can be true; without it the fact is ignored.
   */
  getEyeGazePose?(): PoseTuple | null;
  /**
   * Pre-resolved targeting hints, for a host with its own targeting. Frame
   * fresh: the hints for the frame `sample()` just reported. A hint beats the
   * core's own hit tests, and is equivalent to `nativeGrabbing` for a grab.
   */
  sampleHints?(): readonly InputHitHint[];
  /**
   * Fire a haptic pulse on a source. `intensity` 0..1 (already clamped),
   * `durationMs` in milliseconds. Returns false when it could not be
   * delivered. IWSDK: `actuator.pulse(intensity, durationMs)`.
   */
  pulse?(sourceId: string, intensity: number, durationMs: number): boolean;
  /**
   * Show or hide one side's hand mesh and controller model, as decided here
   * (`IWSDKInputProvider.applyPresence`). Presence is the MODELS only: the
   * host never draws a ray for a hand, and it draws a cursor disc at every
   * ray's hit on a panel or an interactable whatever presence says, as
   * IWSDK's `CursorVisual` is. Called only when a side's result changed.
   * Without this member `capabilities.presence` is false.
   */
  applyPresence?(side: "left" | "right", shown: NativePresenceShown): void;
}

/** What the host's ray or proximity query reports: the target it reached, if any. */
export interface NativeHit {
  /** The target id the app registered with the native scene. */
  targetId: string;
  /** `hitRay`: the ray parameter t, metres. `hitProximity`: metres to the target's SURFACE, never negative. */
  distance: number;
  /** World-space hit point, or the target's centre. */
  point: Vec3Tuple;
}

/**
 * The native host's `interactions` slice: `HitTester` with its semantics
 * stated, and `TransformPort` with every member keyed by the target id the
 * app chose when it registered the object with the native scene.
 */
export interface NativeInteractionHost {
  /**
   * The nearest shown target along `ray` (origin in metres, direction
   * normalised). A target counts when its centre is within its radius of the
   * ray line and in front of the origin; `distance` is the ray parameter of
   * the closest point, and `t <= 0` never hits. A host that tests triangle
   * meshes instead may report the surface it hit; the contract cases accept
   * any answer within the target's radius plus 0.05 m of the sphere answer.
   * IWSDK: `EntityHitTester.hitRay`.
   */
  hitRay(ray: RayTuple): NativeHit | null;
  /**
   * The nearest shown target whose SURFACE is within `radius` metres of
   * `point`. `distance = max(0, |centre - point| - targetRadius)`: a point
   * 3 cm outside a 10 cm target reports 0.03, a point inside reports 0.
   * Never the distance to the centre. IWSDK: `EntityHitTester.hitProximity`.
   */
  hitProximity(point: Vec3Tuple, radius: number): NativeHit | null;
  /**
   * Eye-gaze targeting: the best shown target inside a cone of `halfAngle`
   * radians about `ray`, no farther than `maxLength` metres, or null. A
   * target the ray reaches (as `hitRay`) wins outright with the point where
   * the ray enters it; otherwise the target whose silhouette is nearest the
   * ray in angle, and within half a degree the nearer one, with `point` the
   * point of the target nearest the ray and `distance` metres to it. For a
   * sphere target this is `coneHitForSpheres` in
   * `@realitycollective/webxr-interactions`; a host that tests meshes
   * measures to the closest point on the mesh's bounds, as IWSDK's
   * `GazeConecaster` does with an oriented bounding box. Optional: without
   * it the binding targets eye gaze with `hitRay` alone, so a glance that
   * misses a small target by a degree finds nothing. IWSDK:
   * `GazeConecaster.findFrameBest`.
   */
  hitCone?(ray: RayTuple, halfAngle: number, maxLength: number): NativeHit | null;
  /**
   * The radius, in metres, the host hit-tests a registered target with.
   * Called once per registration with the app's `targetRadius`, or 0.1 when
   * it gave none, as IWSDK registers a bare target as a 10 cm sphere
   * (`register.ts`, `options.targetRadius ?? 0.1`). A host never excludes a
   * target from hit testing because of its radius.
   */
  setTargetRadius(targetId: string, radius: number): void;
  /** Where the object is now. */
  getWorldPose(targetId: string): PoseTuple;
  /** The rest pose captured at registration, in world space. */
  getRestWorldPose(targetId: string): PoseTuple;
  /** The offset from rest last written, metres, in the rest frame. */
  getLocalOffset(targetId: string): Vec3Tuple;
  /** Offset the object from its rest pose, metres, in the rest frame. */
  setLocalOffset(targetId: string, offset: Vec3Tuple): void;
  /** Rotate the object from its rest orientation. */
  setLocalRotation(targetId: string, quaternion: QuatTuple): void;
  /** Place the object at a world pose (the pose-only grab carry). */
  setWorldPose?(targetId: string, pose: PoseTuple): void;
  /**
   * The pulse effect: `scale` multiplies the rest scale, `emissive` is added
   * to the base emissive intensity. Last write wins per field.
   */
  setEffect?(targetId: string, effect: { scale?: number; emissive?: number }): void;
  /**
   * A pose-only grab started: suspend this target's physics body, if it has
   * one, so it follows `setWorldPose` exactly. REQUIRED when grabs are
   * pose-only (`nativeGrab` off). A target with no body needs nothing.
   * IWSDK: `beginHold` removes the `PhysicsBody` (`register.ts`,
   * `physicsBindingFor`).
   */
  beginHold(targetId: string): void;
  /**
   * The grab ended: resume the body with `release` as its velocity (linear
   * m/s and angular rad/s, world space; zeros for a synthesized release,
   * which rests). A target with NO physics body rests where it was released,
   * as on IWSDK where there is no body to re-add. IWSDK: `endHold` re-adds
   * the `PhysicsBody` and, for a non-zero velocity, a `PhysicsManipulation`.
   */
  endHold(targetId: string, release: HoldRelease): void;
}

/**
 * Test-only readbacks a host provides so the host conformance kit
 * (`nativeInteractionsHostConformanceCases`) can check what the host
 * actually did. A shipping host may omit them.
 */
export interface NativeInteractionsTestHost {
  /** Put a shown, hit-testable target of `radius` metres at `position`, as the app's scene would. */
  placeTarget(targetId: string, position: Vec3Tuple, radius: number): void;
  /** Remove every target `placeTarget` put in. */
  clearTargets(): void;
  /** What the host draws for one side now. */
  presenceShown(side: "left" | "right"): NativePresenceShown | undefined;
  /** The last release the host received for a target through `endHold`. */
  lastRelease(targetId: string): HoldRelease | undefined;
  /** Every cursor disc the host draws now, as world positions. */
  cursors(): Vec3Tuple[];
  /** Hide or show a placed target with the host's ordinary visibility flag, for the hidden-target cone case. Optional. */
  setTargetVisible?(targetId: string, visible: boolean): void;
}

/**
 * The native app's frame callback, the root member of `__rcHost` that
 * `NativeInteractions` attaches to when `attachToHost` is set.
 */
export interface NativeFrameSource {
  onFrame(callback: (timestampMs: number, deltaS: number) => void): () => void;
}

/** The two slices this package reads off `globalThis.__rcHost`. */
export interface NativeHostSlices {
  input: NativeInputHost;
  interactions: NativeInteractionHost;
}

/**
 * `globalThis.__rcHost`, read defensively: the root `NativeHost` interface
 * belongs to `service-framework-native`, which this package does not depend
 * on, so the global is read as an unknown bag of optional slices rather than
 * imported.
 */
export function installedHost(): (Partial<NativeHostSlices> & Partial<NativeFrameSource>) | undefined {
  return (globalThis as { __rcHost?: Partial<NativeHostSlices> & Partial<NativeFrameSource> }).__rcHost;
}

/**
 * Resolve one slice: the value passed in, or `globalThis.__rcHost`'s slice
 * of the same name. Throws one clear error naming the missing slice, so a
 * native-interactions class fails at construction rather than the first
 * time something calls a method that is not there.
 */
export function resolveHostSlice<K extends keyof NativeHostSlices>(
  name: K,
  injected: NativeHostSlices[K] | undefined,
): NativeHostSlices[K] {
  const slice = injected ?? (installedHost() as Partial<NativeHostSlices> | undefined)?.[name];
  if (!slice) {
    throw new Error(
      `@realitycollective/native-interactions: no "${name}" slice was supplied and globalThis.__rcHost.${name} is not installed. Pass one directly, or have the native app install it before this package is constructed.`,
    );
  }
  return slice;
}

// ---------------------------------------------------------------------------
// Copies. A host may reuse its own buffers across calls, so every tuple that
// crosses back into this package is copied on the way in, never referenced.
// ---------------------------------------------------------------------------

/** Copy a position tuple. */
export function copyVec3(v: Vec3Tuple): Vec3Tuple {
  return [v[0], v[1], v[2]];
}

/** Copy an orientation tuple. */
export function copyQuat(q: QuatTuple): QuatTuple {
  return [q[0], q[1], q[2], q[3]];
}

/** Copy a pose (position + orientation). */
export function copyPose(pose: PoseTuple): PoseTuple {
  return { position: copyVec3(pose.position), quaternion: copyQuat(pose.quaternion) };
}

/** Copy a ray (origin + direction). */
export function copyRay(ray: RayTuple): RayTuple {
  return { origin: copyVec3(ray.origin), direction: copyVec3(ray.direction) };
}

/**
 * Copy one `InputSourceSnapshot` field by field, including every tuple it
 * carries, so a host that pools and refills its own snapshot objects still
 * meets the ownership rule: a snapshot handed to `sample()`'s caller is
 * never written to again.
 */
export function copySnapshot(source: InputSourceSnapshot): InputSourceSnapshot {
  const copy: InputSourceSnapshot = {
    id: source.id,
    kind: source.kind,
    handedness: source.handedness,
    select: source.select,
    squeeze: source.squeeze,
  };
  if (source.ray) copy.ray = copyRay(source.ray);
  if (source.gripPose) copy.gripPose = copyPose(source.gripPose);
  if (source.indexTip) copy.indexTip = copyVec3(source.indexTip);
  if (source.linearVelocity) copy.linearVelocity = copyVec3(source.linearVelocity);
  if (source.angularVelocity) copy.angularVelocity = copyVec3(source.angularVelocity);
  if (source.nativeGrabbing !== undefined) copy.nativeGrabbing = source.nativeGrabbing;
  if (source.hapticsAvailable !== undefined) copy.hapticsAvailable = source.hapticsAvailable;
  if (source.selectorPose) copy.selectorPose = copyPose(source.selectorPose);
  return copy;
}
