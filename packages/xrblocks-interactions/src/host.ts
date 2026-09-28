/**
 * connectXRBlocksInteractions - EXPERIMENTAL one-call setup.
 *
 * XR Blocks Scripts are ordinary three.js Object3Ds, so the shim reuses
 * the three.js adapter's hit-tester; the transform port is XR Blocks'
 * own `XRBlocksTransformPort`, which behaves exactly like the three.js one
 * except over a target whose object carries a RAPIER rigid body,
 * and only the input provider is otherwise XR Blocks-specific.
 *
 * ```ts
 * import * as xb from 'xrblocks';
 * class MyScript extends xb.Script {
 *   init() {
 *     // Pass `xr` so sampling pauses while the session is hidden and grips are
 *     // real, as on IWSDK. Omit it only on a desktop page with no XR session.
 *     this.ix = connectXRBlocksInteractions({ input: xb.input, camera: xb.camera, xr: xb.core.renderer.xr });
 *     this.ix.register({ id: "button", behaviours: [{ kind: "press" }] }, buttonMesh);
 *   }
 *   update() { this.ix.update(xb.getDeltaTime()); }
 *   // Only when ManipulationManager owns a grab on a registered object - see
 *   // `onObjectGrabStart`/`onObjectGrabEnd`'s own comments.
 *   onObjectGrabStart(event) { this.ix.onObjectGrabStart(event); }
 *   onObjectGrabEnd(event) { this.ix.onObjectGrabEnd(event); }
 * }
 * ```
 */
import { Quaternion, Vector3, type Object3D } from "three";
import {
  InteractionRuntime,
  type NearPointerOptions,
  type PhysicsBodySpec,
  type PhysicsFacility,
  type PhysicsShapeSpec,
} from "@realitycollective/webxr-interactions";
import {
  RapierPhysicsFacility,
  ThreeHitTester,
  type DwellConfig,
  type InteractableDescriptor,
  type AnyRapierModule,
} from "@realitycollective/threejs-interactions";
import { XRBlocksInputProvider, type XRBlocksContext, type XRBlocksProviderOptions } from "./provider.js";
import {
  XRBlocksTransformPort,
  type RapierRigidBodyLike,
  type RapierRigidBodyTypes,
} from "./transform-port.js";

export interface XRBlocksInteractionsOptions extends XRBlocksContext, XRBlocksProviderOptions {
  dwellDefaults?: DwellConfig;
  /** The near-pointer distances (touch hover, touch press, grab radius). Defaults are IWSDK 1.0.0's. */
  nearPointer?: Partial<NearPointerOptions>;
  /**
   * The platform's physics. The default engine for XR Blocks is the Rapier
   * it bundles: pass `{ rapier }`, the initialised module (XR Blocks
   * exposes it once `xb.physics` is up), and the binding builds a
   * `RapierPhysicsFacility` over it. Pass any `PhysicsFacility` instead to
   * replace the default engine. Omit it and no object can carry a body
   * through `register`'s `body`/`shape`.
   */
  physics?: PhysicsFacility | { rapier: AnyRapierModule };
  /** Step the facility from `update(dt)`. Default true; false when XR Blocks steps its world itself. */
  stepPhysics?: boolean;
  /**
   * The two RAPIER `RigidBodyType` values a held object's body is switched
   * between - see `RapierRigidBodyTypes`'s own comment. Omit it, or omit
   * `rigidBody` on a given `register()` call, and that object's port
   * behaves exactly like the three.js one.
   */
  rigidBodyTypes?: RapierRigidBodyTypes;
}

export interface XRBlocksRegisterOptions {
  /** Targeting radius for the approximate hit-tester (default 0.1 m - see `ThreeHitTester.register`). */
  targetRadius?: number;
  /** The RAPIER rigid body backing `object`, when the app drives XR Blocks physics itself - see `XRBlocksTransformPort`. */
  rigidBody?: RapierRigidBodyLike;
  /** Give the object a body in the setup's physics facility (core defaults). Needs `physics` on the setup. */
  body?: PhysicsBodySpec;
  /** The body's collider (default `"auto"`, the object's own bounds). Implies `body`. */
  shape?: PhysicsShapeSpec;
}

