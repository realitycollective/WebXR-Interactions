/**
 * BabylonInputProvider - the Babylon.js input provider.
 *
 * Reads a `WebXRDefaultExperience`: its `input.controllers` for poses and
 * motion-controller components, its session manager for what is live, and
 * the hand-tracking feature for fingertip joints. Falls back to the scene's
 * own pointer (`scene.onPointerObservable`) when no immersive session is
 * running, so the same scene is usable in a flat browser.
 *
 * Nothing here imports `@babylonjs/core` - see `babylon-types.ts`.
 *
 * Capabilities are derived from the LIVE session, never from the requested
 * configuration, and are re-published on session start, session end and
 * controller add/remove.
 */
import {
  NO_CAPABILITIES,
  type HeadPose,
  type InputCapabilities,
  type InputProvider,
  type InputSourceSnapshot,
  type Unsubscribe,
  type Vec3Tuple,
} from "@realitycollective/webxr-input";
// Collapses into `InputSourceSnapshot` at `@realitycollective/webxr-input` 0.1.1, which adds the two velocity fields.
import type { InputSourceSnapshotWithVelocity } from "@realitycollective/webxr-interactions";
import {
  HAND_TRACKING_FEATURE,
  INDEX_TIP_JOINT,
  POINTER_EVENT_TYPES,
  nodeForward,
  defaultForward,
  nodeWorldPose,
  toQuat,
  toVec3,
  type BabylonCameraLike,
  type BabylonHandTrackingLike,
  type BabylonPointerInfoLike,
  type BabylonSceneLike,
  type BabylonTransformNodeLike,
  type BabylonXRControllerLike,
  type BabylonXRExperienceLike,
  type BabylonXRHandLike,
} from "./babylon-types.js";

export interface BabylonProviderOptions {
  /**
   * The `WebXRDefaultExperience` (or anything with the same surface).
   * Omit it, or pass null, for a desktop-only app: the provider then only
   * ever reports the scene pointer.
   */
  xr?: BabylonXRExperienceLike | null;
  /** The scene. Supplies the pointer fallback, the camera and the engine. */
  scene: BabylonSceneLike;
  /** Head pose camera. Defaults to `scene.activeCamera`. */
  camera?: BabylonCameraLike | null;
  /**
   * Metres along the pointer ray at which the desktop fallback places its
   * synthetic grip pose. Default 1 metre, matching the three.js adapter, so
   * grab, hinge, dial and slide follow the cursor on desktop. Set it near
   * the distance of the things being manipulated; at 0 the grip sits on the
   * camera and a mouse drag reports camera motion only.
   */
  desktopGripDistance?: number;
}

/** Which side's visual a presence call targets. `"all"` is both. */
export type PresenceTarget = "left" | "right" | "none" | "all";

/**
 * Which family of visuals presence shows. Babylon chooses this per input
 * source, so this provider reports every mode as unavailable.
 */
export type PresenceModality = "hands" | "controllers" | "auto";

/** Trigger, then the main component, then nothing. */
const TRIGGER_COMPONENT = "trigger";
const SQUEEZE_COMPONENT = "squeeze";

/** The desktop pointer source's id - stable for the life of the page. */
export const DESKTOP_SOURCE_ID = "babylon-pointer";

interface PointerState {
  down: boolean;
  x: number;
  y: number;
  ray: { origin: Vec3Tuple; direction: Vec3Tuple } | null;
}

interface SampledSource {
  handedness: "left" | "right" | "none";
  controller: BabylonXRControllerLike;
}

export class BabylonInputProvider implements InputProvider {
  private readonly options: BabylonProviderOptions;
  private capabilities: InputCapabilities;
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();
  private readonly sourceListeners = new Set<() => void>();
  /** id -> handedness + controller, recorded while sampling, read by pulse. */
  private readonly sampled = new Map<string, SampledSource>();
  private readonly detach: Unsubscribe[] = [];
  private readonly gripDistance: number;
  /** Read once from `scene.useRightHandedSystem`; flips forward to -Z. */
  private readonly rightHanded: boolean;

  private readonly pointer: PointerState = { down: false, x: 0, y: 0, ray: null };

