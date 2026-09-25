/**
 * Structural fakes for the Babylon adapter's suites.
 *
 * `@babylonjs/core` is not installed - the adapter matches the shape of the
 * Babylon API rather than importing it, so the tests supply objects of the
 * same shape. Nothing here mocks a module.
 */
import type {
  BabylonCameraLike,
  BabylonHandTrackingLike,
  BabylonMotionControllerComponentLike,
  BabylonMotionControllerLike,
  BabylonPhysicsBodyLike,
  BabylonPickingInfoLike,
  BabylonPointerInfoLike,
  BabylonQuaternionLike,
  BabylonRayLike,
  BabylonSceneLike,
  BabylonTransformNodeLike,
  BabylonVector3Like,
  BabylonXRControllerLike,
  BabylonXRExperienceLike,
  BabylonXRHandLike,
} from "@realitycollective/babylon-interactions";

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

export function v3(value: Vec3): BabylonVector3Like {
  return { x: value[0], y: value[1], z: value[2] };
}

export function quat(value: Quat): BabylonQuaternionLike {
  return { x: value[0], y: value[1], z: value[2], w: value[3] };
}

/** 180 degrees about Y - turns Babylon's +Z forward into -Z. */
export const HALF_TURN_Y: Quat = [0, 1, 0, 0];

/**
 * A fake Physics V2 body: a structural stand-in for `PhysicsBody`, since
 * this package has no `@babylonjs/core`/`@babylonjs/havok` dependency to
 * test against for real (see `babylon-types.ts`'s own comment on that).
 * `step()` is a faithful-enough gravity simulation for the held/released/
 * reset contract cases: gravity moves the node while `DYNAMIC`, not while
 * `ANIMATED` (held) or `STATIC`, the same rule the real motion types name.
 */
export const PHYSICS_MOTION_TYPES = { animated: "ANIMATED", dynamic: "DYNAMIC" } as const;
export type FakeMotionType = (typeof PHYSICS_MOTION_TYPES)[keyof typeof PHYSICS_MOTION_TYPES];

export class FakePhysicsBody implements BabylonPhysicsBodyLike {
  disablePreStep = false;
  motionType: FakeMotionType = PHYSICS_MOTION_TYPES.dynamic;
  linearVelocity: Vec3 = [0, 0, 0];
  angularVelocity: Vec3 = [0, 0, 0];
  readonly motionTypeWrites: FakeMotionType[] = [];

  constructor(private readonly node: { position: BabylonVector3Like }) {}

  setMotionType(motionType: unknown): void {
    this.motionType = motionType as FakeMotionType;
    this.motionTypeWrites.push(this.motionType);
  }

  setLinearVelocity(velocity: BabylonVector3Like): void {
    this.linearVelocity = [velocity.x, velocity.y, velocity.z];
  }

  setAngularVelocity(velocity: BabylonVector3Like): void {
    this.angularVelocity = [velocity.x, velocity.y, velocity.z];
  }

  /** Gravity, for one step, skipped unless the body is DYNAMIC. */
  step(dtSeconds: number): void {
    if (this.motionType !== PHYSICS_MOTION_TYPES.dynamic) return;
    this.linearVelocity = [
      this.linearVelocity[0],
      this.linearVelocity[1] - 9.8 * dtSeconds,
      this.linearVelocity[2],
    ];
    this.node.position.x += this.linearVelocity[0] * dtSeconds;
    this.node.position.y += this.linearVelocity[1] * dtSeconds;
    this.node.position.z += this.linearVelocity[2] * dtSeconds;
  }
}

export class FakeObservable<T> {
  private readonly observers = new Set<(value: T) => void>();

  add(callback: (value: T) => void): unknown {
    this.observers.add(callback);
    return callback;
  }

  remove(observer: unknown): boolean {
    return this.observers.delete(observer as (value: T) => void);
  }

  notify(value: T): void {
    for (const observer of [...this.observers]) observer(value);
  }

  get count(): number {
    return this.observers.size;
  }
}

