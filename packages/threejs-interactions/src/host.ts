/**
 * createThreeInteractions - one-call setup for the standalone adapter.
 *
 * ```ts
 * const interactions = createThreeInteractions({
 *   xr: renderer.xr, camera, domElement: renderer.domElement,
 * });
 * interactions.register({ id: "button", behaviours: [{ kind: "press" }] }, buttonMesh);
 * // in the render loop:
 * interactions.update(dt);
 * ```
 */
import { Quaternion, Vector3, type Object3D } from "three";
import {
  InteractionRuntime,
  type DwellConfig,
  type InteractableDescriptor,
  type NearPointerOptions,
  type PhysicsBodySpec,
  type PhysicsFacility,
  type PhysicsShapeSpec,
  type PointerArbiter,
  type PointerDisplay,
  type PointerDisplayConfig,
} from "@realitycollective/webxr-interactions";
import { ThreeHitTester } from "./hit-tester.js";
import { RapierPhysicsFacility, type AnyRapierModule } from "./physics-facility.js";
import { ThreePointerVisuals } from "./pointer-visuals.js";
import { ThreeTransformPort } from "./transform-port.js";
import { WebXRInputProvider, type WebXRProviderContext } from "./webxr-provider.js";

export interface ThreeInteractionsOptions extends WebXRProviderContext {
  dwellDefaults?: DwellConfig;
  /** The near-pointer distances (touch hover, touch press, grab radius). Defaults are IWSDK 1.0.0's. */
  nearPointer?: Partial<NearPointerOptions>;
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
   * into this scene (or any world-space root), exactly as the core decides
   * them each frame. Omit to draw nothing (an app that draws its own reads
   * `runtime.onPointerDrawing`).
   */
  pointerVisuals?: { scene: Object3D };
  /**
   * The platform's physics. The default engine for three.js is Rapier:
   * pass `{ rapier }`, the initialised `@dimforge/rapier3d-compat` module
   * (`await RAPIER.init()` first), and the binding builds a
   * `RapierPhysicsFacility` over it. Pass any `PhysicsFacility` instead to
   * replace the default engine with your own. Omit it and no object can
   * carry a body: `register` with a `body` or `shape` then throws.
   */
  physics?: PhysicsFacility | { rapier: AnyRapierModule };
  /**
   * Step the facility from `update(dt)`. Default true. Pass false when the
   * app steps its physics world itself.
   */
  stepPhysics?: boolean;
}

/** Per-registration options, as IWSDK's `register` takes them. */
export interface ThreeRegisterOptions {
  /**
   * Give the object a physics body with these settings (defaults are the
   * core's: dynamic, no damping, gravity factor 1). Needs `physics` on the
   * setup. With a body, the port applies the held-pose rule through it.
   */
  body?: PhysicsBodySpec;
  /** The body's collider (default `"auto"`: the object's own bounds). Implies `body`. */
  shape?: PhysicsShapeSpec;
}

const TEMP_V = new Vector3();
const TEMP_Q = new Quaternion();

export class ThreeInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: WebXRInputProvider;
  readonly hitTester: ThreeHitTester;
  /** The platform's physics, when the setup was given one. */
  readonly physics: PhysicsFacility | null;
  private readonly stepPhysics: boolean;
  private readonly ports = new Map<string, ThreeTransformPort>();
  private readonly objects = new Map<string, Object3D>();
  /** The ray and cursor renderer, when the setup asked for one. */
  readonly pointerVisuals: ThreePointerVisuals | null;

  constructor(options: ThreeInteractionsOptions) {
    this.provider = new WebXRInputProvider(options);
    this.hitTester = new ThreeHitTester();
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
      ...(options.nearPointer ? { nearPointer: options.nearPointer } : {}),
      ...(options.pointers ? { pointers: options.pointers } : {}),
      ...(options.pointerDisplay ? { pointerDisplay: options.pointerDisplay } : {}),
    });
    this.pointerVisuals = options.pointerVisuals
      ? new ThreePointerVisuals({ scene: options.pointerVisuals.scene, runtime: this.runtime })
      : null;
    this.physics = options.physics
      ? "rapier" in options.physics
        ? new RapierPhysicsFacility(options.physics.rapier, { objectFor: (id) => this.objects.get(id) })
        : options.physics
      : null;
    this.stepPhysics = options.stepPhysics ?? true;
  }

  /**
   * Register an interactable with its scene object. With `body` or `shape`
   * the object gets a physics body in the facility at its current world
   * pose, and its port drives the held-pose rule through it.
   */
  register(descriptor: InteractableDescriptor, object: Object3D, options: ThreeRegisterOptions = {}): ThreeTransformPort {
    this.objects.set(descriptor.id, object);
    let port: ThreeTransformPort;
    if (options.body || options.shape) {
      if (!this.physics) {
        throw new Error(
          `[threejs-interactions] "${descriptor.id}" asks for a physics body but the setup has no physics; pass { rapier } (the default engine) or a PhysicsFacility to createThreeInteractions`,
        );
      }
      object.updateWorldMatrix(true, false);
      object.getWorldPosition(TEMP_V);
      object.getWorldQuaternion(TEMP_Q);
      this.physics.addBody(
        descriptor.id,
        { position: [TEMP_V.x, TEMP_V.y, TEMP_V.z], quaternion: [TEMP_Q.x, TEMP_Q.y, TEMP_Q.z, TEMP_Q.w] },
        options.body,
        options.shape,
      );
      port = new ThreeTransformPort(object, { physics: { facility: this.physics, bodyId: descriptor.id } });
    } else {
      port = new ThreeTransformPort(object);
    }
    this.ports.set(descriptor.id, port);
    this.hitTester.register(descriptor.id, object);
    this.runtime.registerInteractable(descriptor, { transform: port });
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.hitTester.unregister(id);
    this.ports.delete(id);
    this.objects.delete(id);
    this.physics?.removeBody(id);
  }

  getPort(id: string): ThreeTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    // The provider's eye-gaze filter and grace integrate over the same step.
    this.provider.setFrameDelta(dt);
    this.runtime.update(dt);
    if (this.stepPhysics) this.physics?.step(dt);
  }

  dispose(): void {
    this.pointerVisuals?.dispose();
    this.runtime.dispose();
    this.provider.dispose();
    this.physics?.dispose();
  }
}

export function createThreeInteractions(options: ThreeInteractionsOptions): ThreeInteractions {
  return new ThreeInteractions(options);
}
