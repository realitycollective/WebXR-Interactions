/**
 * createNativeInteractions - one-call setup for the native adapter, with the
 * same shape as the Babylon, three.js, IWSDK and XR Blocks setups.
 *
 * ```ts
 * const interactions = createNativeInteractions({ attachToHost: true });
 * interactions.register({ id: "button", behaviours: [{ kind: "press" }] });
 * interactions.runtime.onEvent((event) => console.log(event.type));
 * ```
 *
 * The native app owns the scene, so an interactable is registered by id
 * alone: the app answers hit queries and pose reads for that id through the
 * `interactions` slice. With `attachToHost` the loop drives itself from the
 * app's own frame callback. Without it, call `update(dt)` yourself with
 * seconds.
 */
import {
  InteractionRuntime,
  type DwellConfig,
  type InteractableDescriptor,
} from "@realitycollective/webxr-interactions";
import { NativeHitTester, type NativeHitTesterOptions } from "./hit-tester.js";
import { NativeInputProvider, type NativeInputProviderOptions } from "./provider.js";
import { NativeTransformPort } from "./transform-port.js";
import { installedHost, type NativeFrameSource } from "./native-types.js";

export interface NativeInteractionsOptions
  extends NativeInputProviderOptions,
    NativeHitTesterOptions {
  dwellDefaults?: DwellConfig;
  /**
   * Drive `update(dt)` from the native app's frame callback. Default false -
   * the app calls `update` from its own loop.
   */
  attachToHost?: boolean;
  /** Where frames come from for `attachToHost`. Omit to use `globalThis.__rcHost`. */
  frames?: NativeFrameSource;
}

/** Longest frame the host-attached loop will report, in seconds. */
const MAX_FRAME_SECONDS = 0.1;

export class NativeInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: NativeInputProvider;
  readonly hitTester: NativeHitTester;
  private readonly ports = new Map<string, NativeTransformPort>();
  private readonly options: NativeInteractionsOptions;
  private detachHost: (() => void) | null = null;

  constructor(options: NativeInteractionsOptions = {}) {
    this.options = options;
    this.provider = new NativeInputProvider(options);
    this.hitTester = new NativeHitTester(options);
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
    });
    if (options.attachToHost) this.attachToHost(options);
  }

  /** Register an interactable. The native app knows it by `descriptor.id`. */
  register(descriptor: InteractableDescriptor): NativeTransformPort {
    const port = new NativeTransformPort(
      descriptor.id,
      this.options.interactions ? { interactions: this.options.interactions } : {},
    );
    this.ports.set(descriptor.id, port);
    this.runtime.registerInteractable(descriptor, { transform: port });
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.ports.delete(id);
  }

  getPort(id: string): NativeTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    this.runtime.update(dt);
  }

  dispose(): void {
    this.detachHost?.();
    this.detachHost = null;
    this.runtime.dispose();
  }

  private attachToHost(options: NativeInteractionsOptions): void {
    const frames = options.frames ?? installedHost();
    if (!frames?.onFrame) {
      throw new Error(
        "@realitycollective/native-interactions: attachToHost needs a frame source, and globalThis.__rcHost.onFrame is not installed. Pass `frames`, or call update(dt) yourself.",
      );
    }
    // The app reports the frame delta in seconds. A long frame is clamped so
    // behaviours integrate over a sane step rather than jumping.
    this.detachHost = frames.onFrame((_timestampMs, deltaS) => {
      this.update(Math.min(MAX_FRAME_SECONDS, Math.max(0, deltaS)));
    });
  }
}

export function createNativeInteractions(
  options: NativeInteractionsOptions = {},
): NativeInteractions {
  return new NativeInteractions(options);
}
