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
  ActivePointerKind,
  HeadPose,
  InputHitHint,
  InputSourceSnapshot,
  PointerDisplayConfig,
  PointerDrawing,
  PointerTargetKind,
  PoseTuple,
  QuatTuple,
  RayTuple,
  Unsubscribe,
  Vec3Tuple,
} from "@realitycollective/webxr-input";
import type {
  HoldRelease,
  PhysicsBodySpec,
  PhysicsBodyState,
  PhysicsShapeSpec,
  PhysicsVelocity,
} from "@realitycollective/webxr-interactions";

/**
 * What the host draws for one source this frame: the core's pointer drawing
 * (`pointerDrawing` in `@realitycollective/webxr-input`: the arbiter's
 * decision under the app's pointer display settings), plus the decision it
 * came from, so a host can tell a panel cursor from an object cursor in its
 * logs. Every field is resolved here. The host draws `ray` and `cursor`
 * exactly as they are, at the sizes, colours and offsets given, and decides
 * nothing: not the display mode, not whether a panel gets a cursor, not the
 * stub's length. Before 29 September 2026 a host had to reach these through
 * a shell hook of its own (`__rcShell.setPointerDisplay`), which is exactly
 * the kind of host-side rule this contract forbids.
 */
export interface NativePointerVisuals extends PointerDrawing {
  /** The pointer owning the source, or null when none has a candidate. */
  activePointer: ActivePointerKind | null;
  /** What the cursor sits on: a registered interactable, a UI panel, or null. */
  targetKind: PointerTargetKind | null;
  /** The interactable id or the panel id the cursor sits on, or null. */
  targetId: string | null;
  /** The hit's distance (ray parameter, or surface distance), or null. */
  hitDistance: number | null;
}

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
   *
   * What a source reports for `select` and `squeeze` is fixed per kind, so
   * the core's grab lifecycle (start at 0.7, end below 0.3, the same
   * thresholds IWSDK's provider feeds) sees on this host what it sees on the
   * web on the same headset:
   *
   * - A CONTROLLER: `select` is the trigger's analog value, OpenXR
   *   `/input/trigger/value` (WebXR `gamepad.buttons[0].value`), and
   *   `squeeze` the grip's, `/input/squeeze/value` (`buttons[1].value`).
   *   Both rest at 0.
   * - A HAND: `select` is BINARY, 1 while the runtime reports the hand's
   *   pinch gesture and 0 otherwise, NEVER the analog pinch strength. This is
   *   what the web gives IWSDK: the browser fires `selectstart` and
   *   `selectend` from the runtime's own pinch recogniser and IWSDK reads
   *   `getSelecting() ? 1 : 0` (`@iwsdk/xr-input` `xr-input-manager.js`).
   *   The source on Quest is `XR_FB_hand_tracking_aim`'s
   *   `XR_HAND_TRACKING_AIM_INDEX_PINCHING_BIT_FB` (the same bit the Quest
   *   Browser turns into `selectstart`), on a runtime without it
   *   `XR_EXT_hand_interaction` `pinch_ext/ready_ext` and `pinch_ext/value`
   *   through the runtime's own threshold. `squeeze` is 0 ALWAYS: a hand has
   *   no squeeze on the web (IWSDK reads a gamepad squeeze button a hand
   *   does not have), and its grab is its pinch through `select`. OpenXR's
   *   `grasp_ext` is not a hand's squeeze; a relaxed hand keeps it above the
   *   release threshold, so a grab never ends, which is what held the Pale
   *   Signal handwheel for 7 s after the hand opened. A relaxed, open hand
   *   reads `select` 0 and `squeeze` 0. The binding forces a hand's `squeeze`
   *   to 0 whatever the host says; the kit checks a hand's `select` is 0 or 1.
   *
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
   * (`IWSDKInputProvider.applyPresence`). Presence is the MODELS only: it
   * never touches the ray or the cursor, which `applyPointerVisuals` owns.
   * Called only when a side's result changed. Without this member
   * `capabilities.presence` is false.
   */
  applyPresence?(side: "left" | "right", shown: NativePresenceShown): void;
  /**
   * Draw, or stop drawing, one source's ray and cursor, exactly as told.
   * Decided here: the pointer arbiter (`pointer-arbiter.ts` in
   * `@realitycollective/webxr-input`, IWSDK's `MultiPointer`) picks the
   * pointer owning the source across interactables AND UI panels, so a
   * cursor on a panel arrives here too (`targetKind: "panel"`) and a touch on
   * a panel hides the ray over an object; then the app's pointer display
   * settings (`pointer-display.ts`, IWSDK's `RayPointer` and `CursorVisual`
   * defaults) resolve what is drawn: `ray` with its stub from `rayFrom` to
   * `rayTo` metres along the source's ray (fully visible to `raySolidTo`,
   * fading after), `rayRadius` and `rayColor`; `cursor` at `cursorPoint`
   * (world metres, the ray's hit or the surface point under the fingertip or
   * grip), a disc of `cursorRadius`, `cursorOpacity`, sitting `cursorOffset`
   * off the surface along its normal. A host draws nothing for a source it
   * was not told about, never draws "a cursor at every ray hit" on its own
   * (what this contract said before 28 September 2026), and never applies a
   * display mode of its own (what the Pale Signal host did through a shell
   * hook until 29 September 2026). Called every frame for every sampled
   * source, with fresh objects the host may keep. IWSDK: `RayPointer.update`
   * with `forceHideRay`, `rayDisplayMode` and its shader, and
   * `CursorVisual.setVisible` and `updateFromIntersection`.
   */
  applyPointerVisuals?(sourceId: string, visuals: NativePointerVisuals): void;
  /**
   * The app's pointer display settings, handed over at construction and on
   * every change (`PointerDisplay.set`), so a host can size its meshes or
   * log the configuration. Informational: every per-frame decision already
   * arrives resolved in `applyPointerVisuals`, so a host needs nothing from
   * here to draw correctly. Optional.
   */
  applyPointerDisplay?(config: PointerDisplayConfig): void;
}

