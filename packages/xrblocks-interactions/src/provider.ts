/// <reference types="webxr" />
/**
 * XRBlocksInputProvider - EXPERIMENTAL.
 *
 * Binds to the SHAPE of Google XR Blocks (verified against xrblocks
 * v0.21.1 source, 2026-09) without importing `xrblocks`, per the
 * UI Extensions structural-typing convention:
 *
 *  - `xb.input.getFrame()` → `{ raySources, directTouches }`. Those slot
 *    objects are POOLED AND MUTATED per frame upstream - everything is
 *    copied here, never retained.
 *  - `RaySourceInput`: `{ controller, sourceType: 'mouse'|'controller-ray'
 *    |'hand-ray'|'gaze'|'simulator', ray, selected }` - handedness from
 *    `controller.inputSource?.handedness`; analog select only via
 *    `controller.gamepad?.buttons[0].value`; squeeze only as the boolean
 *    `controller.userData.squeezing`.
 *  - `DirectTouchInput`: `{ handIndex (0=left,1=right), point }` - the
 *    index-fingertip world position, merged into the matching hand source.
 *  - The real grip pose comes from `controller.inputSource.gripSpace`, read
 *    through the `xr` context (the same `gripSpace ?? targetRaySpace`
 *    fallback `webxr-uiextensions`' xrblocks integration uses) when the app
 *    supplies one; the ray pose with an identity orientation is the fallback
 *    when it does not, as before.
 *  - Gaze rides `sourceType: 'gaze'` and never raw-selects (XR Blocks
 *    selects gaze via its own dwell; ours is the core's dwell).
 *  - Haptics: `controller.gamepad.hapticActuators`, the standard WebXR
 *    Gamepad surface XR Blocks' `Controller` carries through - verified
 *    against `input/Controller.ts` - clamped the same way every other
 *    provider clamps a pulse.
 *  - A live session that is not `"visible"` samples no sources, the same
 *    rule IWSDK's provider applies, when the app supplies `xr`.
 */
import {
  NO_CAPABILITIES,
  type HeadPose,
  type InputCapabilities,
  type InputProvider,
  type InputSourceSnapshot,
  type PoseTuple,
  type Unsubscribe,
} from "@realitycollective/webxr-input";

// The four structural slices below are exported, following the XB*Like
// types, because they are the field types of XBRaySourceLike and
// XBDirectTouchLike: a consumer building a fake frame for a test, or typing an
// adapter of its own, has a name for each shape rather than an anonymous
// object type in the declarations.

/** Structural slice of THREE.Vector3. */
export interface XBVec3Like {
  x: number;
  y: number;
  z: number;
}

/** Structural slice of THREE.Quaternion. */
export interface XBQuatLike extends XBVec3Like {
  w: number;
}

/** Structural slice of THREE.Ray. */
export interface XBRayLike {
  origin: XBVec3Like;
  direction: XBVec3Like;
}

/** A WebXR haptic actuator - `GamepadHapticActuator`, structurally. */
export interface XBHapticActuatorLike {
  pulse?(value: number, duration: number): Promise<boolean>;
}

/**
 * The slice of an xrblocks controller the provider reads.
 *
 * `inputSource` is `Partial<XRInputSource>` in XR Blocks' own `Controller`
 * type (`input/Controller.ts`), so `gripSpace`/`targetRaySpace` are read
 * from it exactly as WebXR itself defines them - no XR Blocks-specific
 * shape. `gamepad` is the standard WebXR `Gamepad` XR Blocks keeps on the
 * controller the same way.
 */
export interface XBControllerLike {
  inputSource?: { handedness?: string; gripSpace?: XRSpace; targetRaySpace?: XRSpace };
  gamepad?: { buttons?: ReadonlyArray<{ value: number }>; hapticActuators?: readonly XBHapticActuatorLike[] };
  userData?: { squeezing?: boolean; selected?: boolean; id?: number };
}

