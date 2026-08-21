/**
 * WebXRInputProvider - the standalone, framework-free input provider.
 *
 * Speaks the browser's OpenXR binding directly: `XRSession` input sources
 * (`targetRaySpace`, `gripSpace`, `hand` joints), `selectstart/selectend`
 * and `squeezestart/squeezeend`, gamepad analog values where present, and
 * haptic actuators. Falls back to a desktop mouse pointer (a ray from the
 * camera through the cursor) when no immersive session is live, so every
 * consumer runs in a flat browser too.
 *
 * Capabilities are derived from the LIVE session (never the requested
 * config) and re-published on session start/end and input-source changes.
 */
import { Raycaster, Vector2, Vector3, Quaternion, type Camera, type WebXRManager } from "three";
import {
  NO_CAPABILITIES,
  type HeadPose,
  type InputCapabilities,
  type InputProvider,
  type InputSourceSnapshot,
  type PoseTuple,
  type Unsubscribe,
} from "@realitycollective/webxr-input";

export interface WebXRProviderContext {
  /** three.js `renderer.xr` (or anything with the same session surface). */
  xr: Pick<WebXRManager, "getSession" | "getReferenceSpace" | "getFrame">;
  /** The rendering camera - head pose in XR, pointer projection on desktop. */
  camera: Camera;
  /** DOM element for the desktop mouse fallback (canvas). Omit to disable. */
  domElement?: HTMLElement;
  /**
   * Metres along the mouse ray at which the desktop fallback places its
   * synthetic grip pose. Hand-driven behaviours (grab, hinge, dial, slide)
   * track a grip position; a mouse has none, so one is projected onto the ray.
   * Set this near the distance of the things being manipulated - too short and
   * levers barely swing, too long and they over-swing. Default 1 metre.
   */
  desktopGripDistance?: number;
  /**
   * Which mouse button reports `squeeze` on desktop. Default `"left"`.
   *
   * The right button is NOT the default, because the shared desktop camera
   * controls (`DesktopControls` in `@realitycollective/xrblocks-uiextensions`)
   * bind right-drag to look and reserve the left button for interaction. That
   * leaves the left button to carry both actions, which is fine as long as an
   * interactable does not mix a select-driven behaviour (press) with a
   * grab-driven one (grab, hinge, dial, slide) - such an interactable would
   * receive both on a single click. Use `"right"` only in an app that does not
   * use right-drag to look.
   */
  desktopSqueezeButton?: "left" | "right" | "none";
}

interface SelectState {
  selecting: boolean;
  squeezing: boolean;
}

/** Where the desktop fallback puts its synthetic grip along the mouse ray. */
const DEFAULT_DESKTOP_GRIP_DISTANCE = 1;

/** Centre of the viewport, used while the pointer is locked. */
const ZERO_NDC = new Vector2(0, 0);

export class WebXRInputProvider implements InputProvider {
  private readonly context: WebXRProviderContext;
  private capabilities: InputCapabilities;
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();
  private readonly sourceListeners = new Set<() => void>();
  private readonly selectStates = new Map<XRInputSource, SelectState>();
  private boundSession: XRSession | null = null;
  private readonly sessionHandlers: Array<[string, EventListener]> = [];

  // Desktop pointer state.
  private mouseDown = false;
  private mouseRight = false;
  private readonly mouseNdc = new Vector2();
  private readonly raycaster = new Raycaster();
  private readonly detachDom: Unsubscribe;
  private readonly gripDistance: number;
  private readonly squeezeButton: "left" | "right" | "none";

  // Temps.
  private readonly v = new Vector3();
  private readonly q = new Quaternion();
  private readonly pointerNdc = new Vector2();
  private readonly gripPoint = new Vector3();
  private readonly gripQuaternion = new Quaternion();

  constructor(context: WebXRProviderContext) {
    this.context = context;
    this.gripDistance = context.desktopGripDistance ?? DEFAULT_DESKTOP_GRIP_DISTANCE;
    // Read before attachDom - it decides whether to claim the context menu.
    this.squeezeButton = context.desktopSqueezeButton ?? "left";
    this.capabilities = { ...NO_CAPABILITIES, headPose: true, gaze: true };
    this.detachDom = this.attachDom(context.domElement);
    this.refreshCapabilities();
  }

  private attachDom(element: HTMLElement | undefined): Unsubscribe {
    if (!element) return () => undefined;
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      this.mouseNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const onDown = (event: PointerEvent) => {
      if (event.button === 0) this.mouseDown = true;
      if (event.button === 2) this.mouseRight = true;
      onMove(event);
    };
    const onUp = (event: PointerEvent) => {
      if (event.button === 0) this.mouseDown = false;
      if (event.button === 2) this.mouseRight = false;
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerdown", onDown);
    // Only when the right button carries squeeze. Otherwise the menu belongs to
    // whoever else is listening - the shared camera controls suppress it there.
    // Without this, a right press opens the menu, the matching pointerup never
    // arrives, and the squeeze latches on.
    const onContextMenu =
      this.squeezeButton === "right" ? (event: Event) => event.preventDefault() : undefined;
    if (onContextMenu) element.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerdown", onDown);
      if (onContextMenu) element.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("pointerup", onUp);
    };
  }