  constructor(options: BabylonProviderOptions) {
    this.options = options;
    this.gripDistance = options.desktopGripDistance ?? 1;
    this.rightHanded = options.scene.useRightHandedSystem === true;
    this.capabilities = { ...NO_CAPABILITIES, headPose: true, gaze: true };
    this.attachPointer();
    this.attachSession();
    this.refreshCapabilities();
  }

  // -- wiring -------------------------------------------------------------------

  private attachPointer(): void {
    const observable = this.options.scene.onPointerObservable;
    if (!observable) return;
    const observer = observable.add((info: BabylonPointerInfoLike) => this.onPointer(info));
    this.detach.push(() => {
      observable.remove(observer);
    });
  }

  private onPointer(info: BabylonPointerInfoLike): void {
    const event = info.event;
    if (event?.clientX !== undefined) this.pointer.x = event.clientX;
    if (event?.clientY !== undefined) this.pointer.y = event.clientY;
    // Babylon hands the pick it already did for this event; reuse it rather
    // than picking the scene a second time on the next sample.
    const ray = info.pickInfo?.ray;
    if (ray) {
      this.pointer.ray = {
        origin: toVec3(ray.origin) ?? [0, 0, 0],
        direction: toVec3(ray.direction) ?? defaultForward(this.rightHanded),
      };
    }
    // Only the primary button selects. Babylon reports it as button 0, the
    // same numbering as a DOM PointerEvent.
    if (info.type === POINTER_EVENT_TYPES.down && (event?.button ?? 0) === 0) {
      this.pointer.down = true;
    }
    if (info.type === POINTER_EVENT_TYPES.up && (event?.button ?? 0) === 0) {
      this.pointer.down = false;
    }
  }

  private attachSession(): void {
    const manager = this.options.xr?.baseExperience?.sessionManager;
    const input = this.options.xr?.input;
    const republish = () => {
      this.refreshCapabilities();
      for (const listener of [...this.sourceListeners]) listener();
    };
    const subscribe = <T>(
      observable: { add(cb: (value: T) => void): unknown; remove(o: unknown): boolean } | undefined,
      handler: () => void,
    ): void => {
      if (!observable) return;
      const observer = observable.add(() => handler());
      this.detach.push(() => {
        observable.remove(observer);
      });
    };
    subscribe(manager?.onXRSessionInit, republish);
    subscribe(manager?.onXRSessionEnded, () => {
      this.sampled.clear();
      republish();
    });
    subscribe(input?.onControllerAddedObservable, republish);
    subscribe(input?.onControllerRemovedObservable, republish);
  }

  // -- capabilities -------------------------------------------------------------

  /** The live XR session, or null when none is running. */
  private session(): unknown {
    return this.options.xr?.baseExperience?.sessionManager?.session ?? null;
  }

  private controllers(): readonly BabylonXRControllerLike[] {
    return this.options.xr?.input?.controllers ?? [];
  }

  /** The hand-tracking feature, when the app enabled it. */
  private handTracking(): BabylonHandTrackingLike | null {
    const manager = this.options.xr?.baseExperience?.featuresManager;
    if (!manager) return null;
    const feature = manager.getEnabledFeature(HAND_TRACKING_FEATURE);
    if (!feature || typeof feature !== "object") return null;
    const candidate = feature as Partial<BabylonHandTrackingLike>;
    return typeof candidate.getHandByControllerId === "function"
      ? (feature as BabylonHandTrackingLike)
      : null;
  }

  private handFor(controller: BabylonXRControllerLike): BabylonXRHandLike | null {
    return this.handTracking()?.getHandByControllerId(controller.uniqueId) ?? null;
  }

  private refreshCapabilities(): void {
    const inSession = this.session() !== null;
    const desktop = !inSession && this.options.scene.onPointerObservable !== undefined;
    // Babylon reports no native grab observation, so grabs are always
    // poseOnly: the core drives the transform through the port.
    const next: InputCapabilities = {
      ...NO_CAPABILITIES,
      headPose: true,
      gaze: true,
      pointer2d: desktop,
      // The pointer fallback synthesises a grip on the ray, so hand-driven
      // behaviours negotiate on desktop too. Without this every one of them
      // switches itself off off-headset and only press remains usable.
      grabs: desktop ? "poseOnly" : NO_CAPABILITIES.grabs,
    };
    if (inSession) {
      for (const controller of this.controllers()) {
        if (controller.pointer) next.rays = true;
        if (controller.grip ?? controller.pointer) next.grabs = "poseOnly";
        if (controller.inputSource.hand) {
          next.handJoints = true;
          next.pokes = true;
        }
        // Pinch strength needs the tracked hand itself, not just the flag on
        // the input source, so it is gated on the feature reporting a hand.
        if (this.handFor(controller)) next.pinch = true;
        if (controller.motionController) next.buttonsAxes = true;
        if ((controller.inputSource.gamepad?.hapticActuators?.length ?? 0) > 0) {
          next.haptics = true;
        }
      }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.capabilities);
    this.capabilities = next;
    if (changed) {
      for (const listener of [...this.capsListeners]) listener(next);
    }
  }

