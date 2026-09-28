/**
 * A structural stand-in for an IWSDK `World`.
 *
 * `@iwsdk/core` imports headlessly in node, so the adapter is tested
 * against the real `InputComponent` / `VisibilityState` values and real
 * three.js `Object3D`s - only the world around them is faked. Nothing here
 * mocks a module; the provider is given an object of the right shape.
 */
import { Object3D } from "three";
import {
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
} from "@iwsdk/core";
import {
  MemoryPhysicsFacility,
  type PhysicsBodyState,
  type PhysicsShapeKind,
  type Vec3Tuple,
} from "@realitycollective/webxr-interactions";

/** `PhysicsBody.state`/`PhysicsShape.shape`'s raw IWSDK strings, mapped back to the core's values - the reverse of `physics-facility.ts`'s own maps. */
const STATE_FROM_IWSDK: Record<string, PhysicsBodyState> = {
  [PhysicsState.Dynamic]: "dynamic",
  [PhysicsState.Static]: "static",
  [PhysicsState.Kinematic]: "kinematic",
};
const SHAPE_FROM_IWSDK: Record<string, PhysicsShapeKind> = {
  [PhysicsShapeType.Auto]: "auto",
  [PhysicsShapeType.Sphere]: "sphere",
  [PhysicsShapeType.Box]: "box",
  [PhysicsShapeType.Capsules]: "capsule",
};

interface FakePhysicsBodyData {
  state?: string;
  linearDamping?: number;
  angularDamping?: number;
  gravityFactor?: number;
}
interface FakePhysicsShapeData {
  shape?: string;
  dimensions?: Vec3Tuple;
  density?: number;
  restitution?: number;
  friction?: number;
}
interface FakePhysicsManipulationData {
  linearVelocity?: Vec3Tuple;
  angularVelocity?: Vec3Tuple;
}

/** Backs a {@link FakePhysicsEntity} with a shared, engine-free simulation, keyed by `id`. */
export interface FakePhysicsMemory {
  facility: MemoryPhysicsFacility;
  id: string;
}

/**
 * A component bag keyed by the real `@iwsdk/core` component identities
 * (`PhysicsBody`, `PhysicsShape`, `PhysicsManipulation`), the same style the
 * rest of this file's fakes use for `InputComponent`/`VisibilityState` -
 * see this file's own header.
 *
 * With no `memory`, it is exactly the plain bag `physics-binding.test.ts`
 * used before: `addComponent`/`removeComponent`/`hasComponent`/`getValue`
 * read and write the bag only, which is all that file's cases need.
 *
 * With a `memory` (a shared `MemoryPhysicsFacility`, keyed by `id`,
 * `physics-facility.test.ts`'s fake world), every write that changes what a
 * body DOES also mirrors into it, standing in for the real `PhysicsSystem`'s
 * ECS sync no test can stand up (Havok runs in a worker):
 * - `addComponent(PhysicsBody | PhysicsShape, ...)` rebuilds the body in
 *   `memory` from whatever is in the bag so far (IWSDK writes the two
 *   components separately, so the second call is the one with a real
 *   shape) - unless the body is currently suspended in `memory`, in which
 *   case re-adding `PhysicsBody` is a RESUME (`IWSDKPhysicsFacility.resume`
 *   re-adds it before a following `PhysicsManipulation`, if any, carries
 *   the release velocity).
 * - `addComponent(PhysicsManipulation, ...)` is `memory.setVelocity`.
 * - `setValue(PhysicsBody, "state", ...)` is `memory.setBodyState`.
 * - `removeComponent(PhysicsBody)` is `memory.suspend` when `PhysicsShape`
 *   is still in the bag (a hold), or `memory.removeBody` once `PhysicsShape`
 *   is already gone too (`IWSDKPhysicsFacility.removeBody` removes the
 *   shape first, precisely so this can tell the two apart).
 * - `getVectorView(PhysicsBody, "_linearVelocity" | "_angularVelocity")`
 *   reads the SIMULATED velocity from `memory` instead of the bag, since
 *   nothing ever writes those fields directly - a real `PhysicsSystem`
 *   writes them back from Havok every step.
 *
 * What it does NOT mirror: `object3D`'s pose. `IWSDKPhysicsFacility` places
 * it directly (`addBody`'s `writeObjectPose`, `setBodyPose` while suspended
 * or system-less), outside any component write this bag can see. The fake
 * world's own `step` (`physics-facility.test.ts`) pulls the object's current
 * pose into `memory` before every step and pushes the simulated one back
 * after, so that gap never outlives one step.
 */
export class FakePhysicsEntity {
  readonly object3D = new Object3D();
  private readonly components = new Map<unknown, Record<string, unknown>>();
  private readonly memory: FakePhysicsMemory | undefined;

  constructor(memory?: FakePhysicsMemory) {
    this.memory = memory;
  }