  /** Bind/unbind session listeners as the session comes and goes. */
  private syncSession(): XRSession | null {
    const session = this.context.xr.getSession();
    if (session === this.boundSession) return session;

    if (this.boundSession) {
      for (const [type, handler] of this.sessionHandlers) {
        this.boundSession.removeEventListener(type, handler);
      }
      this.sessionHandlers.length = 0;
      this.selectStates.clear();
    }
    this.boundSession = session;
    if (session) {
      const setSelect = (selecting: boolean) => (event: Event) => {
        const source = (event as XRInputSourceEvent).inputSource;
        const state = this.selectState(source);
        state.selecting = selecting;
      };
      const setSqueeze = (squeezing: boolean) => (event: Event) => {
        const source = (event as XRInputSourceEvent).inputSource;
        const state = this.selectState(source);
        state.squeezing = squeezing;
      };
      const onSourcesChange = () => {
        this.refreshCapabilities();
        for (const listener of [...this.sourceListeners]) listener();
      };
      const onEnd = () => {
        this.boundSession = null;
        this.sessionHandlers.length = 0;
        this.selectStates.clear();
        this.refreshCapabilities();
      };
      const pairs: Array<[string, EventListener]> = [
        ["selectstart", setSelect(true)],
        ["selectend", setSelect(false)],
        ["squeezestart", setSqueeze(true)],
        ["squeezeend", setSqueeze(false)],
        ["inputsourceschange", onSourcesChange],
        ["end", onEnd],
      ];
      for (const [type, handler] of pairs) {
        session.addEventListener(type, handler);
        this.sessionHandlers.push([type, handler]);
      }
      this.refreshCapabilities();
    }
    return session;
  }

  private selectState(source: XRInputSource): SelectState {
    let state = this.selectStates.get(source);
    if (!state) {
      state = { selecting: false, squeezing: false };
      this.selectStates.set(source, state);
    }
    return state;
  }

