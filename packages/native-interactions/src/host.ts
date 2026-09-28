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
import {
  installedHost,
  resolveHostSlice,
  type NativeFrameSource,
  type NativeInteractionHost,
} from "./native-types.js";

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

/** Per-registration options, as IWSDK's `register` takes them. */
export interface NativeRegisterOptions {
  /**
   * The radius, in metres, the host hit-tests this target with. Default
   * 0.1, the radius IWSDK gives a target that declares none.
   */
  targetRadius?: number;
}

/** The radius a target is hit-tested with when it declares none: IWSDK's `targetRadius ?? 0.1`. */
const DEFAULT_TARGET_RADIUS = 0.1;

/** Longest frame the host-attached loop will report, in seconds. */
const MAX_FRAME_SECONDS = 0.1;

export class NativeInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: NativeInputProvider;
  readonly hitTester: NativeHitTester;
  private readonly ports = new Map<string, NativeTransformPort>();
  private readonly options: NativeInteractionsOptions;
  private readonly interactionsHost: NativeInteractionHost;
  private detachHost: (() => void) | null = null;

  constructor(options: NativeInteractionsOptions = {}) {
    this.options = options;
    this.interactionsHost = resolveHostSlice("interactions", options.interactions);
    this.provider = new NativeInputProvider(options);
    this.hitTester = new NativeHitTester(options);
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
    });
    if (options.attachToHost) this.attachToHost(options);
  }

  /**
   * Register an interactable. The native app knows it by `descriptor.id`,
   * and is told the radius to hit-test it with: `options.targetRadius`, or
   * 0.1 m, so a bare target is a 10 cm sphere as on IWSDK.
   */
  register(descriptor: InteractableDescriptor, options: NativeRegisterOptions = {}): NativeTransformPort {
    const port = new NativeTransformPort(
      descriptor.id,
      this.options.interactions ? { interactions: this.options.interactions } : {},
    );
    this.interactionsHost.setTargetRadius(descriptor.id, options.targetRadius ?? DEFAULT_TARGET_RADIUS);
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
    this.provider.dispose();
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