const TEMP_V = new Vector3();
const TEMP_Q = new Quaternion();

/** The slice of XR Blocks' `ObjectGrabEvent` (`onObjectGrabStart`/`onObjectGrabEnd`) the bridge reads. */
export interface XBObjectGrabEventLike {
  readonly source: { readonly handedness: "left" | "right" | "none" };
}

export class XRBlocksInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: XRBlocksInputProvider;
  readonly hitTester: ThreeHitTester;
  /** The platform's physics, when the setup was given one. */
  readonly physics: PhysicsFacility | null;
  private readonly stepPhysics: boolean;
  private readonly rigidBodyTypes: RapierRigidBodyTypes | undefined;
  private readonly ports = new Map<string, XRBlocksTransformPort>();
  private readonly objects = new Map<string, Object3D>();

  constructor(options: XRBlocksInteractionsOptions) {
    this.provider = new XRBlocksInputProvider(
      options,
      options.nativeGrab !== undefined ? { nativeGrab: options.nativeGrab } : {},
    );
    this.hitTester = new ThreeHitTester();
    this.rigidBodyTypes = options.rigidBodyTypes;
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
      ...(options.nearPointer ? { nearPointer: options.nearPointer } : {}),
    });
    this.physics = options.physics
      ? "rapier" in options.physics
        ? new RapierPhysicsFacility(options.physics.rapier, { objectFor: (id) => this.objects.get(id) })
        : options.physics
      : null;
    this.stepPhysics = options.stepPhysics ?? true;
  }

  register(
    descriptor: InteractableDescriptor,
    object: Object3D,
    options: XRBlocksRegisterOptions = {},
  ): XRBlocksTransformPort {
    this.objects.set(descriptor.id, object);
    let port: XRBlocksTransformPort;
    if (options.body || options.shape) {
      if (!this.physics) {
        throw new Error(
          `[xrblocks-interactions] "${descriptor.id}" asks for a physics body but the setup has no physics; pass { rapier } (the default engine) or a PhysicsFacility to connectXRBlocksInteractions`,
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
      port = new XRBlocksTransformPort(object, { physics: { facility: this.physics, bodyId: descriptor.id } });
    } else {
      port = new XRBlocksTransformPort(
        object,
        options.rigidBody && this.rigidBodyTypes
          ? { rigidBody: options.rigidBody, rigidBodyTypes: this.rigidBodyTypes }
          : {},
      );
    }
    this.ports.set(descriptor.id, port);
    this.hitTester.register(descriptor.id, object, options.targetRadius);
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

  getPort(id: string): XRBlocksTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    this.runtime.update(dt);
    if (this.stepPhysics) this.physics?.step(dt);
  }

  /**
   * Forward XR Blocks' `onObjectGrabStart` Script hook - raised when its own
   * `ManipulationManager` starts a grab on a registered object - into a native-grabbing hint for the side that grabbed, the
   * same hint `IWSDKInputProvider` raises for its own native grab. Call
   * this from the registered object's own `onObjectGrabStart`, the same way
   * the class doc already has the app forward `update()`.
   */
  onObjectGrabStart(event: XBObjectGrabEventLike): void {
    if (event.source.handedness === "none") return;
    this.provider.setNativeGrabbing(event.source.handedness, true);
  }

  /** The `onObjectGrabEnd` twin of {@link onObjectGrabStart}. */
  onObjectGrabEnd(event: XBObjectGrabEventLike): void {
    if (event.source.handedness === "none") return;
    this.provider.setNativeGrabbing(event.source.handedness, false);
  }

  dispose(): void {
    this.runtime.dispose();
    this.physics?.dispose();
  }
}

export function connectXRBlocksInteractions(
  options: XRBlocksInteractionsOptions,
): XRBlocksInteractions {
  return new XRBlocksInteractions(options);
}