  getCapabilities(): InputCapabilities {
    return this.capabilities;
  }

  onCapabilitiesChanged(listener: (c: InputCapabilities) => void): Unsubscribe {
    this.capsListeners.add(listener);
    return () => this.capsListeners.delete(listener);
  }

  onSourcesChanged(listener: () => void): Unsubscribe {
    this.sourceListeners.add(listener);
    return () => this.sourceListeners.delete(listener);
  }

  // -- sampling -----------------------------------------------------------------

  sample(): readonly InputSourceSnapshot[] {
    this.sampled.clear();
    if (this.session() === null) {
      // A session that ended between frames leaves stale capabilities behind.
      if (this.capabilities.rays) this.refreshCapabilities();
      return this.samplePointer();
    }

    const snapshots: InputSourceSnapshotWithVelocity[] = [];
    for (const controller of this.controllers()) {
      const handedness = normalizeHandedness(controller.inputSource.handedness);
      const hand = this.handFor(controller);
      const pointerNode = controller.pointer;
      const snapshot: InputSourceSnapshotWithVelocity = {
        id: controller.uniqueId,
        kind: controller.inputSource.hand ? "hand" : "controller",
        handedness,
        select: componentValue(
          controller.motionController?.getComponentOfType?.(TRIGGER_COMPONENT) ??
            controller.motionController?.getMainComponent?.() ??
            null,
        ),
        squeeze: componentValue(
          controller.motionController?.getComponentOfType?.(SQUEEZE_COMPONENT) ?? null,
        ),
      };
      if (pointerNode) {
        snapshot.ray = {
          origin: toVec3(pointerNode.getAbsolutePosition()) ?? [0, 0, 0],
          direction: nodeForward(pointerNode, this.rightHanded),
        };
      }
      // Babylon exposes the grip node only for a controller with one; a hand,
      // and a controller without a grip space, carry on the pointer node.
      const gripNode = controller.grip ?? pointerNode;
      if (gripNode) snapshot.gripPose = nodeWorldPose(gripNode);
      const tip = jointPosition(hand, INDEX_TIP_JOINT);
      if (tip) snapshot.indexTip = tip;
      if ((controller.inputSource.gamepad?.hapticActuators?.length ?? 0) > 0) {
        snapshot.hapticsAvailable = true;
      }
      // Babylon reports no per-pose velocity, so nothing is set here and the
      // core's VelocityTracker derives it from consecutive grip poses.
      snapshots.push(snapshot);
      this.sampled.set(snapshot.id, { handedness, controller });
    }
    return snapshots;
  }

  /**
   * The desktop pointer, shaped like the three.js adapter's mouse fallback:
   * one source, `handedness: "none"`, `kind: "pointer2d"`.
   */
  private samplePointer(): readonly InputSourceSnapshot[] {
    if (this.options.scene.onPointerObservable === undefined) return [];
    const ray = this.pointer.ray ?? this.pickRay();
    if (!ray) return [];
    const grip: Vec3Tuple = [
      ray.origin[0] + ray.direction[0] * this.gripDistance,
      ray.origin[1] + ray.direction[1] * this.gripDistance,
      ray.origin[2] + ray.direction[2] * this.gripDistance,
    ];
    return [
      {
        id: DESKTOP_SOURCE_ID,
        kind: "pointer2d",
        handedness: "none",
        ray: { origin: ray.origin, direction: ray.direction },
        gripPose: { position: grip, quaternion: toQuat(this.camera()?.absoluteRotation) },
        select: this.pointer.down ? 1 : 0,
        // A mouse has one button that means select. Squeeze stays 0 rather
        // than doubling the left button up as both, which would fire a press
        // and a grab together on an interactable that carries both.
        squeeze: 0,
      },
    ];
  }

