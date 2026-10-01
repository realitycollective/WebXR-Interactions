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
  type NearPointerOptions,
  type PhysicsBodySpec,
  type PhysicsShapeSpec,
  type PointerArbiter,
  type PointerDisplay,
  type PointerDisplayConfig,
} from "@realitycollective/webxr-interactions";
import { NativeHitTester, type NativeHitTesterOptions } from "./hit-tester.js";
import { NativePhysicsFacility } from "./physics-facility.js";
import { NativeInputProvider, type NativeInputProviderOptions } from "./provider.js";
import { NativeTransformPort } from "./transform-port.js";
import {
  findHostSlice,
  installedHost,
  resolveHostSlice,
  type NativeFrameSource,
  type NativeInteractionHost,
  type NativePhysicsHost,
} from "./native-types.js";

export interface NativeInteractionsOptions
  extends NativeInputProviderOptions,
    NativeHitTesterOptions {
  dwellDefaults?: DwellConfig;
  /** The near-pointer distances (touch hover, touch press, grab radius). Defaults are IWSDK 1.0.0's. */
  nearPointer?: Partial<NearPointerOptions>;
  /**
   * The pointer arbiter shared with the UI Extensions native host, so one
   * decision per source covers panels and interactables (the runtime's
   * `pointers` option). Omit when the app has no panels.
   */
  pointers?: PointerArbiter;
  /**
   * The app's pointer display settings (the runtime's `pointerDisplay`
   * option): ray never, always or while hitting; cursors on objects and on
   * panels; the ray and cursor look. Defaults are IWSDK 1.0.0's. The host is
   * handed the resolved drawing every frame and the settings on every change.
   */
  pointerDisplay?: PointerDisplay | Partial<PointerDisplayConfig>;
  /**
   * The `physics` slice: the host's default engine (Jolt on Quest and
   * Android, RealityKit on visionOS) behind the core contract, or an app's
   * own `PhysicsFacility` in its place. Omit to read
   * `globalThis.__rcHost.physics`. Without either, `physics` is null and no
   * target can carry a body; the host conformance kit fails such a host.
   */
  physics?: NativePhysicsHost;
  /** Step the physics from `update(dt)`. Default true; false when the host steps its engine itself. */
  stepPhysics?: boolean;
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
  /**
   * Give the target a body in the `physics` slice at its current world pose
   * (core defaults: dynamic, no damping, gravity factor 1). A target whose
   * body the host already holds (`physics.hasBody(id)`) needs neither this
   * nor `shape`: its port is bound to that body as it is.
   */
  body?: PhysicsBodySpec;
  /** The body's collider (default `"auto"`, the host's collider for the object). Implies `body`. */
  shape?: PhysicsShapeSpec;
}

/** The radius a target is hit-tested with when it declares none: IWSDK's `targetRadius ?? 0.1`. */
const DEFAULT_TARGET_RADIUS = 0.1;

/** Longest frame the host-attached loop will report, in seconds. */
const MAX_FRAME_SECONDS = 0.1;

export class NativeInteractions {
  readonly runtime: InteractionRuntime;
  readonly provider: NativeInputProvider;
  readonly hitTester: NativeHitTester;
  /** The platform's physics over the `physics` slice, or null when the host installs none. */
  readonly physics: NativePhysicsFacility | null;
  private readonly stepPhysics: boolean;
  private readonly ports = new Map<string, NativeTransformPort>();
  private readonly ownedBodies = new Set<string>();
  private readonly options: NativeInteractionsOptions;
  private readonly interactionsHost: NativeInteractionHost;
  private detachHost: (() => void) | null = null;
  private readonly unsubscribeVisuals: () => void;
  private readonly unsubscribeDisplay: () => void;