export interface FakeNodeOptions {
  position?: Vec3;
  rotationQuaternion?: Quat | null;
  scaling?: Vec3;
  /** Absolute position, when it differs from the local one. */
  absolutePosition?: Vec3;
  /** Absolute rotation, when it differs from the local one. */
  absoluteRotation?: Quat;
  parent?: unknown;
  isVisible?: boolean;
  enabled?: boolean;
  /** Attaches a {@link FakePhysicsBody}, reachable as `node.physicsBody`. */
  physics?: boolean;
}

export class FakeNode implements BabylonTransformNodeLike {
  position: BabylonVector3Like;
  rotationQuaternion: BabylonQuaternionLike | null;
  scaling: BabylonVector3Like;
  parent: unknown;
  isVisible: boolean;
  enabled: boolean;
  computeWorldMatrixCalls = 0;
  readonly enabledWrites: boolean[] = [];
  readonly physicsBody?: FakePhysicsBody;
  private readonly absolutePosition: BabylonVector3Like | null;
  private readonly absoluteRotation: BabylonQuaternionLike | null;

  constructor(options: FakeNodeOptions = {}) {
    this.position = v3(options.position ?? [0, 0, 0]);
    this.rotationQuaternion =
      options.rotationQuaternion === undefined
        ? null
        : options.rotationQuaternion === null
          ? null
          : quat(options.rotationQuaternion);
    this.scaling = v3(options.scaling ?? [1, 1, 1]);
    this.parent = options.parent ?? null;
    this.isVisible = options.isVisible ?? true;
    this.enabled = options.enabled ?? true;
    this.absolutePosition = options.absolutePosition ? v3(options.absolutePosition) : null;
    this.absoluteRotation = options.absoluteRotation ? quat(options.absoluteRotation) : null;
    if (options.physics) this.physicsBody = new FakePhysicsBody(this);
  }

  get absoluteRotationQuaternion(): BabylonQuaternionLike {
    return this.absoluteRotation ?? this.rotationQuaternion ?? quat([0, 0, 0, 1]);
  }

  getAbsolutePosition(): BabylonVector3Like {
    return this.absolutePosition ?? this.position;
  }