  /** Pick the scene at the last known cursor position for a ray. */
  private pickRay(): { origin: Vec3Tuple; direction: Vec3Tuple } | null {
    const picked = this.options.scene.pick?.(this.pointer.x, this.pointer.y);
    const ray = picked?.ray;
    if (!ray) return null;
    return {
      origin: toVec3(ray.origin) ?? [0, 0, 0],
      direction: toVec3(ray.direction) ?? defaultForward(this.rightHanded),
    };
  }

  private camera(): BabylonCameraLike | null {
    return this.options.camera ?? this.options.scene.activeCamera ?? null;
  }

  getHeadPose(): HeadPose {
    const camera = this.camera();
    return {
      position: toVec3(camera?.globalPosition ?? camera?.position) ?? [0, 0, 0],
      quaternion: toQuat(camera?.absoluteRotation),
    };
  }

  // -- haptics ------------------------------------------------------------------

  /**
   * Babylon routes haptics through the motion controller rather than the
   * gamepad actuator, so a source with no motion controller cannot pulse
   * even when the gamepad reports an actuator.
   */
  pulse(sourceId: string, intensity: number, durationMs: number): boolean {
    const controller =
      this.sampled.get(sourceId)?.controller ??
      this.controllers().find((c) => c.uniqueId === sourceId);
    const motionController = controller?.motionController;
    if (!motionController?.pulse) return false;
    void motionController.pulse(Math.min(1, Math.max(0, intensity)), durationMs);
    return true;
  }

  // -- presence -----------------------------------------------------------------

  /**
   * True when Babylon has built at least one visual this provider can hide:
   * a motion controller root mesh, or a hand mesh from the hand-tracking
   * feature. Becomes `capabilities.presence` at
   * `@realitycollective/webxr-input` 0.1.1.
   */
  get supportsPresence(): boolean {
    for (const controller of this.controllers()) {
      if (this.visualsFor(controller).length > 0) return true;
    }
    return false;
  }

  /**
   * Show or hide the visuals Babylon built for the targeted sides. Returns
   * false when the target has nothing to show or hide. `"none"` targets no
   * side, so it reports whether presence is usable at all without changing
   * anything.
   */
  setPresenceVisible(target: PresenceTarget, visible: boolean): boolean {
    if (target === "none") return this.supportsPresence;
    let applied = false;
    for (const controller of this.controllers()) {
      const side = normalizeHandedness(controller.inputSource.handedness);
      if (target !== "all" && target !== side) continue;
      for (const node of this.visualsFor(controller)) {
        node.setEnabled?.(visible);
        applied = true;
      }
    }
    return applied;
  }

  /**
   * Always false. Babylon picks the visual per input source - a controller
   * gets its motion-controller model, a tracked hand gets the hand mesh -
   * and exposes no switch between the two. IWSDK builds both families, so
   * its adapter implements this.
   */
  setPresenceModality(_mode: PresenceModality): boolean {
    return false;
  }

  /** Every node that represents this controller on screen. */
  private visualsFor(controller: BabylonXRControllerLike): BabylonTransformNodeLike[] {
    const nodes: BabylonTransformNodeLike[] = [];
    const root = controller.motionController?.rootMesh;
    if (root) nodes.push(root);
    const handMesh = this.handFor(controller)?.handMesh;
    if (handMesh) nodes.push(handMesh);
    return nodes;
  }

  dispose(): void {
    for (const off of this.detach.splice(0)) off();
    this.sampled.clear();
    this.capsListeners.clear();
    this.sourceListeners.clear();
  }
}

/** Analog value where the component reports one, else the pressed flag. */
function componentValue(
  component: { value?: number; pressed?: boolean } | null | undefined,
): number {
  if (!component) return 0;
  if (typeof component.value === "number" && component.value > 0) return component.value;
  return component.pressed ? 1 : 0;
}

function jointPosition(
  hand: BabylonXRHandLike | null,
  joint: string,
): Vec3Tuple | null {
  const mesh = hand?.getJointMesh?.(joint);
  return mesh ? toVec3(mesh.getAbsolutePosition()) : null;
}

function normalizeHandedness(value: string | undefined): "left" | "right" | "none" {
  return value === "left" || value === "right" ? value : "none";
}
