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
}

interface SelectState {
  selecting: boolean;
  squeezing: boolean;
}

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
  private readonly mouseNdc = new Vector2();
  private readonly raycaster = new Raycaster();
  private readonly detachDom: Unsubscribe;

  // Temps.
  private readonly v = new Vector3();
  private readonly q = new Quaternion();

  constructor(context: WebXRProviderContext) {
    this.context = context;
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
      onMove(event);
    };
    const onUp = (event: PointerEvent) => {
      if (event.button === 0) this.mouseDown = false;
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    return () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerdown", onDown);
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
    const next: InputCapabilities = {
      ...NO_CAPABILITIES,
      headPose: true,
      gaze: true,
      pointer2d: this.context.domElement !== undefined && session === null,
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

  private sampleDesktop(): readonly InputSourceSnapshot[] {
    if (!this.context.domElement) return [];
    this.raycaster.setFromCamera(this.mouseNdc, this.context.camera);
    return [
      {
        id: "mouse",
        kind: "pointer2d",
        handedness: "none",
        ray: {
          origin: [
            this.raycaster.ray.origin.x,
            this.raycaster.ray.origin.y,
            this.raycaster.ray.origin.z,
          ],
          direction: [
            this.raycaster.ray.direction.x,
            this.raycaster.ray.direction.y,
            this.raycaster.ray.direction.z,
          ],
        },
        select: this.mouseDown ? 1 : 0,
        squeeze: 0,
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