  computeWorldMatrix(force?: boolean): unknown {
    this.computeWorldMatrixCalls += 1;
    return force;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    this.enabledWrites.push(value);
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

/** A parent Babylon would type as `Node`: no transform to read. */
export const BARE_PARENT = { name: "bone" };

export class FakeScene implements BabylonSceneLike {
  useRightHandedSystem = false;
  readonly onBeforeRenderObservable = new FakeObservable<unknown>();
  readonly onPointerObservable = new FakeObservable<BabylonPointerInfoLike>();
  activeCamera: BabylonCameraLike | null = null;
  pickResult: BabylonPickingInfoLike | null = null;
  readonly picks: Array<[number, number]> = [];
  deltaMs = 16;

  pick(x: number, y: number): BabylonPickingInfoLike | null {
    this.picks.push([x, y]);
    return this.pickResult;
  }

  getEngine(): { getDeltaTime(): number } {
    return { getDeltaTime: () => this.deltaMs };
  }
}

export function ray(origin: Vec3, direction: Vec3): BabylonRayLike {
  return { origin: v3(origin), direction: v3(direction) };
}

export function pointerInfo(
  type: number,
  options: { x?: number; y?: number; button?: number; ray?: BabylonRayLike } = {},
): BabylonPointerInfoLike {
  return {
    type,
    event: {
      ...(options.x !== undefined ? { clientX: options.x } : {}),
      ...(options.y !== undefined ? { clientY: options.y } : {}),
      ...(options.button !== undefined ? { button: options.button } : {}),
    },
    ...(options.ray ? { pickInfo: { hit: true, ray: options.ray } } : {}),
  };
}

export interface FakeControllerOptions {
  id?: string;
  handedness?: string;
  /** Give the input source a `hand`, which makes the source a hand. */
  hand?: boolean;
  pointer?: FakeNode;
  grip?: FakeNode | null;
  /** Trigger component reading. Null means the component is absent. */
  trigger?: BabylonMotionControllerComponentLike | null;
  /** `getMainComponent()` reading, used when there is no trigger. */
  main?: BabylonMotionControllerComponentLike | null;
  squeeze?: BabylonMotionControllerComponentLike | null;
  rootMesh?: FakeNode | null;
  /** Number of haptic actuators the gamepad reports. */
  actuators?: number;
  /** Omit the motion controller entirely. */
  noMotionController?: boolean;
  /** Drop `pulse` from the motion controller. */
  noPulse?: boolean;
}

export class FakeController implements BabylonXRControllerLike {
  readonly uniqueId: string;
  readonly inputSource: {
    handedness?: string;
    hand?: unknown;
    gamepad?: { hapticActuators?: readonly unknown[] } | null;
  };
  readonly pointer: FakeNode;
  readonly grip: FakeNode | null;
  readonly motionController: BabylonMotionControllerLike | null;
  readonly pulses: Array<[number, number]> = [];

  constructor(options: FakeControllerOptions = {}) {
    this.uniqueId = options.id ?? "controller-1";
    this.inputSource = {
      ...(options.handedness !== undefined ? { handedness: options.handedness } : {}),
      ...(options.hand ? { hand: {} } : {}),
      gamepad:
        options.actuators !== undefined
          ? { hapticActuators: Array.from({ length: options.actuators }, () => ({})) }
          : null,
    };
    this.pointer = options.pointer ?? new FakeNode();
    this.grip = options.grip ?? null;
    this.motionController = options.noMotionController
      ? null
      : {
          getComponentOfType: (type: string) =>
            type === "trigger"
              ? (options.trigger ?? null)
              : type === "squeeze"
                ? (options.squeeze ?? null)
                : null,
          getMainComponent: () => options.main ?? null,
          ...(options.noPulse
            ? {}
            : {
                pulse: (value: number, duration: number) => {
                  this.pulses.push([value, duration]);
                  return Promise.resolve(true);
                },
              }),
          ...(options.rootMesh ? { rootMesh: options.rootMesh } : {}),
        };
  }
}

export class FakeHandTracking implements BabylonHandTrackingLike {
  readonly hands = new Map<string, BabylonXRHandLike>();

  getHandByControllerId(id: string): BabylonXRHandLike | null {
    return this.hands.get(id) ?? null;
  }
}

export function fakeHand(options: { indexTip?: FakeNode; handMesh?: FakeNode } = {}): BabylonXRHandLike {
  return {
    getJointMesh: (joint: string) =>
      joint === "index-finger-tip" ? (options.indexTip ?? null) : null,
    ...(options.handMesh ? { handMesh: options.handMesh } : {}),
  };
}

export class FakeExperience implements BabylonXRExperienceLike {
  session: unknown = null;
  controllers: BabylonXRControllerLike[] = [];
  handTracking: BabylonHandTrackingLike | null = null;
  featuresManagerPresent = true;
  readonly onXRSessionInit = new FakeObservable<unknown>();
  readonly onXRSessionEnded = new FakeObservable<unknown>();
  readonly onControllerAddedObservable = new FakeObservable<BabylonXRControllerLike>();
  readonly onControllerRemovedObservable = new FakeObservable<BabylonXRControllerLike>();

  /** Start a session with these controllers. */
  start(...controllers: BabylonXRControllerLike[]): void {
    this.session = { id: "session" };
    this.controllers = controllers;
    this.onXRSessionInit.notify(this.session);
  }

  end(): void {
    this.session = null;
    this.controllers = [];
    this.onXRSessionEnded.notify(null);
  }

  get baseExperience(): NonNullable<BabylonXRExperienceLike["baseExperience"]> {
    return {
      sessionManager: {
        session: this.session,
        onXRSessionInit: this.onXRSessionInit,
        onXRSessionEnded: this.onXRSessionEnded,
      },
      ...(this.featuresManagerPresent
        ? {
            featuresManager: {
              getEnabledFeature: (name: string) =>
                name === "xr-hand-tracking" ? this.handTracking : null,
            },
          }
        : {}),
    };
  }

  get input(): NonNullable<BabylonXRExperienceLike["input"]> {
    return {
      controllers: this.controllers,
      onControllerAddedObservable: this.onControllerAddedObservable,
      onControllerRemovedObservable: this.onControllerRemovedObservable,
    };
  }
}

export function fakeCamera(position: Vec3, rotation: Quat = [0, 0, 0, 1]): BabylonCameraLike {
  return { globalPosition: v3(position), absoluteRotation: quat(rotation) };
}
