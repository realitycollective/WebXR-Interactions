/**
 * The `input` and `interactions` slices a native host (OpenXR on Quest,
 * CompositorServices on visionOS, or any other shell embedding a JavaScript
 * engine such as Hermes) installs on `globalThis.__rcHost`.
 *
 * These are NOT new contracts: `NativeInputHost` is the exact shape of
 * `InputProvider` from `@realitycollective/webxr-input`, and
 * `NativeInteractionHost` is `HitTester` plus `TransformPort` from
 * `@realitycollective/webxr-interactions/ports`, with a `targetId` added to
 * every `TransformPort` member because that port is per object and the host
 * is one object serving every registered interactable. Declaring them again
 * here, rather than reusing the originals by reference, is deliberate: this
 * file is the one place that states what crosses the native boundary, kept
 * in the same structural-typing style as `babylon-types.ts` and the XR
 * Blocks `XB*Like` types, so it reads correctly even without the other two
 * packages open.
 *
 * Values that cross are plain: numbers, strings, booleans and tuples. No
 * engine objects in either direction, and assets stay entirely on the
 * native side.
 */
import type {
  Handedness,
  HeadPose,
  InputCapabilities,
  InputHitHint,
  InputSourceSnapshot,
  PoseTuple,
  PresenceModality,
  QuatTuple,
  RayTuple,
  Unsubscribe,
  Vec3Tuple,
} from "@realitycollective/webxr-input";

/** The native host's `input` slice. Mirrors `InputProvider` member for member. */
export interface NativeInputHost {
  getCapabilities(): InputCapabilities;
  onCapabilitiesChanged(listener: (capabilities: InputCapabilities) => void): Unsubscribe;
  onSourcesChanged(listener: () => void): Unsubscribe;
  sample(): readonly InputSourceSnapshot[];
  getHeadPose?(): HeadPose;
  sampleHints?(): readonly InputHitHint[];
  pulse?(sourceId: string, intensity: number, durationMs: number): boolean;
  setPresenceVisible?(target: Handedness | "all", visible: boolean): boolean;
  setPresenceModality?(mode: PresenceModality): boolean;
}

/** What the host's ray/proximity query reports: the target it reached, if any. */
export interface NativeHit {
  /** The target id the app registered with `NativeTransformPort`/its own scene. */
  targetId: string;
  /** Distance from the query origin (ray origin / probe point). */
  distance: number;
  /** World-space hit or closest point. */
  point: Vec3Tuple;
}

/**
 * The native host's `interactions` slice: `HitTester` unchanged, and
 * `TransformPort` with every member keyed by the target id the app chose
 * when it registered the object with the native scene, because one host
 * object serves every interactable rather than one port per object.
 */
export interface NativeInteractionHost {
  hitRay(ray: RayTuple): NativeHit | null;
  hitProximity(point: Vec3Tuple, radius: number): NativeHit | null;
  /** Where the object is now. */
  getWorldPose(targetId: string): PoseTuple;
  /** The rest pose captured at registration, in world space. */
  getRestWorldPose(targetId: string): PoseTuple;
  getLocalOffset(targetId: string): Vec3Tuple;
  setLocalOffset(targetId: string, offset: Vec3Tuple): void;
  setLocalRotation(targetId: string, quaternion: QuatTuple): void;
  setWorldPose?(targetId: string, pose: PoseTuple): void;
  setEffect?(targetId: string, effect: { scale?: number; emissive?: number }): void;
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
  return copy;
}
