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
  type PhysicsBodySpec,
  type PhysicsFacility,
  type PhysicsShapeSpec,
  type PointerArbiter,
  type PointerDisplay,
  type PointerDisplayConfig,
} from "@realitycollective/webxr-interactions";
import { nodeWorldPose, type BabylonPhysicsKitLike, type BabylonTransformNodeLike } from "./babylon-types.js";
import {
  BabylonHitTester,
  type BabylonHitTesterOptions,
  type BabylonPickWithRay,
} from "./hit-tester.js";
import { BabylonPointerVisuals, type BabylonPointerVisualsKit } from "./pointer-visuals.js";
import { BabylonPhysicsFacility } from "./physics-facility.js";
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
  /**
   * The pointer arbiter shared with the UI Extensions window host
   * (`connectUIExtensions({ pointers })`), so one decision per source covers
   * panels and interactables, as IWSDK's `MultiPointer` does. Omit when the
   * app has no panels.
   */
  pointers?: PointerArbiter;
  /**
   * The app's pointer display settings: ray never, always or while hitting;
   * cursors on objects and on panels; the ray and cursor look. Defaults are
   * IWSDK 1.0.0's. Change them at run time through
   * `runtime.getPointerDisplay().set(...)`.
   */
  pointerDisplay?: PointerDisplay | Partial<PointerDisplayConfig>;
  /**
   * Draw the ray stub and the cursor disc for every source, IWSDK's look,
   * into `options.scene`, exactly as the core decides them each frame. Pass
   * `{ kit }`, the Babylon constructors the renderer builds its meshes from.
   * Omit to draw nothing (an app that draws its own reads
   * `runtime.onPointerDrawing`).
   */
  pointerVisuals?: { kit: BabylonPointerVisualsKit };
  /**
   * The platform's physics. Havok (Physics V2) is the named default engine
   * for Babylon: pass `{ kit }`, the Havok-era values from
   * `BabylonPhysicsKitLike`, and the binding builds a `BabylonPhysicsFacility`
   * over `options.scene`. Pass any `PhysicsFacility` instead to replace the
   * default engine with your own. Omit it and no node can carry a body:
   * `register` with a `body` or `shape` then throws.
   */
  physics?: PhysicsFacility | { kit: BabylonPhysicsKitLike };
  /**
   * Step the facility from `update(dt)`. Default true. Pass false when the
   * app steps its physics world itself - or lets Babylon's own render loop
   * do it, since Babylon normally steps physics from `scene.render()`.
   */
  stepPhysics?: boolean;
}

export interface BabylonRegisterOptions extends BabylonTransformPortOptions {
  /** Targeting radius for the sphere hit-tester. Default 0.1 m. */
  targetRadius?: number;
  /**
   * Give the node a physics body with these settings (defaults are the
   * core's: dynamic, no damping, gravity factor 1). Needs `physics` on the
   * setup. With a body, the port applies the held-pose rule through it.
   */
  body?: PhysicsBodySpec;
  /** The body's collider (default `"auto"`: the node's own geometry). Implies `body`. */
  shape?: PhysicsShapeSpec;
}

/** Longest frame the scene-attached loop will report, in seconds. */
const MAX_FRAME_SECONDS = 0.1;

export class BabylonInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: BabylonInputProvider;
  readonly hitTester: BabylonHitTester;
  /** The platform's physics, when the setup was given one. */
  readonly physics: PhysicsFacility | null;
  /** The ray and cursor renderer, when the setup was given `pointerVisuals`. */
  readonly pointerVisuals: BabylonPointerVisuals | null;
  private readonly stepPhysics: boolean;
  private readonly ports = new Map<string, BabylonTransformPort>();
  private readonly nodes = new Map<string, BabylonTransformNodeLike>();
  private detachScene: (() => void) | null = null;

  constructor(options: BabylonInteractionsOptions) {
    this.provider = new BabylonInputProvider(options);
    this.hitTester = new BabylonHitTester(options);
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
      ...(options.pointers ? { pointers: options.pointers } : {}),
      ...(options.pointerDisplay ? { pointerDisplay: options.pointerDisplay } : {}),
    });
    this.pointerVisuals = options.pointerVisuals
      ? new BabylonPointerVisuals({ runtime: this.runtime, kit: options.pointerVisuals.kit, scene: options.scene })
      : null;
    this.physics = options.physics
      ? "kit" in options.physics
        ? new BabylonPhysicsFacility(options.scene, options.physics.kit, { nodeFor: (id) => this.nodes.get(id) })
        : options.physics
      : null;
    this.stepPhysics = options.stepPhysics ?? true;
    if (options.attachToScene) this.attachToScene(options);
  }

  /** Supply or replace the app's mesh-accurate pick. */
  setPickWithRay(pick: BabylonPickWithRay | null): void {
    this.hitTester.setPickWithRay(pick);
  }

  /**
   * Register an interactable with its Babylon node. With `body` or `shape`
   * the node gets a physics body in the facility at its current world pose,
   * and its port drives the held-pose rule through it.
   */
  register(
    descriptor: InteractableDescriptor,
    node: BabylonTransformNodeLike,
    options: BabylonRegisterOptions = {},
  ): BabylonTransformPort {
    this.nodes.set(descriptor.id, node);
    let port: BabylonTransformPort;
    if (options.body || options.shape) {
      if (!this.physics) {
        throw new Error(
          `[babylon-interactions] "${descriptor.id}" asks for a physics body but the setup has no physics; pass { kit } (the default engine) or a PhysicsFacility to createBabylonInteractions`,
        );
      }
      node.computeWorldMatrix?.(true);
      this.physics.addBody(descriptor.id, nodeWorldPose(node), options.body, options.shape);
      port = new BabylonTransformPort(node, {
        ...(options.createQuaternion ? { createQuaternion: options.createQuaternion } : {}),
        physics: { facility: this.physics, bodyId: descriptor.id },
      });
    } else {
      port = new BabylonTransformPort(
        node,
        options.createQuaternion ? { createQuaternion: options.createQuaternion } : {},
      );
    }
    this.ports.set(descriptor.id, port);
    this.hitTester.register(descriptor.id, node, options.targetRadius);
    this.runtime.registerInteractable(descriptor, { transform: port });
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.hitTester.unregister(id);
    this.ports.delete(id);
    this.nodes.delete(id);
    this.physics?.removeBody(id);
  }

  getPort(id: string): BabylonTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    // The provider's eye-gaze filter and grace integrate over the same step.
    this.provider.setFrameDelta(dt);
    this.runtime.update(dt);
    if (this.stepPhysics) this.physics?.step(dt);
  }

  dispose(): void {
    this.detachScene?.();
    this.detachScene = null;
    this.pointerVisuals?.dispose();
    this.runtime.dispose();
    this.provider.dispose();
    this.physics?.dispose();
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
