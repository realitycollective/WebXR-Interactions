/**
 * createBabylonInteractions - one-call setup for the Babylon adapter.
 *
 * ```ts
 * const interactions = createBabylonInteractions({ scene, xr, attachToScene: true });
 * interactions.register({ id: "button", behaviours: [{ kind: "press" }] }, buttonMesh);
 * interactions.runtime.onEvent((event) => console.log(event.type));
 * ```
 *
 * With `attachToScene` the render loop drives itself from
 * `scene.onBeforeRenderObservable` and the engine's own frame delta.
 * Without it, call `update(dt)` yourself with seconds.
 */
import {
  InteractionRuntime,
  type DwellConfig,
  type InteractableDescriptor,
} from "@realitycollective/webxr-interactions";
import type { BabylonTransformNodeLike } from "./babylon-types.js";
import {
  BabylonHitTester,
  type BabylonHitTesterOptions,
  type BabylonPickWithRay,
} from "./hit-tester.js";
import { BabylonTransformPort, type BabylonTransformPortOptions } from "./transform-port.js";
import { BabylonInputProvider, type BabylonProviderOptions } from "./provider.js";

export interface BabylonInteractionsOptions
  extends BabylonProviderOptions,
    BabylonHitTesterOptions {
  dwellDefaults?: DwellConfig;
  /**
   * Drive `update(dt)` from `scene.onBeforeRenderObservable`, using the
   * engine's frame delta in seconds. Default false - the app calls
   * `update` from its own loop.
   */
  attachToScene?: boolean;
}

export interface BabylonRegisterOptions extends BabylonTransformPortOptions {
  /** Targeting radius for the sphere hit-tester. Default 0.1 m. */
  targetRadius?: number;
}

/** Longest frame the scene-attached loop will report, in seconds. */
const MAX_FRAME_SECONDS = 0.1;

export class BabylonInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: BabylonInputProvider;
  readonly hitTester: BabylonHitTester;
  private readonly ports = new Map<string, BabylonTransformPort>();
  private detachScene: (() => void) | null = null;

  constructor(options: BabylonInteractionsOptions) {
    this.provider = new BabylonInputProvider(options);
    this.hitTester = new BabylonHitTester(options);
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
    });
    if (options.attachToScene) this.attachToScene(options);
  }

  /** Supply or replace the app's mesh-accurate pick. */
  setPickWithRay(pick: BabylonPickWithRay | null): void {
    this.hitTester.setPickWithRay(pick);
  }

  /** Register an interactable with its Babylon node. */
  register(
    descriptor: InteractableDescriptor,
    node: BabylonTransformNodeLike,
    options: BabylonRegisterOptions = {},
  ): BabylonTransformPort {
    const port = new BabylonTransformPort(
      node,
      options.createQuaternion ? { createQuaternion: options.createQuaternion } : {},
    );
    this.ports.set(descriptor.id, port);
    this.hitTester.register(descriptor.id, node, options.targetRadius);
    this.runtime.registerInteractable(descriptor, { transform: port });
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.hitTester.unregister(id);
    this.ports.delete(id);
  }

  getPort(id: string): BabylonTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    this.runtime.update(dt);
  }

  dispose(): void {
    this.detachScene?.();
    this.detachScene = null;
    this.runtime.dispose();
    this.provider.dispose();
  }

  private attachToScene(options: BabylonInteractionsOptions): void {
    const observable = options.scene.onBeforeRenderObservable;
    if (!observable) return;
    const engine = options.scene.getEngine?.();
    const observer = observable.add(() => {
      // Babylon reports the frame delta in milliseconds. A long frame - a tab
      // that was backgrounded, a slow first frame - is clamped so behaviours
      // integrate over a sane step rather than jumping.
      const ms = engine?.getDeltaTime() ?? 0;
      this.update(Math.min(MAX_FRAME_SECONDS, Math.max(0, ms / 1000)));
    });
    this.detachScene = () => {
      observable.remove(observer);
    };
  }
}

export function createBabylonInteractions(
  options: BabylonInteractionsOptions,
): BabylonInteractions {
  return new BabylonInteractions(options);
}
