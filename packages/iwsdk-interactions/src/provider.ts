/**
 * IWSDKInputProvider - feeds Meta IWSDK's input machinery into the shared
 * input contracts, in place of the standalone WebXR provider.
 *
 * Poses come from the IWSDK player rig (`world.playerSpaceEntities`:
 * ray/grip/index-tip spaces, head), signals from the stateful XR gamepads
 * (`world.input.xr.gamepads` - analog trigger/squeeze with `getSelecting`
 * fallback, which also covers hand pinch). Capabilities derive from the
 * LIVE session and re-publish on visibility/input-source changes.
 *
 * Provider power: IWSDK resolves its own targeting (BVH raycasts →
 * `Pressed`/`Grabbed` tags). The bridge system turns those tags into
 * pre-resolved hints (`setHints`) and flags native grabbing, which the
 * core consumes IN PLACE of its own hit-testing.
 */
import { InputComponent, VisibilityState, type World } from "@iwsdk/core";
import {
  NO_CAPABILITIES,
  type HeadPose,
  type InputCapabilities,
  type InputHitHint,
  type InputProvider,
  type InputSourceSnapshot,
  type Unsubscribe,
} from "@realitycollective/webxr-input";

export interface IWSDKProviderOptions {
  /**
   * The app enabled IWSDK's `features.grabbing` (+ physics where needed),
   * so grab behaviours are fulfilled NATIVELY by the engine.
   */
  nativeGrab?: boolean;
}

type Side = "left" | "right";
const SIDES: readonly Side[] = ["left", "right"];

export class IWSDKInputProvider implements InputProvider {
  private readonly world: World;
  private readonly nativeGrab: boolean;
  private capabilities: InputCapabilities;
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();
  private readonly sourceListeners = new Set<() => void>();
  private hints: InputHitHint[] = [];
  private readonly nativeGrabbing: Record<Side, boolean> = { left: false, right: false };
  private readonly disposers: Unsubscribe[] = [];
  private boundSession: XRSession | null = null;
  private readonly onSourcesChange = () => {
    this.refreshCapabilities();
    for (const listener of [...this.sourceListeners]) listener();
  };

  constructor(world: World, options: IWSDKProviderOptions = {}) {
    this.world = world;
    this.nativeGrab = options.nativeGrab ?? false;
    this.capabilities = { ...NO_CAPABILITIES };
    const unsubscribe = world.visibilityState.subscribe(() => {
      this.bindSession();
      this.refreshCapabilities();
    });
    this.disposers.push(unsubscribe);
    this.bindSession();
    this.refreshCapabilities();
  }

  private bindSession(): void {
    const session = this.world.session ?? null;
    if (session === this.boundSession) return;
    this.boundSession?.removeEventListener("inputsourceschange", this.onSourcesChange);
    this.boundSession = session;
    session?.addEventListener("inputsourceschange", this.onSourcesChange);
  }

  private hasTrackedHand(): boolean {
    const session = this.world.session;
    if (!session) return false;
    for (const source of session.inputSources) {
      if (source.hand) return true;
    }
    return false;
  }

