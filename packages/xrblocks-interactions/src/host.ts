/**
 * connectXRBlocksInteractions — EXPERIMENTAL one-call setup.
 *
 * XR Blocks Scripts are ordinary three.js Object3Ds, so the shim reuses
 * the three.js adapter's hit-tester and transform ports; only the input
 * provider is XR Blocks-specific.
 *
 * ```ts
 * import * as xb from 'xrblocks';
 * class MyScript extends xb.Script {
 *   init() {
 *     this.ix = connectXRBlocksInteractions({ input: xb.input, camera: xb.camera });
 *     this.ix.register({ id: "button", behaviours: [{ kind: "press" }] }, buttonMesh);
 *   }
 *   update() { this.ix.update(xb.getDeltaTime()); }
 * }
 * ```
 */
import type { Object3D } from "three";
import {
  InteractionRuntime,
  ThreeHitTester,
  ThreeTransformPort,
  type DwellConfig,
  type InteractableDescriptor,
} from "@realitycollective/threejs-interactions";
import { XRBlocksInputProvider, type XRBlocksContext } from "./provider.js";

export interface XRBlocksInteractionsOptions extends XRBlocksContext {
  dwellDefaults?: DwellConfig;
}

export class XRBlocksInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: XRBlocksInputProvider;
  readonly hitTester: ThreeHitTester;
  private readonly ports = new Map<string, ThreeTransformPort>();

  constructor(options: XRBlocksInteractionsOptions) {
    this.provider = new XRBlocksInputProvider(options);
    this.hitTester = new ThreeHitTester();
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
    });
  }

  register(descriptor: InteractableDescriptor, object: Object3D): ThreeTransformPort {
    const port = new ThreeTransformPort(object);
    this.ports.set(descriptor.id, port);
    this.hitTester.register(descriptor.id, object);
    this.runtime.registerInteractable(descriptor, { transform: port });
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.hitTester.unregister(id);
    this.ports.delete(id);
  }

  getPort(id: string): ThreeTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    this.runtime.update(dt);
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