/** What the host's ray or proximity query reports: the target it reached, if any. */
export interface NativeHit {
  /** The target id the app registered with the native scene. */
  targetId: string;
  /** `hitRay`: the ray parameter t, metres. `hitProximity`: metres to the target's SURFACE, never negative. */
  distance: number;
  /**
   * World-space point. `hitRay`: where the ray enters the target. `hitProximity`:
   * the point on the target's SURFACE nearest the query point, never the
   * centre, because the touch cursor is drawn there (IWSDK's sphere
   * intersector reports the point on the mesh). A host that answered with
   * the centre put the cursor inside the object.
   */
  point: Vec3Tuple;
}

/**
 * The native host's `interactions` slice: `HitTester` with its semantics
 * stated, and `TransformPort` with every member keyed by the target id the
 * app chose when it registered the object with the native scene.
 *
 * SCOPE OF EVERY QUERY: `hitRay`, `hitProximity` and `hitCone` consider
 * REGISTERED INTERACTABLES ONLY, the ids this binding handed to
 * `setTargetRadius`, and among them only the ones shown. Never scenery, a
 * floor, a wall, a panel or any other mesh, however near. IWSDK's
 * `EntityHitTester` tests the entities `register` gave it and nothing else.
 * A host that answered a proximity query with the floor's bounds (which
 * contain the hand) passed every earlier case and left no fingertip able to
 * reach a target on the device; the kit now surrounds the query with
 * scenery and expects the target.
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
   * A pose-only grab started on a target that has NO body in the `physics`
   * slice: the host lets the object rest where the hold leaves it. A target
   * that has a body is held through the `physics` slice instead
   * (`NativePhysicsHost.suspend`), and this member is not called for it.
   * REQUIRED when grabs are pose-only (`nativeGrab` off). IWSDK: `beginHold`
   * removes the `PhysicsBody`.
   */
  beginHold(targetId: string): void;
  /**
   * The grab ended on a target with no body in the `physics` slice: the
   * object rests where it was released, as on IWSDK where there is no body
   * to re-add. `release` is the velocity it would have carried (linear m/s
   * and angular rad/s, world space; zeros for a synthesized release). A
   * target with a body is resumed through `NativePhysicsHost.resume` instead.
   */
  endHold(targetId: string, release: HoldRelease): void;
}

/**
 * The native host's `physics` slice: the platform's physics engine behind
 * the core `PhysicsFacility` contract (`physics.ts` in
 * `@realitycollective/webxr-interactions`), one body per string id, the same
 * ids the app registers interactables with. The host runs the platform's
 * default engine, Jolt Physics on Quest and Android and RealityKit physics
 * on visionOS, and applies these defaults exactly (IWSDK 1.0.0's, from
 * `@iwsdk/core` `dist/physics/`): gravity `[0, -9.81, 0]` m/s², 60 steps
 * per second with render interpolation, a body dynamic with linear and
 * angular damping 0 and gravity factor 1, a shape "auto" (from the object's
 * geometry) with density 1 kg/m³, restitution 0 and friction 0.5. An app
 * may install its own `PhysicsFacility` here to replace the engine.
 *
 * Units: metres, seconds, radians. Poses are world space, quaternions
 * `[x, y, z, w]`, +Y up. The binding copies every tuple it hands over and
 * every tuple it reads, so the host may reuse its buffers.
 *
 * The host conformance kit runs the whole shared suite
 * (`physicsFacilityContractCases()`) against this slice on the device.
 */