/** Structural `RaySourceInput` (xrblocks src/interaction/InteractionTypes.ts). */
export interface XBRaySourceLike {
  controller: XBControllerLike;
  sourceType: string; // 'mouse' | 'controller-ray' | 'hand-ray' | 'gaze' | 'simulator'
  ray: XBRayLike;
  selected: boolean;
}

/** Structural `DirectTouchInput`. */
export interface XBDirectTouchLike {
  controller: XBControllerLike;
  handIndex: number; // 0 = LEFT, 1 = RIGHT (xrblocks Handedness enum)
  point: XBVec3Like;
  selected: boolean;
}

export interface XBFrameLike {
  raySources: readonly XBRaySourceLike[];
  directTouches: readonly XBDirectTouchLike[];
}

/**
 * Structural three.js `WebXRManager` surface, read for the real grip pose
 * and the session's visibility. Omit it and the provider falls back to the
 * ray pose with an identity orientation and never gates on visibility, as
 * before this option existed.
 */
export interface XBWebXRAccess {
  getSession(): XRSession | null;
  getFrame(): XRFrame | null | undefined;
  getReferenceSpace(): XRReferenceSpace | null;
}

/** The slice of the XR Blocks singletons the provider binds to. */
export interface XRBlocksContext {
  /** `xb.input` - must expose `getFrame()`. */
  input: { getFrame(): XBFrameLike };
  /** `xb.camera` / `xb.core.camera` - the head pose. */
  camera: {
    getWorldPosition(target: XBVec3Like): XBVec3Like;
    getWorldQuaternion(target: XBQuatLike): XBQuatLike;
  };
  /**
   * `xb.core.renderer.xr` (or anything with the same three.js
   * `WebXRManager` surface) - lets the provider read the real grip pose
   * and gate sampling on session visibility. Omit it on a
   * desktop-only setup, or one that has not wired a renderer yet.
   */
  xr?: XBWebXRAccess;
}

export interface XRBlocksProviderOptions {
  /**
   * The app wired XR Blocks' `ManipulationManager` (its
   * `onObjectGrabStart`/`onObjectGrabEnd` Script hooks, forwarded through
   * `XRBlocksInteractions.onObjectGrabStart`/`onObjectGrabEnd`), so grab
   * behaviours are fulfilled NATIVELY by the engine - the same option
   * `IWSDKInputProvider` takes for its own native grab pipeline.
   */
  nativeGrab?: boolean;
}

type Side = "left" | "right";

const SCRATCH_V = { x: 0, y: 0, z: 0 };
const SCRATCH_Q = { x: 0, y: 0, z: 0, w: 1 };

export class XRBlocksInputProvider implements InputProvider {
  private readonly context: XRBlocksContext;
  private readonly nativeGrab: boolean;
  private capabilities: InputCapabilities = { ...NO_CAPABILITIES, headPose: true, gaze: true };
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();
  private readonly nativeGrabbing: Record<Side, boolean> = { left: false, right: false };
  /** Snapshot id -> controller, filled by `sample()` so `pulse` need not parse ids. */
  private readonly controllersById = new Map<string, XBControllerLike>();

  constructor(context: XRBlocksContext, options: XRBlocksProviderOptions = {}) {
    this.context = context;
    this.nativeGrab = options.nativeGrab ?? false;
  }

  /** Bridge input: a side is currently grabbing through XR Blocks' own `ManipulationManager`. */
  setNativeGrabbing(side: Side, grabbing: boolean): void {
    this.nativeGrabbing[side] = grabbing;
  }

  getCapabilities(): InputCapabilities {
    return this.capabilities;
  }

  onCapabilitiesChanged(listener: (c: InputCapabilities) => void): Unsubscribe {
    this.capsListeners.add(listener);
    return () => this.capsListeners.delete(listener);
  }

  onSourcesChanged(): Unsubscribe {
    return () => undefined;
  }

