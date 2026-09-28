/**
 * Structural fakes for the Babylon adapter's suites.
 *
 * `@babylonjs/core` is not installed - the adapter matches the shape of the
 * Babylon API rather than importing it, so the tests supply objects of the
 * same shape. Nothing here mocks a module.
 */
import {
  MemoryPhysicsFacility,
  type BabylonCameraLike,
  type BabylonHandTrackingLike,
  type BabylonMaterialLike,
  type BabylonMotionControllerComponentLike,
  type BabylonMotionControllerLike,
  type BabylonPhysicsBodyLike,
  type BabylonPhysicsEngineLike,
  type BabylonPhysicsKitLike,
  type BabylonPhysicsShapeLike,
  type BabylonPickingInfoLike,
  type BabylonPointerInfoLike,
  type BabylonQuaternionLike,
  type BabylonRayLike,
  type BabylonSceneLike,
  type BabylonTransformNodeLike,
  type BabylonVector3Like,
  type BabylonXRControllerLike,
  type BabylonXRExperienceLike,
  type BabylonXRHandLike,
  type PhysicsBodyState,
} from "@realitycollective/babylon-interactions";

/** A fake StandardMaterial-shaped material: `emissiveColor` only, no `emissiveIntensity`. */
export function fakeStandardMaterial(emissiveColor: Vec3 = [0, 0, 0]): BabylonMaterialLike {
  return { emissiveColor: v3(emissiveColor) };
}

/** A fake PBRMaterial-shaped material: `emissiveColor` plus `emissiveIntensity`. */
export function fakePbrMaterial(emissiveColor: Vec3 = [0, 0, 0], emissiveIntensity = 1): BabylonMaterialLike {
  return { emissiveColor: v3(emissiveColor), emissiveIntensity };
}

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
  /** Below: inert stand-ins for `BabylonPhysicsFacility`'s wider interface - this fake only ever backs the older `physicsMotionTypes` hold, which never calls them. */
  shape?: BabylonPhysicsShapeLike;
  gravityFactor = 1;
  linearDamping = 0;
  angularDamping = 0;
  targetTransformCalls: Array<[BabylonVector3Like, BabylonQuaternionLike]> = [];
  disposeCalls = 0;

  constructor(private readonly node: { position: BabylonVector3Like }) {}

  setMotionType(motionType: unknown): void {
    this.motionType = motionType as FakeMotionType;
    this.motionTypeWrites.push(this.motionType);
  }

  getMotionType(): unknown {
    return this.motionType;
  }

  setLinearVelocity(velocity: BabylonVector3Like): void {
    this.linearVelocity = [velocity.x, velocity.y, velocity.z];
  }

  getLinearVelocity(): BabylonVector3Like {
    return v3(this.linearVelocity);
  }

  setAngularVelocity(velocity: BabylonVector3Like): void {
    this.angularVelocity = [velocity.x, velocity.y, velocity.z];
  }

  getAngularVelocity(): BabylonVector3Like {
    return v3(this.angularVelocity);
  }

  setGravityFactor(factor: number): void {
    this.gravityFactor = factor;
  }

  setLinearDamping(damping: number): void {
    this.linearDamping = damping;
  }

  setAngularDamping(damping: number): void {
    this.angularDamping = damping;
  }

  setTargetTransform(position: BabylonVector3Like, rotation: BabylonQuaternionLike): void {
    this.targetTransformCalls.push([position, rotation]);
  }

  dispose(): void {
    this.disposeCalls += 1;
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
  /** `AbstractMesh.material` - single or an array, for `setEffect`'s emissive pulse. */
  material?: BabylonMaterialLike | BabylonMaterialLike[];
}

export class FakeNode implements BabylonTransformNodeLike {
  position: BabylonVector3Like;
  rotationQuaternion: BabylonQuaternionLike | null;
  scaling: BabylonVector3Like;
  parent: unknown;
  isVisible: boolean;
  enabled: boolean;
  material?: BabylonMaterialLike | BabylonMaterialLike[];
  computeWorldMatrixCalls = 0;
  readonly enabledWrites: boolean[] = [];
  readonly physicsBody?: FakePhysicsBody;
  private readonly absolutePosition: BabylonVector3Like | null;
  private readonly absoluteRotation: BabylonQuaternionLike | null;

  constructor(options: FakeNodeOptions = {}) {
    this.position = v3(options.position ?? [0, 0, 0]);
    if (options.material !== undefined) this.material = options.material;
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
    this.session = { id: "session", visibilityState: "visible" };
    this.controllers = controllers;
    this.onXRSessionInit.notify(this.session);
  }

