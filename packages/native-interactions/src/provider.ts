/**
 * NativeInputProvider - the native host's input provider.
 *
 * It applies the rules `IWSDKInputProvider` applies, over the facts the
 * native app's `input` slice reports, so the host is handed results:
 *
 * - Capabilities are DERIVED here, as `refreshCapabilities` derives them from
 *   the WebXR session: `rays`, `pokes` and grabs from immersion, `handJoints`
 *   and `pinch` from hand tracking or a tracked hand, `buttonsAxes` and
 *   `haptics` from the sources present, `gaze` and `headPose` from a head
 *   pose, `presence` from the host's presence member. They re-derive, and
 *   `onCapabilitiesChanged` fires, whenever the facts or the sources change.
 * - Presence is decided here, as `applyPresence` decides it: the requested
 *   visibility per side, and the modality, with `"auto"` showing hands while
 *   hand joints are live and controllers otherwise. The host is told what to
 *   draw per side.
 * - No sources are sampled while the session lacks focus, as IWSDK samples
 *   none unless its visibility state is `Visible`.
 * - A pulse's intensity is clamped to 0..1 before it reaches the host.
 *
 * Every snapshot, and every tuple inside it, is copied before it leaves this
 * class, so a host that reuses its own sample buffers still meets the
 * ownership rule the shared contract suite checks.
 */
import {
  NO_CAPABILITIES,
  type Handedness,
  type HeadPose,
  type InputCapabilities,
  type InputHitHint,
  type InputProvider,
  type InputSourceSnapshot,
  type PresenceModality,
  type Unsubscribe,
} from "@realitycollective/webxr-input";
import {
  copyPose,
  copySnapshot,
  resolveHostSlice,
  type NativeInputFacts,
  type NativeInputHost,
  type NativePresenceShown,
} from "./native-types.js";

export interface NativeInputProviderOptions {
  /** The `input` slice. Omit to read `globalThis.__rcHost.input`. */
  input?: NativeInputHost;
  /**
   * The native app fulfils grabs with its own physics, so grabs report
   * `"native"` and the runtime never carries the object. Default `false`:
   * `"poseOnly"`, the runtime carries it. The same option as IWSDK's
   * `IWSDKProviderOptions.nativeGrab`.
   */
  nativeGrab?: boolean;
}