  sample(): readonly InputSourceSnapshot[] {
    this.controllersById.clear();
    // A session that exists but is not visible (backgrounded, or the
    // browser's own "content is obscured" state) reports no sources at all,
    // the same rule IWSDK's provider applies. Only checked when the app
    // supplied `xr` - without it there is no session to read.
    const session = this.context.xr?.getSession();
    if (session && session.visibilityState !== "visible") return [];

    const frame = this.context.input.getFrame();
    const snapshots: InputSourceSnapshot[] = [];
    const byHandedness = new Map<string, InputSourceSnapshot>();

    let sawRay = false;
    let sawTouch = false;
    let sawMouse = false;
    let sawHaptics = false;

    for (const source of frame.raySources) {
      if (source.sourceType === "gaze") {
        snapshots.push({
          id: "xb-gaze",
          kind: "gaze",
          handedness: "none",
          ray: copyRay(source.ray),
          select: 0, // gaze never raw-selects in XR Blocks
          squeeze: 0,
        });
        continue;
      }
      const handedness = normalizeHandedness(source.controller.inputSource?.handedness);
      const isMouse = source.sourceType === "mouse";
      if (isMouse) sawMouse = true;
      else sawRay = true;
      const analog = source.controller.gamepad?.buttons?.[0]?.value;
      const select = analog !== undefined && analog > 0 ? analog : source.selected ? 1 : 0;
      const ray = copyRay(source.ray);
      const id = isMouse ? "xb-mouse" : `xb-${handedness}-${source.sourceType}`;
      const snapshot: InputSourceSnapshot = {
        id,
        kind: isMouse ? "pointer2d" : source.sourceType === "hand-ray" ? "hand" : "controller",
        handedness,
        ray,
        select,
        squeeze: source.controller.userData?.squeezing ? 1 : 0,
      };
      const gripPose = this.readGripPose(source.controller);
      if (gripPose) {
        snapshot.gripPose = gripPose.pose;
        if (gripPose.linearVelocity) snapshot.linearVelocity = gripPose.linearVelocity;
        if (gripPose.angularVelocity) snapshot.angularVelocity = gripPose.angularVelocity;
      } else {
        // No `xr` context, or no grip space this frame: the ray pose with an
        // identity orientation doubles as the carry pose, as before.
        snapshot.gripPose = { position: ray.origin, quaternion: [0, 0, 0, 1] };
      }
      // A controller has no fingertip: its index tip is its ray origin, as
      // IWSDK's input rig makes it. A hand's tip comes from its direct touch.
      if (snapshot.kind === "controller") snapshot.indexTip = [...ray.origin];
      const actuators = source.controller.gamepad?.hapticActuators;
      if (actuators && actuators.length > 0) {
        snapshot.hapticsAvailable = true;
        sawHaptics = true;
      }
      if (handedness === "left" || handedness === "right") {
        if (this.nativeGrabbing[handedness]) snapshot.nativeGrabbing = true;
        this.controllersById.set(id, source.controller);
        byHandedness.set(handedness, snapshot);
      }
      snapshots.push(snapshot);
    }

    for (const touch of frame.directTouches) {
      sawTouch = true;
      const handedness = touch.handIndex === 0 ? "left" : "right";
      const existing = byHandedness.get(handedness);
      const tip: [number, number, number] = [touch.point.x, touch.point.y, touch.point.z];
      if (existing) {
        existing.indexTip = tip;
        existing.kind = "hand";
      } else {
        snapshots.push({
          id: `xb-${handedness}-touch`,
          kind: "hand",
          handedness,
          indexTip: tip,
          gripPose: { position: tip, quaternion: [0, 0, 0, 1] },
          select: touch.selected ? 1 : 0,
          squeeze: 0,
          ...(this.nativeGrabbing[handedness] ? { nativeGrabbing: true } : {}),
        });
      }
    }

    this.refreshCapabilities(sawRay, sawTouch, sawMouse, sawHaptics);
    return snapshots;
  }

