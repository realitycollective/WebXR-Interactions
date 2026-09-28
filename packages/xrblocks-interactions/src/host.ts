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
import type { Object3D } from "three";
import { InteractionRuntime } from "@realitycollective/webxr-interactions";
import { ThreeHitTester, type DwellConfig, type InteractableDescriptor } from "@realitycollective/threejs-interactions";
import { XRBlocksInputProvider, type XRBlocksContext, type XRBlocksProviderOptions } from "./provider.js";
import {
  XRBlocksTransformPort,
  type RapierRigidBodyLike,
  type RapierRigidBodyTypes,
} from "./transform-port.js";

export interface XRBlocksInteractionsOptions extends XRBlocksContext, XRBlocksProviderOptions {
  dwellDefaults?: DwellConfig;
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
  /** The RAPIER rigid body backing `object`, when XR Blocks physics owns it - see `XRBlocksTransformPort`. */
  rigidBody?: RapierRigidBodyLike;
}

/** The slice of XR Blocks' `ObjectGrabEvent` (`onObjectGrabStart`/`onObjectGrabEnd`) the bridge reads. */
export interface XBObjectGrabEventLike {
  readonly source: { readonly handedness: "left" | "right" | "none" };
}

export class XRBlocksInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: XRBlocksInputProvider;
  readonly hitTester: ThreeHitTester;
  private readonly rigidBodyTypes: RapierRigidBodyTypes | undefined;
  private readonly ports = new Map<string, XRBlocksTransformPort>();

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
    });
  }

  register(
    descriptor: InteractableDescriptor,
    object: Object3D,
    options: XRBlocksRegisterOptions = {},
  ): XRBlocksTransformPort {
    const port = new XRBlocksTransformPort(
      object,
      options.rigidBody && this.rigidBodyTypes
        ? { rigidBody: options.rigidBody, rigidBodyTypes: this.rigidBodyTypes }
        : {},
    );
    this.ports.set(descriptor.id, port);
    this.hitTester.register(descriptor.id, object, options.targetRadius);
    this.runtime.registerInteractable(descriptor, { transform: port });
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.hitTester.unregister(id);
    this.ports.delete(id);
  }

  getPort(id: string): XRBlocksTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    this.runtime.update(dt);
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
  }
}

export function connectXRBlocksInteractions(
  options: XRBlocksInteractionsOptions,
): XRBlocksInteractions {
  return new XRBlocksInteractions(options);
}