  addComponent(component: unknown, initialData: Record<string, unknown> = {}): this {
    this.components.set(component, { ...initialData });
    if (this.memory) this.syncAdd(component);
    return this;
  }

  removeComponent(component: unknown): this {
    this.components.delete(component);
    if (this.memory && component === PhysicsBody) {
      const { facility, id } = this.memory;
      if (this.components.has(PhysicsShape)) facility.suspend(id);
      else facility.removeBody(id);
    }
    return this;
  }

  hasComponent(component: unknown): boolean {
    return this.components.has(component);
  }

  getValue(component: unknown, key: string): unknown {
    return this.components.get(component)?.[key] ?? null;
  }

  setValue(component: unknown, key: string, value: unknown): void {
    const data = this.components.get(component);
    if (data) data[key] = value;
    if (this.memory && component === PhysicsBody && key === "state") {
      this.memory.facility.setBodyState(this.memory.id, STATE_FROM_IWSDK[value as string] ?? "dynamic");
    }
  }

  getVectorView(component: unknown, key: string): Vec3Tuple {
    if (this.memory && component === PhysicsBody && (key === "_linearVelocity" || key === "_angularVelocity")) {
      const velocity = this.memory.facility.getVelocity(this.memory.id);
      return key === "_linearVelocity" ? velocity.linear : velocity.angular;
    }
    const data = this.components.get(component)?.[key];
    return Array.isArray(data) ? (data as Vec3Tuple) : [0, 0, 0];
  }

  private syncAdd(component: unknown): void {
    const { facility, id } = this.memory!;
    if (component === PhysicsManipulation) {
      const data = this.components.get(PhysicsManipulation) as FakePhysicsManipulationData | undefined;
      facility.setVelocity(id, {
        linear: data?.linearVelocity ?? [0, 0, 0],
        angular: data?.angularVelocity ?? [0, 0, 0],
      });
      return;
    }
    if (component !== PhysicsBody && component !== PhysicsShape) return;
    const bodyData = this.components.get(PhysicsBody) as FakePhysicsBodyData | undefined;
    if (!bodyData) return;
    if (component === PhysicsBody && facility.hasBody(id) && facility.isSuspended(id)) {
      // A resume: PhysicsManipulation, if any, follows with the release velocity.
      facility.resume(id, { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] });
      facility.setBodyState(id, STATE_FROM_IWSDK[bodyData.state ?? ""] ?? "dynamic");
      return;
    }
    // A fresh add, or a replace: rebuild the whole body from the bag.
    const shapeData = this.components.get(PhysicsShape) as FakePhysicsShapeData | undefined;
    const object = this.object3D;
    facility.addBody(
      id,
      {
        position: [object.position.x, object.position.y, object.position.z],
        quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w],
      },
      {
        state: STATE_FROM_IWSDK[bodyData.state ?? ""] ?? "dynamic",
        linearDamping: bodyData.linearDamping ?? 0,
        angularDamping: bodyData.angularDamping ?? 0,
        gravityFactor: bodyData.gravityFactor ?? 1,
      },
      shapeData
        ? {
            kind: SHAPE_FROM_IWSDK[shapeData.shape ?? ""] ?? "auto",
            dimensions: shapeData.dimensions ?? [0, 0, 0],
            density: shapeData.density ?? 1,
            restitution: shapeData.restitution ?? 0,
            friction: shapeData.friction ?? 0.5,
          }
        : undefined,
    );
  }
}

export type Side = "left" | "right";

/** The subset of a preact signal the provider uses. */
export class FakeSignal<T> {
  private current: T;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(value: T) {
    this.current = value;
  }

  peek(): T {
    return this.current;
  }

  get value(): T {
    return this.current;
  }

  /** Signals call back once on subscribe, as preact's do. */
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  set(value: T): void {
    this.current = value;
    for (const listener of [...this.listeners]) listener(value);
  }
}

/** The slice of an `XRInputSource` the provider reads: a hand, and the target-ray mode (`"gaze"` marks the eye-gaze source). */
export interface FakeInputSource {
  hand?: unknown;
  targetRayMode?: string;
}

export interface FakeSessionOptions {
  enabledFeatures?: string[];
  inputSources?: FakeInputSource[];
}