export interface NativePhysicsHost {
  /** The engine behind the slice, for reports: `"jolt"`, `"realitykit"`, or an app's own name. Never empty. */
  readonly engine: string;
  /** World gravity, m/s². Starts at `[0, -9.81, 0]`. */
  getGravity(): Vec3Tuple;
  /** Set world gravity, m/s²; every dynamic body, sleeping ones included, sees it from the next step. */
  setGravity(gravity: Vec3Tuple): void;
  /**
   * Add a body for `id` at `pose` with the specs given; a missing field takes
   * the default above. `state`: `"dynamic"` responds to forces, collisions and
   * gravity, `"static"` never moves, `"kinematic"` moves only by `setBodyPose`
   * and pushes dynamic bodies. `shape.kind` `"auto"` is the host's collider
   * for the object's geometry; `"box"` takes full extents in `dimensions`,
   * `"sphere"` its radius in `dimensions[0]`, `"capsule"` radius and height.
   * Adding an id that exists replaces it. IWSDK: `PhysicsBody` and `PhysicsShape`.
   */
  addBody(id: string, pose: PoseTuple, body?: PhysicsBodySpec, shape?: PhysicsShapeSpec): void;
  /** Remove the body; a missing id is ignored. */
  removeBody(id: string): void;
  hasBody(id: string): boolean;
  /** Change how the body moves; a suspended body takes the new state when it resumes. */
  setBodyState(id: string, state: PhysicsBodyState): void;
  getBodyState(id: string): PhysicsBodyState;
  /** Where the body is now, world space. Throws an error whose message contains `no physics body "<id>"` for an unknown id. */
  getBodyPose(id: string): PoseTuple;
  /**
   * Teleport: the body is at `pose` from the next step with its velocity
   * cleared, so it rests there rather than carrying what it did. While
   * suspended the write is exact and carries nothing. IWSDK:
   * `PhysicsSystem.setBodyTransform`.
   */
  setBodyPose(id: string, pose: PoseTuple): void;
  /** Linear m/s and angular rad/s (axis scaled), world space. */
  getVelocity(id: string): PhysicsVelocity;
  /** Set both velocities. IWSDK: `PhysicsManipulation`. */
  setVelocity(id: string, velocity: PhysicsVelocity): void;
  /**
   * A hold began: from here until `resume` the body is not simulated (no
   * gravity, no collision response) and `setBodyPose` writes are exact. A
   * second `suspend` changes nothing. IWSDK: `beginHold` removes the body.
   */
  suspend(id: string): void;
  /**
   * The hold ended: simulate the body again in the state it had, with
   * `release` as its velocity so a throw carries through (zeros rest it).
   * Resuming a body that is not suspended changes nothing. IWSDK:
   * `endHold` re-adds the body with a `PhysicsManipulation`.
   */
  resume(id: string, release: HoldRelease): void;
  isSuspended(id: string): boolean;
  /**
   * Advance the world by `dtSeconds`. A host whose engine steps itself from
   * its own loop may take this as a hint and return; the kit then reads the
   * poses the engine wrote. The binding calls it once per `update(dt)`.
   */
  step(dtSeconds: number): void;
  /** Release the world and every body. */
  dispose(): void;
}

/**
 * Test-only readbacks a host provides so the host conformance kit
 * (`nativeInteractionsHostConformanceCases`) can check what the host
 * actually did. A shipping host may omit them.
 */
export interface NativeInteractionsTestHost {
  /** Put a shown, hit-testable target of `radius` metres at `position`, as the app's scene would. */
  placeTarget(targetId: string, position: Vec3Tuple, radius: number): void;
  /**
   * Put a shown mesh of `radius` metres at `position` that is NOT a
   * registered interactable (a floor, a wall, a prop), through the host's
   * ordinary scene, so the kit can prove the queries never answer with it.
   */
  placeScenery(id: string, position: Vec3Tuple, radius: number): void;
  /** Remove every target and every piece of scenery placed by the kit. */
  clearTargets(): void;
  /** What the host draws for one side now. */
  presenceShown(side: "left" | "right"): NativePresenceShown | undefined;
  /** The last release the host received for a target through `endHold`. */
  lastRelease(targetId: string): HoldRelease | undefined;
  /** Every cursor disc the host draws now, as world positions. */
  cursors(): Vec3Tuple[];
  /** What the host draws for one source now, as last told through `applyPointerVisuals`; undefined for a source never told. */
  pointerVisuals?(sourceId: string): NativePointerVisuals | undefined;
  /** The pointer display settings the host last received through `applyPointerDisplay`, or undefined. Optional. */
  pointerDisplay?(): PointerDisplayConfig | undefined;
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

/**
 * The slices this package reads off `globalThis.__rcHost`. `physics` is
 * part of the contract on every native platform: a host without it fails
 * the conformance kit, and a target cannot carry a body until it is there.
 */
export interface NativeHostSlices {
  input: NativeInputHost;
  interactions: NativeInteractionHost;
  physics: NativePhysicsHost;
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
  const slice = findHostSlice(name, injected);
  if (!slice) {
    throw new Error(
      `@realitycollective/native-interactions: no "${name}" slice was supplied and globalThis.__rcHost.${name} is not installed. Pass one directly, or have the native app install it before this package is constructed.`,
    );
  }
  return slice;
}

/** The value passed in, or `globalThis.__rcHost`'s slice of that name, or undefined. */
export function findHostSlice<K extends keyof NativeHostSlices>(
  name: K,
  injected: NativeHostSlices[K] | undefined,
): NativeHostSlices[K] | undefined {
  return injected ?? (installedHost() as Partial<NativeHostSlices> | undefined)?.[name];
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
