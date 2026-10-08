/**
 * The playground's app service: the one Service Framework service every
 * platform registers.
 *
 * The playground is a Service Framework app. Each platform file builds its
 * engine, its stations and its bindings, then hands the platform's
 * `RuntimeAdapter` and a `frame` closure to this service. The adapter owns or
 * relays the frame tick (three.js and Babylon own the loop, XR Blocks and IWSDK
 * relay their engine's frames), the manager forwards it as `renderTick`, and
 * this service's `render()` runs the closure that ticks the Interactions
 * binding, the UI Extensions panels and the client.
 *
 * This file imports only from `@realitycollective/service-framework`. Engine
 * objects stay in the platform files and reach the service only through the
 * closure, so the class is the same under every engine.
 */
import {
  BaseService,
  createServiceProfile,
  createServiceToken,
  type AdapterCapabilities,
  type LifecycleContext,
  type RuntimeAdapter,
  type ServiceProfile,
  type ServiceRegistration,
} from "@realitycollective/service-framework";

export interface PlaygroundAppConfig {
  /** The platform's runtime adapter: capabilities and, where the host has one, the session. */
  readonly adapter: RuntimeAdapter;
  /** Per-frame work: tick the bindings and draw. `deltaSeconds` is in seconds, unclamped. */
  readonly frame: (deltaSeconds: number, context: LifecycleContext) => void;
  /** Where platform facts go, one line each. */
  readonly report: (line: string) => void;
}

/** Reports the platform's capabilities and session state, and runs the frame closure on every `renderTick`. */
export class PlaygroundAppService extends BaseService<PlaygroundAppConfig> {
  private readonly unsubscribes: (() => void)[] = [];
  private framesSeen = false;

  public override start(): void {
    const { adapter, report } = this.serviceConfig;
    report(`capabilities: ${describeCapabilities(adapter.getCapabilities())}`);
    this.unsubscribes.push(adapter.onCapabilitiesChange((capabilities) => report(`capabilities changed: ${describeCapabilities(capabilities)}`)));
    const session = adapter.session;
    if (session) {
      this.unsubscribes.push(
        session.onStateChange((state) => {
          const mode = session.getMode();
          report(`session: ${state}${mode ? ` (${mode})` : ""}`);
        }),
      );
    } else {
      report("session: this host has no session facet");
    }
  }

  public override render(context: LifecycleContext): void {
    if (!this.framesSeen) {
      this.framesSeen = true;
      this.serviceConfig.report(`frames from ${context.source}`);
    }
    // LifecycleContext.deltaTime is milliseconds; the bindings take seconds.
    this.serviceConfig.frame(context.deltaTime / 1000, context);
  }

  public override destroy(): void {
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
  }
}

export const PLAYGROUND_APP_TOKEN = createServiceToken<PlaygroundAppService>("PlaygroundAppService");

/** The playground's profile: the app service and nothing else. */
export function createPlaygroundProfile(config: PlaygroundAppConfig): ServiceProfile {
  const registration: ServiceRegistration<PlaygroundAppService, PlaygroundAppConfig> = {
    token: PLAYGROUND_APP_TOKEN,
    config,
    useClass: PlaygroundAppService,
  };
  // A profile's registrations are typed for an unknown config, so a class that
  // takes a typed config is widened, as the Service Framework's own examples do.
  return createServiceProfile("interactions-playground", [registration as unknown as ServiceRegistration]);
}

/** The playground's report sink. The client has no log window, so lines go to the console, which the diagnostics log records under `?log=1`. */
export function reportToConsole(line: string): void {
  console.info(`[playground] ${line}`);
}

/** The slice of a `ServiceManager` the page's visibility drives. */
export interface FocusSink {
  emitFocusChange(focused: boolean): void;
  emitPauseChange(context: { readonly paused: boolean }): void;
}

/**
 * Raise focus and pause from the browser tab's visibility. Adapters that own a
 * session raise them from the session while one is live; a desktop page with no
 * session is never gated, so the page raises them itself.
 */
export function followPageVisibility(manager: FocusSink): void {
  document.addEventListener("visibilitychange", () => {
    const focused = document.visibilityState === "visible";
    manager.emitFocusChange(focused);
    manager.emitPauseChange({ paused: !focused });
  });
}

function describeCapabilities(capabilities: AdapterCapabilities): string {
  const flag = (value: boolean) => (value ? "yes" : "no");
  return [
    `immersive ${flag(capabilities.immersive)}`,
    `hand tracking ${flag(capabilities.handTracking)}`,
    `plane detection ${flag(capabilities.planeDetection)}`,
    `passthrough ${flag(capabilities.passthrough)}`,
    `blend mode ${capabilities.environmentBlendMode ?? "none"}`,
  ].join(", ");
}
