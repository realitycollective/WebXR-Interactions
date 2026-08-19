/**
 * createThreeInteractions — one-call setup for the standalone adapter.
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
import type { Object3D } from "three";
import {
  InteractionRuntime,
  type DwellConfig,
  type InteractableDescriptor,
} from "@realitycollective/webxr-interactions";
import { ThreeHitTester } from "./hit-tester.js";
import { ThreeTransformPort } from "./transform-port.js";
import { WebXRInputProvider, type WebXRProviderContext } from "./webxr-provider.js";

export interface ThreeInteractionsOptions extends WebXRProviderContext {
  dwellDefaults?: DwellConfig;
}

export class ThreeInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: WebXRInputProvider;
  readonly hitTester: ThreeHitTester;
  private readonly ports = new Map<string, ThreeTransformPort>();

  constructor(options: ThreeInteractionsOptions) {
    this.provider = new WebXRInputProvider(options);
    this.hitTester = new ThreeHitTester();
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
    });
  }

  /** Register an interactable with its scene object. */
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
    this.provider.dispose();
  }
}

export function createThreeInteractions(options: ThreeInteractionsOptions): ThreeInteractions {
  return new ThreeInteractions(options);
}