type Side = "left" | "right";
const SIDES: readonly Side[] = ["left", "right"];

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class NativeInputProvider implements InputProvider {
  private readonly host: NativeInputHost;
  private readonly nativeGrab: boolean;
  private capabilities: InputCapabilities;
  private facts: NativeInputFacts;
  private readonly capsListeners = new Set<(c: InputCapabilities) => void>();
  private readonly sourceListeners = new Set<() => void>();
  private readonly disposers: Unsubscribe[] = [];
  private readonly presenceVisible: Record<Side, boolean> = { left: true, right: true };
  private presenceModality: PresenceModality = "auto";
  private readonly presenceApplied: Record<Side, NativePresenceShown | null> = { left: null, right: null };

  readonly getHeadPose?: () => HeadPose;
  readonly sampleHints?: () => readonly InputHitHint[];
  readonly pulse?: (sourceId: string, intensity: number, durationMs: number) => boolean;
  readonly setPresenceVisible?: (target: Handedness | "all", visible: boolean) => boolean;
  readonly setPresenceModality?: (mode: PresenceModality) => boolean;

  constructor(options: NativeInputProviderOptions = {}) {
    this.host = resolveHostSlice("input", options.input);
    this.nativeGrab = options.nativeGrab ?? false;
    this.facts = { ...this.host.getFacts() };
    this.capabilities = this.derive();

    const host = this.host;
    if (host.getHeadPose) {
      this.getHeadPose = () => copyPose(host.getHeadPose!());
    }
    if (host.sampleHints) {
      this.sampleHints = () => host.sampleHints!().map((hint) => ({ ...hint }));
    }
    if (host.pulse) {
      this.pulse = (sourceId, intensity, durationMs) =>
        host.pulse!(sourceId, clampUnit(intensity), durationMs);
    }
    if (host.applyPresence) {
      this.setPresenceVisible = (target, visible) => {
        for (const side of SIDES) {
          if (target === "all" || target === side) this.presenceVisible[side] = visible;
        }
        return this.applyPresence();
      };
      this.setPresenceModality = (mode) => {
        this.presenceModality = mode;
        return this.applyPresence();
      };
    }

    this.disposers.push(
      host.onFactsChanged(() => this.refresh()),
      host.onSourcesChanged(() => {
        this.refresh();
        for (const listener of [...this.sourceListeners]) listener();
      }),
    );
    this.applyPresence();
  }

  getCapabilities(): InputCapabilities {
    return this.capabilities;
  }

  onCapabilitiesChanged(listener: (capabilities: InputCapabilities) => void): Unsubscribe {
    this.capsListeners.add(listener);
    return () => this.capsListeners.delete(listener);
  }

  onSourcesChanged(listener: () => void): Unsubscribe {
    this.sourceListeners.add(listener);
    return () => this.sourceListeners.delete(listener);
  }

  sample(): readonly InputSourceSnapshot[] {
    if (!this.facts.focused) return [];
    return this.host.sample().map(copySnapshot);
  }

  /** Release the host subscriptions and every listener. */
  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.capsListeners.clear();
    this.sourceListeners.clear();
  }

  /** Re-read the facts and re-derive; publish and re-apply presence on a change. */
  private refresh(): void {
    this.facts = { ...this.host.getFacts() };
    const next = this.derive();
    if (JSON.stringify(next) !== JSON.stringify(this.capabilities)) {
      this.capabilities = next;
      for (const listener of [...this.capsListeners]) listener(next);
    }
    this.applyPresence();
  }

  /** `IWSDKInputProvider.refreshCapabilities`, over the host's facts and sources. */
  private derive(): InputCapabilities {
    const { immersive, handTracking } = this.facts;
    const sources = immersive ? this.host.sample() : [];
    const handTracked = sources.some((source) => source.kind === "hand");
    const hands = immersive && (handTracking || handTracked);
    const head = typeof this.host.getHeadPose === "function";
    return {
      ...NO_CAPABILITIES,
      rays: immersive,
      // A controller's index tip is its ray origin, so pokes need no hand.
      pokes: immersive,
      grabs: immersive ? (this.nativeGrab ? "native" : "poseOnly") : "none",
      handJoints: hands,
      pinch: hands,
      buttonsAxes: sources.some((source) => source.kind === "controller"),
      gaze: head,
      headPose: head,
      haptics: typeof this.host.pulse === "function" && sources.some((source) => source.hapticsAvailable === true),
      presence: typeof this.host.applyPresence === "function",
    };
  }

  /**
   * `IWSDKInputProvider.applyPresence`: each side shows the family the
   * modality picks, while that side is visible. Only a changed side is sent.
   * Reports whether presence reached a live session, as IWSDK reports false
   * with no session to draw in; the request is kept and applied on entry.
   */
  private applyPresence(): boolean {
    const apply = this.host.applyPresence;
    if (!apply) return false;
    const handJoints = this.capabilities.handJoints;
    const modality = this.presenceModality;
    const hands = modality === "hands" || (modality === "auto" && handJoints);
    const controllers = modality === "controllers" || (modality === "auto" && !handJoints);
    for (const side of SIDES) {
      const wanted = this.presenceVisible[side];
      const shown: NativePresenceShown = { hand: wanted && hands, controller: wanted && controllers };
      const last = this.presenceApplied[side];
      if (last && last.hand === shown.hand && last.controller === shown.controller) continue;
      this.presenceApplied[side] = shown;
      apply.call(this.host, side, { ...shown });
    }
    return this.facts.immersive;
  }
}