export class FakeSession {
  readonly enabledFeatures: string[];
  readonly inputSources: FakeInputSource[];
  readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(options: FakeSessionOptions = {}) {
    this.enabledFeatures = options.enabledFeatures ?? [];
    this.inputSources = options.inputSources ?? [];
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  countListeners(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

export interface FakeActuator {
  pulses: Array<{ intensity: number; durationMs: number }>;
  pulse(intensity: number, durationMs: number): Promise<boolean>;
}

export function fakeActuator(): FakeActuator {
  const pulses: Array<{ intensity: number; durationMs: number }> = [];
  return {
    pulses,
    pulse(intensity: number, durationMs: number) {
      pulses.push({ intensity, durationMs });
      return Promise.resolve(true);
    },
  };
}

export interface FakeGamepadOptions {
  buttons?: Record<string, number>;
  selecting?: boolean;
  actuators?: FakeActuator[];
}

export class FakeGamepad {
  buttons: Record<string, number>;
  selecting: boolean;
  readonly gamepad: { hapticActuators: FakeActuator[] };

  constructor(options: FakeGamepadOptions = {}) {
    this.buttons = options.buttons ?? {};
    this.selecting = options.selecting ?? false;
    this.gamepad = { hapticActuators: options.actuators ?? [] };
  }

  getButtonValue(component: string): number {
    return this.buttons[component] ?? 0;
  }

  getSelecting(): boolean {
    return this.selecting;
  }
}

/** One visual adapter with a model that has descendants to hide. */
export function fakeVisual(): { visual: { model: Object3D }; child: Object3D; grandchild: Object3D } {
  const model = new Object3D();
  const child = new Object3D();
  const grandchild = new Object3D();
  child.add(grandchild);
  model.add(child);
  return { visual: { model }, child, grandchild };
}

export interface FakeVisualAdapters {
  controller: Record<Side, { visual: { model: Object3D } }>;
  hand: Record<Side, { visual: { model: Object3D } }>;
}

export function fakeVisualAdapters(): {
  adapters: FakeVisualAdapters;
  parts: Record<"controller" | "hand", Record<Side, { child: Object3D; grandchild: Object3D }>>;
} {
  const build = () => {
    const left = fakeVisual();
    const right = fakeVisual();
    return {
      adapters: { left: { visual: left.visual }, right: { visual: right.visual } },
      parts: {
        left: { child: left.child, grandchild: left.grandchild },
        right: { child: right.child, grandchild: right.grandchild },
      },
    };
  };
  const controller = build();
  const hand = build();
  return {
    adapters: { controller: controller.adapters, hand: hand.adapters },
    parts: { controller: controller.parts, hand: hand.parts },
  };
}

/** IWSDK's `XROrigin` slice the provider reads for eye gaze: the sampled eye pose and its validity. */
export interface FakeXROrigin {
  eyeSpace: Object3D;
  gazeOrigin: "tracked" | "none";
}

export interface FakeWorldOptions {
  session?: FakeSession | null;
  visibility?: string;
  gamepads?: Partial<Record<Side, FakeGamepad>>;
  visualAdapters?: FakeVisualAdapters | undefined;
  /** Give the rig an `xrOrigin`; `tracked` sets `gazeOrigin`. Absent, the rig has no eye space, as a 0.5.x rig had none. */
  gaze?: { tracked: boolean };
}

export interface FakeWorld {
  session: FakeSession | null;
  visibilityState: FakeSignal<string>;
  playerSpaceEntities: {
    raySpaces: Record<Side, { object3D: Object3D | null }>;
    gripSpaces: Record<Side, { object3D: Object3D | null }>;
    indexTipSpaces: Record<Side, { object3D: Object3D | null }>;
    head: { object3D: Object3D | null };
  };
  input: {
    xr: {
      gamepads: Partial<Record<Side, FakeGamepad>>;
      visualAdapters?: FakeVisualAdapters;
      xrOrigin?: FakeXROrigin;
    };
  };
  registerSystem(system: unknown): void;
  registeredSystems: unknown[];
}

const spacePair = () => ({
  left: { object3D: new Object3D() as Object3D | null },
  right: { object3D: new Object3D() as Object3D | null },
});

/** An eye space at a position, looking down -Z, matrices ready to read. */
function eyeSpaceAt(x: number, y: number, z: number): Object3D {
  const eye = new Object3D();
  eye.position.set(x, y, z);
  eye.updateMatrixWorld(true);
  return eye;
}

export function makeWorld(options: FakeWorldOptions = {}): FakeWorld {
  const registeredSystems: unknown[] = [];
  return {
    session: options.session ?? null,
    visibilityState: new FakeSignal<string>(options.visibility ?? "visible"),
    playerSpaceEntities: {
      raySpaces: spacePair(),
      gripSpaces: spacePair(),
      indexTipSpaces: spacePair(),
      head: { object3D: new Object3D() as Object3D | null },
    },
    input: {
      xr: {
        gamepads: options.gamepads ?? {},
        ...(options.visualAdapters ? { visualAdapters: options.visualAdapters } : {}),
        ...(options.gaze
          ? { xrOrigin: { eyeSpace: eyeSpaceAt(0, 1.6, 0), gazeOrigin: options.gaze.tracked ? "tracked" : "none" } as FakeXROrigin }
          : {}),
      },
    },
    registerSystem(system: unknown) {
      registeredSystems.push(system);
    },
    registeredSystems,
  };
}
