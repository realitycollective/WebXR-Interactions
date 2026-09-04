/**
 * A structural stand-in for an IWSDK `World`.
 *
 * `@iwsdk/core` imports headlessly in node, so the adapter is tested
 * against the real `InputComponent` / `VisibilityState` values and real
 * three.js `Object3D`s - only the world around them is faked. Nothing here
 * mocks a module; the provider is given an object of the right shape.
 */
import { Object3D } from "three";

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

export interface FakeSessionOptions {
  enabledFeatures?: string[];
  inputSources?: Array<{ hand?: unknown }>;
}

export class FakeSession {
  readonly enabledFeatures: string[];
  readonly inputSources: Array<{ hand?: unknown }>;
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

export interface FakeWorldOptions {
  session?: FakeSession | null;
  visibility?: string;
  gamepads?: Partial<Record<Side, FakeGamepad>>;
  visualAdapters?: FakeVisualAdapters | undefined;
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
  input: { xr: { gamepads: Partial<Record<Side, FakeGamepad>>; visualAdapters?: FakeVisualAdapters } };
  registerSystem(system: unknown): void;
  registeredSystems: unknown[];
}

const spacePair = () => ({
  left: { object3D: new Object3D() as Object3D | null },
  right: { object3D: new Object3D() as Object3D | null },
});

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
      },
    },
    registerSystem(system: unknown) {
      registeredSystems.push(system);
    },
    registeredSystems,
  };
}