  private refreshCapabilities(): void {
    const session = this.boundSession ?? this.context.xr.getSession();
    const desktop = this.context.domElement !== undefined && session === null;
    const next: InputCapabilities = {
      ...NO_CAPABILITIES,
      headPose: true,
      gaze: true,
      pointer2d: desktop,
      // NOTE: `rays` stays false on desktop on purpose. sample() uses it as the
      // "a session just ended" sentinel, so setting it here would re-derive
      // capabilities on every frame for the whole life of the page.
      // The desktop fallback synthesises a grip on the mouse ray, so hand-driven
      // behaviours (grab, hinge, dial, slide) negotiate successfully. Without
      // this `grabs` stays "none" off-headset and capability negotiation
      // disables every one of them, leaving press as the only usable behaviour.
      grabs: desktop ? "poseOnly" : NO_CAPABILITIES.grabs,
    };
    if (session) {
      for (const source of session.inputSources) {
        if (source.targetRaySpace) next.rays = true;
        if (source.gripSpace || source.hand) next.grabs = "poseOnly";
        if (source.hand) {
          next.handJoints = true;
          next.pokes = true;
          next.pinch = true;
        }
        if (source.gamepad) {
          next.buttonsAxes = true;
          if ((source.gamepad.hapticActuators?.length ?? 0) > 0) next.haptics = true;
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

  sample(): readonly InputSourceSnapshot[] {
    const session = this.syncSession();
    // The session-null path also re-derives capabilities when a session
    // just ended between frames.
    if (!session) {
      if (this.capabilities.rays) this.refreshCapabilities();
      return this.sampleDesktop();
    }

    const frame = this.context.xr.getFrame();
    const referenceSpace = this.context.xr.getReferenceSpace();
    if (!frame || !referenceSpace) return [];

    const snapshots: InputSourceSnapshot[] = [];
    let index = 0;
    for (const source of session.inputSources) {
      const state = this.selectState(source);
      const id = `${source.handedness}-${source.hand ? "hand" : "controller"}-${index++}`;
      const snapshot: InputSourceSnapshot = {
        id,
        kind: source.hand ? "hand" : "controller",
        handedness:
          source.handedness === "left" || source.handedness === "right"
            ? source.handedness
            : "none",
        select: this.selectValue(source, state),
        squeeze: this.squeezeValue(source, state),
      };

      const rayPose = frame.getPose(source.targetRaySpace, referenceSpace);
      if (rayPose) {
        const p = rayPose.transform.position;
        const o = rayPose.transform.orientation;
        this.q.set(o.x, o.y, o.z, o.w);
        this.v.set(0, 0, -1).applyQuaternion(this.q);
        snapshot.ray = {
          origin: [p.x, p.y, p.z],
          direction: [this.v.x, this.v.y, this.v.z],
        };
      }
      if (source.gripSpace) {
        const gripPose = frame.getPose(source.gripSpace, referenceSpace);
        if (gripPose) snapshot.gripPose = xrPoseToTuple(gripPose);
      }
      if (source.hand) {
        const joint = source.hand.get("index-finger-tip");
        const jointPose = joint ? frame.getJointPose?.(joint, referenceSpace) : undefined;
        if (jointPose) {
          const p = jointPose.transform.position;
          snapshot.indexTip = [p.x, p.y, p.z];
        }
        // Hands without a gripSpace still need a carry pose: use the wrist.
        if (!snapshot.gripPose) {
          const wrist = source.hand.get("wrist");
          const wristPose = wrist ? frame.getJointPose?.(wrist, referenceSpace) : undefined;
          if (wristPose) snapshot.gripPose = xrPoseToTuple(wristPose);
        }
      }
      if ((source.gamepad?.hapticActuators?.length ?? 0) > 0) {
        snapshot.hapticsAvailable = true;
      }
      snapshots.push(snapshot);
    }
    return snapshots;
  }

  /** Analog trigger where available, else the select event state. */
  private selectValue(source: XRInputSource, state: SelectState): number {
    const analog = source.gamepad?.buttons[0]?.value;
    if (analog !== undefined && analog > 0) return analog;
    return state.selecting ? 1 : 0;
  }

  private squeezeValue(source: XRInputSource, state: SelectState): number {
    const analog = source.gamepad?.buttons[1]?.value;
    if (analog !== undefined && analog > 0) return analog;
    return state.squeezing ? 1 : 0;
  }

  /** Is the configured squeeze button currently held? */
  private squeezing(): boolean {
    if (this.squeezeButton === "left") return this.mouseDown;
    if (this.squeezeButton === "right") return this.mouseRight;
    return false;
  }

  private sampleDesktop(): readonly InputSourceSnapshot[] {
    const element = this.context.domElement;
    if (!element) return [];

    // Under pointer lock the cursor stops moving and clientX/clientY freeze, so
    // the tracked NDC would stick wherever the pointer was when it locked. A
    // locked pointer aims from the centre of the viewport instead.
    const locked =
      typeof document !== "undefined" && document.pointerLockElement === element;
    this.pointerNdc.copy(locked ? ZERO_NDC : this.mouseNdc);
    this.raycaster.setFromCamera(this.pointerNdc, this.context.camera);

    const { origin, direction } = this.raycaster.ray;
    // A mouse has no grip. Hand-driven behaviours read `gripPose.position` (or
    // fall back to `ray.origin`, which is the camera and barely moves), so
    // project a grip onto the ray to give them something that tracks the
    // pointer.
    this.gripPoint.copy(direction).multiplyScalar(this.gripDistance).add(origin);
    this.context.camera.getWorldQuaternion(this.gripQuaternion);

    return [
      {
        id: "mouse",
        kind: "pointer2d",
        handedness: "none",
        ray: {
          origin: [origin.x, origin.y, origin.z],
          direction: [direction.x, direction.y, direction.z],
        },
        gripPose: {
          position: [this.gripPoint.x, this.gripPoint.y, this.gripPoint.z],
          quaternion: [
            this.gripQuaternion.x,
            this.gripQuaternion.y,
            this.gripQuaternion.z,
            this.gripQuaternion.w,
          ],
        },
        select: this.mouseDown ? 1 : 0,
        squeeze: this.squeezing() ? 1 : 0,
      },
    ];
  }

  getHeadPose(): HeadPose {
    this.context.camera.getWorldPosition(this.v);
    this.context.camera.getWorldQuaternion(this.q);
    return {
      position: [this.v.x, this.v.y, this.v.z],
      quaternion: [this.q.x, this.q.y, this.q.z, this.q.w],
    };
  }

  pulse(sourceId: string, intensity: number, durationMs: number): boolean {
    const session = this.boundSession;
    if (!session) return false;
    let index = 0;
    for (const source of session.inputSources) {
      const id = `${source.handedness}-${source.hand ? "hand" : "controller"}-${index++}`;
      if (id !== sourceId) continue;
      const actuator = source.gamepad?.hapticActuators?.[0];
      if (!actuator) return false;
      void (actuator as { pulse?: (i: number, d: number) => Promise<boolean> }).pulse?.(
        Math.min(1, Math.max(0, intensity)),
        durationMs,
      );
      return true;
    }
    return false;
  }

  dispose(): void {
    this.detachDom();
    if (this.boundSession) {
      for (const [type, handler] of this.sessionHandlers) {
        this.boundSession.removeEventListener(type, handler);
      }
    }
  }
}

function xrPoseToTuple(pose: XRPose): PoseTuple {
  const p = pose.transform.position;
  const o = pose.transform.orientation;
  return { position: [p.x, p.y, p.z], quaternion: [o.x, o.y, o.z, o.w] };
}