  constructor(options: NativeInteractionsOptions = {}) {
    this.options = options;
    this.interactionsHost = resolveHostSlice("interactions", options.interactions);
    this.provider = new NativeInputProvider(options);
    this.hitTester = new NativeHitTester(options);
    this.runtime = new InteractionRuntime({
      provider: this.provider,
      hitTester: this.hitTester,
      ...(options.dwellDefaults ? { dwellDefaults: options.dwellDefaults } : {}),
      ...(options.nearPointer ? { nearPointer: options.nearPointer } : {}),
      ...(options.pointers ? { pointers: options.pointers } : {}),
      ...(options.pointerDisplay ? { pointerDisplay: options.pointerDisplay } : {}),
    });
    const physicsHost = findHostSlice("physics", options.physics);
    this.physics = physicsHost ? new NativePhysicsFacility({ physics: physicsHost }) : null;
    this.stepPhysics = options.stepPhysics ?? true;
    // The host is handed the ray and cursor DRAWING every frame, per source
    // (`NativeInputHost.applyPointerVisuals`): the arbiter's decision under
    // the app's pointer display settings, fully resolved. It draws exactly that.
    const input = resolveHostSlice("input", options.input);
    this.unsubscribeVisuals = this.runtime.onPointerDrawing((drawings) => {
      if (!input.applyPointerVisuals) return;
      for (const drawing of drawings) {
        const visuals = this.runtime.getPointerVisuals(drawing.sourceId);
        input.applyPointerVisuals(drawing.sourceId, {
          ...drawing,
          rayColor: [drawing.rayColor[0], drawing.rayColor[1], drawing.rayColor[2]],
          activePointer: visuals?.activePointer ?? null,
          targetKind: visuals?.targetKind ?? null,
          targetId: visuals?.targetId ?? null,
          hitDistance: visuals?.hitDistance ?? null,
        });
      }
    });
    const display = this.runtime.getPointerDisplay();
    input.applyPointerDisplay?.({ ...display.get() });
    this.unsubscribeDisplay = display.onChange((config) => input.applyPointerDisplay?.({ ...config }));
    if (options.attachToHost) this.attachToHost(options);
  }

  /**
   * Register an interactable. The native app knows it by `descriptor.id`,
   * and is told the radius to hit-test it with: `options.targetRadius`, or
   * 0.1 m, so a bare target is a 10 cm sphere as on IWSDK.
   */
  register(descriptor: InteractableDescriptor, options: NativeRegisterOptions = {}): NativeTransformPort {
    const id = descriptor.id;
    if (options.body || options.shape) {
      if (!this.physics) {
        throw new Error(
          `@realitycollective/native-interactions: "${id}" asks for a physics body but no physics slice is installed; the host installs globalThis.__rcHost.physics, or pass \`physics\` to createNativeInteractions`,
        );
      }
      this.physics.addBody(id, this.interactionsHost.getWorldPose(id), options.body, options.shape);
      this.ownedBodies.add(id);
    }
    const bound = this.physics && this.physics.hasBody(id) ? this.physics : null;
    const port = new NativeTransformPort(id, {
      ...(this.options.interactions ? { interactions: this.options.interactions } : {}),
      ...(bound ? { physics: { facility: bound, bodyId: id } } : {}),
    });
    this.interactionsHost.setTargetRadius(descriptor.id, options.targetRadius ?? DEFAULT_TARGET_RADIUS);
    this.ports.set(descriptor.id, port);
    this.runtime.registerInteractable(descriptor, { transform: port });
    return port;
  }

  unregister(id: string): void {
    this.runtime.unregisterInteractable(id);
    this.ports.delete(id);
    if (this.ownedBodies.delete(id)) this.physics?.removeBody(id);
  }

  getPort(id: string): NativeTransformPort | undefined {
    return this.ports.get(id);
  }

  update(dt: number): void {
    // The provider's eye-gaze filter and grace integrate over the same step.
    this.provider.setFrameDelta(dt);
    this.runtime.update(dt);
    if (this.stepPhysics) this.physics?.step(dt);
  }

  dispose(): void {
    this.detachHost?.();
    this.detachHost = null;
    this.unsubscribeVisuals();
    this.unsubscribeDisplay();
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