  private refreshCapabilities(): void {
    const session = this.world.session;
    const immersive = !!session;
    const handTracking =
      immersive &&
      ((session?.enabledFeatures?.includes("hand-tracking") ?? false) || this.hasTrackedHand());
    let buttonsAxes = false;
    let haptics = false;
    for (const side of SIDES) {
      const gamepad = this.world.input.xr.gamepads[side];
      if (gamepad?.gamepad) buttonsAxes = true;
      if ((gamepad?.gamepad?.hapticActuators?.length ?? 0) > 0) haptics = true;
    }
    const next: InputCapabilities = {
      ...NO_CAPABILITIES,
      rays: immersive,
      // Index-tip spaces exist for controllers too (fall back to ray pose).
      pokes: immersive,
      grabs: immersive ? (this.nativeGrab ? "native" : "poseOnly") : "none",
      handJoints: handTracking,
      pinch: handTracking,
      buttonsAxes,
      gaze: true,
      headPose: true,
      haptics,
    };
    if (JSON.stringify(next) !== JSON.stringify(this.capabilities)) {
      this.capabilities = next;
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

  /** Bridge-system input: this frame's pre-resolved tag hints. */
  setHints(hints: InputHitHint[]): void {
    this.hints = hints;
  }

  sampleHints(): readonly InputHitHint[] {
    return this.hints;
  }

  /** Bridge-system input: a side is currently native-grabbing. */
  setNativeGrabbing(side: Side, grabbing: boolean): void {
    this.nativeGrabbing[side] = grabbing;
  }

  sample(): readonly InputSourceSnapshot[] {
    if (!this.world.session) return [];
    if (this.world.visibilityState.peek() !== VisibilityState.Visible) return [];

    const spaces = this.world.playerSpaceEntities;
    const snapshots: InputSourceSnapshot[] = [];
    for (const side of SIDES) {
      const rayObject = spaces.raySpaces[side].object3D;
      if (!rayObject) continue;
      const gamepad = this.world.input.xr.gamepads[side];
      const hand = this.capabilities.handJoints;

      rayObject.updateWorldMatrix(true, false);
      const rayPos = rayObject.getWorldPosition(TEMP.v1);
      const rayQuat = rayObject.getWorldQuaternion(TEMP.q1);
      const forward = TEMP.v2.set(0, 0, -1).applyQuaternion(rayQuat);

      const select = gamepad
        ? Math.max(gamepad.getButtonValue(InputComponent.Trigger), gamepad.getSelecting() ? 1 : 0)
        : 0;
      const squeeze = gamepad ? gamepad.getButtonValue(InputComponent.Squeeze) : 0;

      const snapshot: InputSourceSnapshot = {
        id: `${side}-input`,
        kind: hand ? "hand" : "controller",
        handedness: side,
        ray: {
          origin: [rayPos.x, rayPos.y, rayPos.z],
          direction: [forward.x, forward.y, forward.z],
        },
        select,
        squeeze,
      };

      const gripObject = spaces.gripSpaces[side].object3D;
      if (gripObject) {
        const gripPos = gripObject.getWorldPosition(TEMP.v1);
        const gripQuat = gripObject.getWorldQuaternion(TEMP.q1);
        snapshot.gripPose = {
          position: [gripPos.x, gripPos.y, gripPos.z],
          quaternion: [gripQuat.x, gripQuat.y, gripQuat.z, gripQuat.w],
        };
      }
      const tipObject = spaces.indexTipSpaces[side].object3D;
      if (tipObject) {
        const tipPos = tipObject.getWorldPosition(TEMP.v1);
        snapshot.indexTip = [tipPos.x, tipPos.y, tipPos.z];
      }
      if (this.nativeGrabbing[side]) snapshot.nativeGrabbing = true;
      if ((gamepad?.gamepad?.hapticActuators?.length ?? 0) > 0) {
        snapshot.hapticsAvailable = true;
      }
      snapshots.push(snapshot);
    }
    return snapshots;
  }

  getHeadPose(): HeadPose {
    const head = this.world.playerSpaceEntities.head.object3D;
    if (!head) return { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
    const position = head.getWorldPosition(TEMP.v1);
    const quaternion = head.getWorldQuaternion(TEMP.q1);
    return {
      position: [position.x, position.y, position.z],
      quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    };
  }

  pulse(sourceId: string, intensity: number, durationMs: number): boolean {
    const side = sourceId.startsWith("left") ? "left" : sourceId.startsWith("right") ? "right" : null;
    if (!side) return false;
    const actuator = this.world.input.xr.gamepads[side]?.gamepad?.hapticActuators?.[0];
    if (!actuator) return false;
    void (actuator as { pulse?: (i: number, d: number) => Promise<boolean> }).pulse?.(
      Math.min(1, Math.max(0, intensity)),
      durationMs,
    );
    return true;
  }

  dispose(): void {
    this.boundSession?.removeEventListener("inputsourceschange", this.onSourcesChange);
    for (const dispose of this.disposers) dispose();
  }
}

// Shared scratch objects (single-threaded frame sampling).
import { Quaternion, Vector3 } from "@iwsdk/core";
const TEMP = { v1: new Vector3(), v2: new Vector3(), q1: new Quaternion() };