  /**
   * The real grip pose from `controller.inputSource.gripSpace` (falling
   * back to `targetRaySpace`, the same precedence
   * `webxr-uiextensions`' xrblocks integration uses), plus whatever
   * linear/angular velocity the platform reports alongside it - see
   * `WebXRInputProvider.applyPoseVelocity`'s twin in the three.js adapter.
   * `null` with no `xr` context, no input source, no space this frame, or no
   * pose the platform can resolve; the caller falls back to the ray pose.
   */
  private readGripPose(
    controller: XBControllerLike,
  ): { pose: PoseTuple; linearVelocity?: [number, number, number]; angularVelocity?: [number, number, number] } | null {
    const xr = this.context.xr;
    const inputSource = controller.inputSource;
    const space = inputSource?.gripSpace ?? inputSource?.targetRaySpace;
    if (!xr || !space) return null;
    const frame = xr.getFrame();
    const referenceSpace = xr.getReferenceSpace();
    if (!frame || !referenceSpace) return null;
    const pose = frame.getPose(space, referenceSpace);
    if (!pose) return null;
    const p = pose.transform.position;
    const o = pose.transform.orientation;
    const result: { pose: PoseTuple; linearVelocity?: [number, number, number]; angularVelocity?: [number, number, number] } = {
      pose: { position: [p.x, p.y, p.z], quaternion: [o.x, o.y, o.z, o.w] },
    };
    if (pose.linearVelocity) {
      const v = pose.linearVelocity;
      result.linearVelocity = [v.x, v.y, v.z];
    }
    if (pose.angularVelocity) {
      const v = pose.angularVelocity;
      result.angularVelocity = [v.x, v.y, v.z];
    }
    return result;
  }

  private refreshCapabilities(rays: boolean, touches: boolean, mouse: boolean, haptics: boolean): void {
    const next: InputCapabilities = {
      ...NO_CAPABILITIES,
      rays,
      pokes: touches,
      grabs: rays || touches ? (this.nativeGrab ? "native" : "poseOnly") : "none",
      handJoints: touches,
      pinch: touches,
      gaze: true,
      pointer2d: mouse,
      headPose: true,
      haptics,
      // XR Blocks owns its controller and hand visuals and exposes no way
      // to hide them, so there is no presence to offer and neither
      // setPresenceVisible nor setPresenceModality is implemented.
      presence: false,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.capabilities)) {
      this.capabilities = next;
      for (const listener of [...this.capsListeners]) listener(next);
    }
  }

  getHeadPose(): HeadPose {
    const position = this.context.camera.getWorldPosition(SCRATCH_V);
    const quaternion = this.context.camera.getWorldQuaternion(SCRATCH_Q);
    return {
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w ?? 1],
    };
  }

  /**
   * Pulses through the controller's WebXR Gamepad `hapticActuators`,
   * clamping intensity to 0..1 exactly as the other providers do. `false`
   * with no source of that id sampled this frame, or no actuator on it.
   */
  pulse(sourceId: string, intensity: number, durationMs: number): boolean {
    const actuator = this.controllersById.get(sourceId)?.gamepad?.hapticActuators?.[0];
    if (!actuator?.pulse) return false;
    void actuator.pulse(Math.min(1, Math.max(0, intensity)), durationMs);
    return true;
  }
}

function normalizeHandedness(value: string | undefined): "left" | "right" | "none" {
  return value === "left" || value === "right" ? value : "none";
}

function copyRay(ray: XBRayLike): {
  origin: [number, number, number];
  direction: [number, number, number];
} {
  // Upstream slot objects are pooled - copy, never retain.
  return {
    origin: [ray.origin.x, ray.origin.y, ray.origin.z],
    direction: [ray.direction.x, ray.direction.y, ray.direction.z],
  };
}