  /** Set the live session's `visibilityState`, as the browser would. */
  setVisibility(state: string): void {
    (this.session as { visibilityState?: string }).visibilityState = state;
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

// ---------------------------------------------------------------------------
// A fake Havok-era Physics V2 kit for `BabylonPhysicsFacility`, standing in
// for `@babylonjs/core`/`@babylonjs/havok`, which this package has no
// dependency on. A fake body does not simulate anything itself - it mirrors
// its motion type, shape (material, density) and velocities into a shared
// `MemoryPhysicsFacility`, the family's own correct engine-free reference,
// so the whole real integration (addBody -> shape -> body -> step -> read
// back) is exercised end to end and behaves as a correct Havok body would.
// ---------------------------------------------------------------------------

/** Babylon's own `PhysicsMotionType` enum members - opaque values a fake round-trips through `setMotionType`/`getMotionType`. */
export const HAVOK_MOTION_TYPES = { STATIC: "STATIC", ANIMATED: "ANIMATED", DYNAMIC: "DYNAMIC" } as const;

function stateForMotionType(motionType: unknown): PhysicsBodyState {
  if (motionType === HAVOK_MOTION_TYPES.STATIC) return "static";
  if (motionType === HAVOK_MOTION_TYPES.ANIMATED) return "kinematic";
  return "dynamic";
}

type FakeShapeKind = "sphere" | "box" | "capsule" | "mesh";

class FakeHavokShape implements BabylonPhysicsShapeLike {
  material = { friction: 0.5, restitution: 0 };
  density = 1;
  disposeCalls = 0;

  constructor(
    readonly kind: FakeShapeKind,
    readonly dimensions: Vec3,
  ) {}

  dispose(): void {
    this.disposeCalls += 1;
  }
}

class FakeHavokBody implements BabylonPhysicsBodyLike {
  disablePreStep = false;
  readonly id: string;
  private motionType: unknown;
  private linear: Vec3 = [0, 0, 0];
  private angular: Vec3 = [0, 0, 0];
  private linearDamping = 0;
  private angularDamping = 0;
  private gravityFactor = 1;
  private registered = false;
  private _shape: FakeHavokShape | null = null;
  disposeCalls = 0;

  constructor(
    private readonly memory: MemoryPhysicsFacility,
    private readonly node: BabylonTransformNodeLike,
    motionType: unknown,
  ) {
    this.motionType = motionType;
    this.id = `havok-body-${nextHavokBodyId++}`;
  }

  get shape(): BabylonPhysicsShapeLike | null {
    return this._shape;
  }

  set shape(value: BabylonPhysicsShapeLike | null | undefined) {
    this._shape = (value as FakeHavokShape | null | undefined) ?? null;
    if (!this._shape) return;
    const shape = this._shape;
    this.memory.addBody(
      this.id,
      nodeWorldPoseOf(this.node),
      {
        state: stateForMotionType(this.motionType),
        linearDamping: this.linearDamping,
        angularDamping: this.angularDamping,
        gravityFactor: this.gravityFactor,
      },
      {
        kind: shape.kind === "mesh" ? "auto" : shape.kind,
        dimensions: shape.dimensions,
        density: shape.density,
        friction: shape.material.friction,
        restitution: shape.material.restitution,
      },
    );
    this.registered = true;
  }

  setMotionType(motionType: unknown): void {
    this.motionType = motionType;
    if (this.registered) this.memory.setBodyState(this.id, stateForMotionType(motionType));
  }

  getMotionType(): unknown {
    return this.motionType;
  }

  setLinearVelocity(v: BabylonVector3Like): void {
    this.linear = [v.x, v.y, v.z];
    this.syncVelocity();
  }

  getLinearVelocity(): BabylonVector3Like {
    return v3(this.registered ? this.memory.getVelocity(this.id).linear : this.linear);
  }

  setAngularVelocity(v: BabylonVector3Like): void {
    this.angular = [v.x, v.y, v.z];
    this.syncVelocity();
  }

  getAngularVelocity(): BabylonVector3Like {
    return v3(this.registered ? this.memory.getVelocity(this.id).angular : this.angular);
  }

  setGravityFactor(factor: number): void {
    this.gravityFactor = factor;
  }

  setLinearDamping(damping: number): void {
    this.linearDamping = damping;
  }

  setAngularDamping(damping: number): void {
    this.angularDamping = damping;
  }

  setTargetTransform(position: BabylonVector3Like, rotation: BabylonQuaternionLike): void {
    if (!this.registered) return;
    this.memory.setBodyPose(this.id, {
      position: [position.x, position.y, position.z],
      quaternion: [rotation.x, rotation.y, rotation.z, rotation.w],
    });
    this.linear = [0, 0, 0];
    this.angular = [0, 0, 0];
  }

  dispose(): void {
    this.disposeCalls += 1;
    if (this.registered) this.memory.removeBody(this.id);
    this.registered = false;
  }

  /** Read the simulated pose back into the node - what Babylon's own physics-drives-node sync does each step. */
  writeNodeFromMemory(): void {
    if (!this.registered) return;
    const pose = this.memory.getBodyPose(this.id);
    writeVec3(this.node.position, pose.position);
    if (this.node.rotationQuaternion) writeQuat(this.node.rotationQuaternion, pose.quaternion);
  }

  private syncVelocity(): void {
    if (this.registered) this.memory.setVelocity(this.id, { linear: this.linear, angular: this.angular });
  }
}

let nextHavokBodyId = 0;

function nodeWorldPoseOf(node: BabylonTransformNodeLike): { position: Vec3; quaternion: Quat } {
  const position = node.getAbsolutePosition();
  const rotation = node.absoluteRotationQuaternion ?? { x: 0, y: 0, z: 0, w: 1 };
  return { position: [position.x, position.y, position.z], quaternion: [rotation.x, rotation.y, rotation.z, rotation.w] };
}

function writeVec3(target: BabylonVector3Like, value: Vec3): void {
  target.x = value[0];
  target.y = value[1];
  target.z = value[2];
}

function writeQuat(target: BabylonQuaternionLike, value: Quat): void {
  target.x = value[0];
  target.y = value[1];
  target.z = value[2];
  target.w = value[3];
}

class FakeHavokEngine implements BabylonPhysicsEngineLike {
  gravity: BabylonVector3Like = { x: 0, y: -9.81, z: 0 };
  stepCalls = 0;

  constructor(
    private readonly memory: MemoryPhysicsFacility,
    private readonly bodies: () => readonly FakeHavokBody[],
  ) {}

  setGravity(gravity: BabylonVector3Like): void {
    this.gravity = { x: gravity.x, y: gravity.y, z: gravity.z };
    this.memory.setGravity([gravity.x, gravity.y, gravity.z]);
  }

  _step(dtSeconds: number): void {
    this.stepCalls += 1;
    this.memory.step(dtSeconds);
    for (const body of this.bodies()) body.writeNodeFromMemory();
  }
}

export interface FakeHavokEnvironment {
  scene: BabylonSceneLike;
  kit: BabylonPhysicsKitLike;
  memory: MemoryPhysicsFacility;
  engine: FakeHavokEngine;
  /** Register a node under an id, so `nodeFor` (and so `addBody`) can find it. */
  place(id: string, node: BabylonTransformNodeLike): void;
  nodeFor(id: string): BabylonTransformNodeLike | undefined;
  /** The most recently constructed body - for inspecting the shape a `shapeFor` branch built. */
  lastBody(): { shape?: BabylonPhysicsShapeLike | null } | undefined;
  /** Detach the fake engine, as a scene that never called `scene.enablePhysics(...)` would answer. */
  removeEngine(): void;
}

/** A fresh Havok-shaped kit and scene, backed by its own `MemoryPhysicsFacility` - build one per test. */
export function createFakeHavok(): FakeHavokEnvironment {
  const memory = new MemoryPhysicsFacility();
  const nodes = new Map<string, BabylonTransformNodeLike>();
  const bodies: FakeHavokBody[] = [];
  let engine: FakeHavokEngine | null = new FakeHavokEngine(memory, () => bodies);
  const liveEngine = engine;

  class KitPhysicsBody extends FakeHavokBody {
    constructor(node: BabylonTransformNodeLike, motionType: unknown, _startsAsleep: boolean, _scene: BabylonSceneLike) {
      super(memory, node, motionType);
      bodies.push(this);
    }
  }

  const scene: BabylonSceneLike = {
    getPhysicsEngine: () => engine,
  };

  const kit: BabylonPhysicsKitLike = {
    PhysicsBody: KitPhysicsBody,
    PhysicsShapeSphere: class extends FakeHavokShape {
      constructor(_center: BabylonVector3Like, radius: number, _scene: BabylonSceneLike) {
        super("sphere", [radius, 0, 0]);
      }
    },
    PhysicsShapeBox: class extends FakeHavokShape {
      constructor(_center: BabylonVector3Like, _rotation: BabylonQuaternionLike, extents: BabylonVector3Like, _scene: BabylonSceneLike) {
        super("box", [extents.x, extents.y, extents.z]);
      }
    },
    PhysicsShapeCapsule: class extends FakeHavokShape {
      constructor(pointA: BabylonVector3Like, pointB: BabylonVector3Like, radius: number, _scene: BabylonSceneLike) {
        const half = Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y, pointA.z - pointB.z) / 2;
        super("capsule", [radius, half * 2 + radius * 2, 0]);
      }
    },
    PhysicsShapeMesh: class extends FakeHavokShape {
      constructor(_mesh: BabylonTransformNodeLike, _scene: BabylonSceneLike) {
        super("mesh", [0, 0, 0]);
      }
    },
    PhysicsMotionType: HAVOK_MOTION_TYPES,
    Vector3: class implements BabylonVector3Like {
      constructor(
        public x: number,
        public y: number,
        public z: number,
      ) {}
    },
    Quaternion: class implements BabylonQuaternionLike {
      constructor(
        public x: number,
        public y: number,
        public z: number,
        public w: number,
      ) {}
    },
  };

  return {
    scene,
    kit,
    memory,
    engine: liveEngine,
    place(id, node) {
      nodes.set(id, node);
    },
    nodeFor(id) {
      return nodes.get(id);
    },
    lastBody() {
      return bodies[bodies.length - 1];
    },
    removeEngine() {
      engine = null;
    },
  };
}
