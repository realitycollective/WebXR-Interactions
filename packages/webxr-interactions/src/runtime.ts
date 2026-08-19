/**
 * InteractionRuntime - the engine-free orchestrator.
 *
 * Once per host frame the runtime pulls the input provider, resolves
 * targeting (provider hints first - provider power wins - then poke
 * proximity, then ray hits), applies press/grab transitions with
 * hysteresis, runs gaze gating + dwell, ticks every behaviour, and emits
 * interaction events and feedback intents. It never touches an engine:
 * space queries and transform writes go through the adapter-implemented
 * {@link HitTester} and {@link TransformPort}.
 *
 * Lifecycle is first-class (the pale-signal gap): interactables register,
 * unregister, enable and disable; behaviours disabled by capability
 * negotiation announce themselves with a `behaviourDisabled` event.
 */
import {
  SELECT_PRESS_THRESHOLD,
  SELECT_RELEASE_THRESHOLD,
  unmetRequirements,
  type InputCapabilities,
  type InputHitHint,
  type InputProvider,
  type InputSourceSnapshot,
  type PoseTuple,
  type RayTuple,
  type Unsubscribe,
} from "@realitycollective/webxr-input";
import type { Behaviour, InteractorInfo } from "./behaviours/behaviour.js";
import {
  createBehaviour,
  type BehaviourConfig,
  type BehaviourFactoryContext,
} from "./behaviours/factory.js";
import { GrabBehaviour } from "./behaviours/grab.js";
import type { InteractableDescriptor } from "./descriptor.js";
import { Emitter, type InteractionEvent, type InteractionEventListener } from "./events.js";
import type { FeedbackIntent, FeedbackListener } from "./feedback.js";
import { DwellState, resolveDwellConfig, DWELL_DEFAULTS, type DwellConfig } from "./gaze.js";
import { vApplyQuat } from "./math.js";
import type { HitTester, TransformPort } from "./ports.js";

const DEFAULT_POKE_RADIUS = 0.05;
/** Interactor id used when gaze is synthesized from the head pose. */
export const HEAD_GAZE_INTERACTOR_ID = "head-gaze";

export interface InteractableState {
  id: string;
  enabled: boolean;
  hovered: boolean;
  gazeHovered: boolean;
  pressed: boolean;
  grabbed: boolean;
  /** Primary behaviour's logical value. */
  value: number;
  /** Gaze-dwell meter 0..1 (0 when dwell is not enabled). */
  dwell: number;
}

interface BehaviourSlot {
  instance: Behaviour;
  config: BehaviourConfig;
  disabled: boolean;
  disabledReason: string;
}

interface Registered {
  def: InteractableDescriptor;
  behaviours: BehaviourSlot[];
  transform: TransformPort | undefined;
  enabled: boolean;
  pokeRadius: number;
  gazeRequired: boolean;
  dwellConfig: Required<DwellConfig> | null;
  dwell: DwellState;
  gazeHovered: boolean;
  hoveredBy: Set<string>;
  pressedBy: Set<string>;
  grabbedBy: string | null;
}

interface SourceRuntimeState {
  hoverTarget: string | null;
  pressed: boolean;
  pressTarget: string | null;
  grabbed: boolean;
  grabTarget: string | null;
}

export interface InteractionRuntimeOptions {
  provider: InputProvider;
  hitTester?: HitTester;
  dwellDefaults?: DwellConfig;
}

export interface RegisterPorts {
  transform?: TransformPort;
}

export class InteractionRuntime {
  private readonly provider: InputProvider;
  private hitTester: HitTester | null;
  private readonly dwellDefaults: Required<DwellConfig>;

  private readonly interactables = new Map<string, Registered>();
  private readonly sourceStates = new Map<string, SourceRuntimeState>();
  private readonly events = new Emitter<InteractionEvent>();
  private readonly feedbackEmitter = new Emitter<FeedbackIntent>();
  private readonly afterSample = new Emitter<readonly InputSourceSnapshot[]>();
  private capabilities: InputCapabilities;
  private readonly unsubscribeCaps: Unsubscribe;
  private disposed = false;

  constructor(options: InteractionRuntimeOptions) {
    this.provider = options.provider;
    this.hitTester = options.hitTester ?? null;
    const d = options.dwellDefaults;
    this.dwellDefaults = {
      holdSeconds: d?.holdSeconds ?? DWELL_DEFAULTS.holdSeconds,
      decayFactor: d?.decayFactor ?? DWELL_DEFAULTS.decayFactor,
      rearmBelow: d?.rearmBelow ?? DWELL_DEFAULTS.rearmBelow,
    };
    this.capabilities = this.provider.getCapabilities();
    this.unsubscribeCaps = this.provider.onCapabilitiesChanged((caps) => {
      this.capabilities = caps;
      this.renegotiateAll();
    });
  }

  // -- registry -------------------------------------------------------------

  registerInteractable(def: InteractableDescriptor, ports: RegisterPorts = {}): void {
    if (this.interactables.has(def.id)) {
      throw new Error(`Interactable "${def.id}" is already registered`);
    }
    const context: BehaviourFactoryContext = {
      grabFulfilment: this.capabilities.grabs === "native" ? "native" : "poseOnly",
    };
    const registered: Registered = {
      def,
      behaviours: def.behaviours.map((config) => ({
        instance: createBehaviour(config, context),
        config,
        disabled: false,
        disabledReason: "",
      })),
      transform: ports.transform,
      enabled: def.enabled !== false,
      pokeRadius: def.pokeRadius ?? DEFAULT_POKE_RADIUS,
      gazeRequired: def.gaze?.required === true,
      dwellConfig: resolveDwellConfig(def.gaze?.dwell, this.dwellDefaults),
      dwell: new DwellState(),
      gazeHovered: false,
      hoveredBy: new Set(),
      pressedBy: new Set(),
      grabbedBy: null,
    };
    this.interactables.set(def.id, registered);
    this.renegotiate(def.id, registered);
  }

  unregisterInteractable(id: string): void {
    const registered = this.interactables.get(id);
    if (!registered) return;
    this.releaseAllHolds(id);
    this.interactables.delete(id);
  }

  setInteractableEnabled(id: string, enabled: boolean): void {
    const registered = this.interactables.get(id);
    if (!registered || registered.enabled === enabled) return;
    registered.enabled = enabled;
    if (!enabled) this.releaseAllHolds(id);
    this.events.emit({
      type: enabled ? "interactableEnabled" : "interactableDisabled",
      interactableId: id,
    });
  }

  setHitTester(hitTester: HitTester | null): void {
    this.hitTester = hitTester;
  }

  /** Reach a live behaviour instance for tuning (playground steppers). */
  getBehaviour<T extends Behaviour = Behaviour>(interactableId: string, kind: string): T | undefined {
    const registered = this.interactables.get(interactableId);
    return registered?.behaviours.find((b) => b.instance.kind === kind)?.instance as T | undefined;
  }

  getState(id: string): InteractableState | undefined {
    const r = this.interactables.get(id);
    if (!r) return undefined;
    const primary = r.behaviours.find((b) => !b.disabled)?.instance;
    return {
      id,
      enabled: r.enabled,
      hovered: r.hoveredBy.size > 0 || r.gazeHovered,
      gazeHovered: r.gazeHovered,
      pressed: r.pressedBy.size > 0,
      grabbed: r.grabbedBy !== null,
      value: primary?.getValue() ?? 0,
      dwell: r.dwell.getProgress(),
    };
  }

  getInteractableIds(): string[] {
    return [...this.interactables.keys()];
  }

  // -- subscriptions ----------------------------------------------------------

  onEvent(listener: InteractionEventListener): Unsubscribe {
    return this.events.subscribe(listener);
  }

  onFeedback(listener: FeedbackListener): Unsubscribe {
    return this.feedbackEmitter.subscribe(listener);
  }

  /** Sampled sources for this frame - the UI Extensions pointer bridge hook. */
  onSourcesSampled(listener: (sources: readonly InputSourceSnapshot[]) => void): Unsubscribe {
    return this.afterSample.subscribe(listener);
  }

  getCapabilities(): InputCapabilities {
    return this.capabilities;
  }

  getProvider(): InputProvider {
    return this.provider;
  }

  // -- frame ------------------------------------------------------------------

  update(dt: number): void {
    if (this.disposed) return;
    const sources = this.provider.sample();
    const hints = this.provider.sampleHints?.() ?? [];
    this.afterSample.emit(sources);

    const hintBySource = new Map<string, InputHitHint[]>();
    for (const hint of hints) {
      const list = hintBySource.get(hint.sourceId);
      if (list) list.push(hint);
      else hintBySource.set(hint.sourceId, [hint]);
    }

    const seen = new Set<string>();
    for (const source of sources) {
      seen.add(source.id);
      this.updateSource(source, hintBySource.get(source.id) ?? []);
    }
    // Sources that vanished mid-hold release everything they held.
    for (const [id, state] of this.sourceStates) {
      if (!seen.has(id)) {
        this.forceRelease(id, state);
        this.sourceStates.delete(id);
      }
    }

    this.updateGaze(sources, dt);
    this.tickBehaviours(sources, dt);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeCaps();
    this.interactables.clear();
    this.sourceStates.clear();
  }

  // -- internals ---------------------------------------------------------------

  private sourceState(id: string): SourceRuntimeState {
    let state = this.sourceStates.get(id);
    if (!state) {
      state = { hoverTarget: null, pressed: false, pressTarget: null, grabbed: false, grabTarget: null };
      this.sourceStates.set(id, state);
    }
    return state;
  }

  private interactorInfo(source: InputSourceSnapshot): InteractorInfo {
    const info: InteractorInfo = {
      id: source.id,
      kind: source.kind,
      select: source.select,
      squeeze: source.squeeze,
    };
    if (source.ray) info.ray = source.ray;
    if (source.gripPose) info.gripPose = source.gripPose;
    if (source.indexTip) info.indexTip = source.indexTip;
    return info;
  }

  /** Resolve this source's target: hints beat poke beats ray. */
  private resolveTarget(source: InputSourceSnapshot, hints: InputHitHint[]): string | null {
    const hint =
      hints.find((h) => h.state === "grab") ??
      hints.find((h) => h.state === "press") ??
      hints.find((h) => h.state === "hover");
    if (hint && this.targetable(hint.targetId)) return hint.targetId;
    if (source.indexTip && this.hitTester) {
      const poke = this.hitTester.hitProximity(source.indexTip, DEFAULT_POKE_RADIUS);
      if (poke && this.targetable(poke.interactableId)) return poke.interactableId;
    }
    if (source.ray && this.hitTester) {
      const hit = this.hitTester.hitRay(source.ray);
      if (hit && this.targetable(hit.interactableId)) return hit.interactableId;
    }
    return null;
  }

  private targetable(id: string): boolean {
    const registered = this.interactables.get(id);
    return registered !== undefined && registered.enabled;
  }

  private flags(registered: Registered): { pressable: boolean; grabbable: boolean } {
    let pressable = false;
    let grabbable = false;
    for (const slot of registered.behaviours) {
      if (slot.disabled) continue;
      if (slot.instance.onPressStart) pressable = true;
      if (slot.instance.grabbable) grabbable = true;
    }
    return { pressable, grabbable };
  }

  private updateSource(source: InputSourceSnapshot, hints: InputHitHint[]): void {
    const state = this.sourceState(source.id);
    const target = this.resolveTarget(source, hints);

    // Hover transitions.
    if (state.hoverTarget !== target) {
      if (state.hoverTarget) this.setHover(state.hoverTarget, source.id, false);
      if (target) this.setHover(target, source.id, true);
      state.hoverTarget = target;
    }

    const registered = target ? this.interactables.get(target) : undefined;
    const roles = registered ? this.flags(registered) : { pressable: false, grabbable: false };

    // Signal resolution. A pinching hand (or a 2D pointer click) acts as a
    // grab when the target is grab-only; controllers keep trigger=press,
    // squeeze=grab.
    const selectAsGrab = roles.grabbable && !roles.pressable && source.kind !== "controller";
    const pressSignal = selectAsGrab ? 0 : source.select;
    const grabSignal = Math.max(source.squeeze, selectAsGrab ? source.select : 0);

    const hintPress = hints.some((h) => h.state === "press");
    const hintGrab = hints.some((h) => h.state === "grab") || source.nativeGrabbing === true;

    // Press with hysteresis (hints override).
    const pressActive = hintPress || (state.pressed
      ? pressSignal > SELECT_RELEASE_THRESHOLD
      : pressSignal >= SELECT_PRESS_THRESHOLD);
    if (pressActive && !state.pressed) {
      state.pressed = true;
      if (target && registered && roles.pressable && this.gazeAllows(registered)) {
        state.pressTarget = target;
        this.routePressStart(target, registered, this.interactorInfo(source));
      }
    } else if (!pressActive && state.pressed) {
      state.pressed = false;
      if (state.pressTarget) {
        this.routePressEnd(state.pressTarget, source.id, this.interactorInfo(source));
        state.pressTarget = null;
      }
    }

    // Grab with hysteresis (hints / native grabbing override).
    const grabActive = hintGrab || (state.grabbed
      ? grabSignal > SELECT_RELEASE_THRESHOLD
      : grabSignal >= SELECT_PRESS_THRESHOLD);
    if (grabActive && !state.grabbed) {
      state.grabbed = true;
      const hintTargetId = hints.find((h) => h.state === "grab")?.targetId;
      const grabTargetId = hintTargetId && this.targetable(hintTargetId) ? hintTargetId : target;
      const grabTarget = grabTargetId ? this.interactables.get(grabTargetId) : undefined;
      if (
        grabTargetId &&
        grabTarget &&
        this.flags(grabTarget).grabbable &&
        grabTarget.grabbedBy === null &&
        this.gazeAllows(grabTarget)
      ) {
        state.grabTarget = grabTargetId;
        grabTarget.grabbedBy = source.id;
        const info = this.interactorInfo(source);
        for (const slot of grabTarget.behaviours) {
          if (!slot.disabled && slot.instance.grabbable) {
            slot.instance.onGrabStart?.(this.contextFor(grabTargetId, grabTarget, 0), info);
          }
        }
      }
    } else if (!grabActive && state.grabbed) {
      state.grabbed = false;
      if (state.grabTarget) {
        this.endGrab(state.grabTarget, source.id, this.interactorInfo(source));
        state.grabTarget = null;
      }
    }
  }

  private gazeAllows(registered: Registered): boolean {
    return !registered.gazeRequired || registered.gazeHovered;
  }

  private setHover(id: string, sourceId: string, hovered: boolean): void {
    const registered = this.interactables.get(id);
    if (!registered) return;
    if (hovered) {
      registered.hoveredBy.add(sourceId);
      if (registered.hoveredBy.size === 1) {
        this.events.emit({ type: "hoverEnter", interactableId: id, interactorId: sourceId });
        this.feedbackEmitter.emit({
          cue: "hover",
          interactableId: id,
          sourceId,
          intensity: 0.1,
          durationMs: 10,
        });
      }
    } else {
      registered.hoveredBy.delete(sourceId);
      if (registered.hoveredBy.size === 0) {
        this.events.emit({ type: "hoverExit", interactableId: id, interactorId: sourceId });
      }
    }
  }

  private routePressStart(id: string, registered: Registered, info: InteractorInfo): void {
    registered.pressedBy.add(info.id);
    this.events.emit({ type: "pressStart", interactableId: id, interactorId: info.id });
    const ctx = this.contextFor(id, registered, 0);
    for (const slot of registered.behaviours) {
      if (!slot.disabled) slot.instance.onPressStart?.(ctx, info);
    }
  }

  private routePressEnd(id: string, sourceId: string, info: InteractorInfo): void {
    const registered = this.interactables.get(id);
    if (!registered) return;
    registered.pressedBy.delete(sourceId);
    this.events.emit({ type: "pressEnd", interactableId: id, interactorId: sourceId });
    const ctx = this.contextFor(id, registered, 0);
    for (const slot of registered.behaviours) {
      if (!slot.disabled) slot.instance.onPressEnd?.(ctx, info);
    }
  }

  private endGrab(id: string, sourceId: string, info: InteractorInfo): void {
    const registered = this.interactables.get(id);
    if (!registered || registered.grabbedBy !== sourceId) return;
    registered.grabbedBy = null;
    const ctx = this.contextFor(id, registered, 0);
    for (const slot of registered.behaviours) {
      if (!slot.disabled && slot.instance.grabbable) slot.instance.onGrabEnd?.(ctx, info);
    }
  }

  private forceRelease(sourceId: string, state: SourceRuntimeState): void {
    const info: InteractorInfo = { id: sourceId, kind: "other", select: 0, squeeze: 0 };
    if (state.pressTarget) this.routePressEnd(state.pressTarget, sourceId, info);
    if (state.grabTarget) this.endGrab(state.grabTarget, sourceId, info);
    if (state.hoverTarget) this.setHover(state.hoverTarget, sourceId, false);
  }

  private releaseAllHolds(id: string): void {
    for (const [sourceId, state] of this.sourceStates) {
      if (state.pressTarget === id) {
        this.routePressEnd(id, sourceId, { id: sourceId, kind: "other", select: 0, squeeze: 0 });
        state.pressTarget = null;
        state.pressed = false;
      }
      if (state.grabTarget === id) {
        this.endGrab(id, sourceId, { id: sourceId, kind: "other", select: 0, squeeze: 0 });
        state.grabTarget = null;
        state.grabbed = false;
      }
      if (state.hoverTarget === id) {
        this.setHover(id, sourceId, false);
        state.hoverTarget = null;
      }
    }
  }

  private updateGaze(sources: readonly InputSourceSnapshot[], dt: number): void {
    let gazeRay: RayTuple | null = null;
    let gazeId = HEAD_GAZE_INTERACTOR_ID;
    const gazeSource = sources.find((s) => s.kind === "gaze");
    if (gazeSource?.ray) {
      gazeRay = gazeSource.ray;
      gazeId = gazeSource.id;
    } else if (this.capabilities.headPose && this.provider.getHeadPose) {
      const head: PoseTuple = this.provider.getHeadPose();
      gazeRay = {
        origin: head.position,
        direction: vApplyQuat([0, 0, -1], head.quaternion),
      };
    }

    const gazeTarget =
      gazeRay && this.hitTester ? this.hitTester.hitRay(gazeRay)?.interactableId ?? null : null;

    for (const [id, registered] of this.interactables) {
      const hovered = registered.enabled && gazeTarget === id;
      if (hovered !== registered.gazeHovered) {
        registered.gazeHovered = hovered;
        this.events.emit({
          type: hovered ? "hoverEnter" : "hoverExit",
          interactableId: id,
          interactorId: gazeId,
        });
      }
      if (registered.dwellConfig && registered.enabled) {
        const tick = registered.dwell.update(hovered, dt, registered.dwellConfig);
        if (tick.changed) {
          this.events.emit({
            type: "dwellProgress",
            interactableId: id,
            interactorId: gazeId,
            value: tick.progress,
          });
        }
        if (tick.fired) {
          // A completed dwell is a synthesized click: press + release.
          const info: InteractorInfo = { id: gazeId, kind: "gaze", select: 1, squeeze: 0 };
          this.routePressStart(id, registered, info);
          this.routePressEnd(id, gazeId, { ...info, select: 0 });
          this.feedbackEmitter.emit({
            cue: "dwellComplete",
            interactableId: id,
            intensity: 0.6,
            durationMs: 50,
          });
        }
      }
    }
  }

  private tickBehaviours(sources: readonly InputSourceSnapshot[], dt: number): void {
    const bySourceId = new Map(sources.map((s) => [s.id, s]));
    for (const [id, registered] of this.interactables) {
      if (!registered.enabled) continue;
      const holderSource = registered.grabbedBy ? bySourceId.get(registered.grabbedBy) : undefined;
      const holder = holderSource ? this.interactorInfo(holderSource) : undefined;
      const ctx = this.contextFor(id, registered, dt);
      for (const slot of registered.behaviours) {
        if (slot.disabled) continue;
        slot.instance.update(ctx, slot.instance.grabbable ? holder : undefined);
      }
    }
  }

  private contextFor(id: string, registered: Registered, dt: number) {
    return {
      dt,
      interactableId: id,
      transform: registered.transform,
      emit: (event: Omit<InteractionEvent, "interactableId">) =>
        this.events.emit({ ...event, interactableId: id }),
      feedback: (intent: Omit<FeedbackIntent, "interactableId">) =>
        this.feedbackEmitter.emit({ ...intent, interactableId: id }),
      getWorldPose: (otherId: string) =>
        this.interactables.get(otherId)?.transform?.getWorldPose(),
    };
  }

  private renegotiate(id: string, registered: Registered): void {
    const fulfilment = this.capabilities.grabs === "native" ? "native" : "poseOnly";
    for (const slot of registered.behaviours) {
      if (slot.instance instanceof GrabBehaviour) {
        slot.instance.setFulfilment(fulfilment);
      }
      const unmet = [...unmetRequirements(this.capabilities, slot.instance.requires)];
      for (const group of slot.instance.requiresAnyOf ?? []) {
        if (group.length > 0 && unmetRequirements(this.capabilities, group).length === group.length) {
          unmet.push(group[0]!);
        }
      }
      const disabled = unmet.length > 0;
      if (disabled !== slot.disabled) {
        slot.disabled = disabled;
        slot.disabledReason = disabled ? `unmet input capabilities: ${unmet.join(", ")}` : "";
        this.events.emit({
          type: disabled ? "behaviourDisabled" : "behaviourEnabled",
          interactableId: id,
          behaviourKind: slot.instance.kind,
          ...(disabled ? { reason: slot.disabledReason } : {}),
        });
      }
    }
  }

  private renegotiateAll(): void {
    for (const [id, registered] of this.interactables) {
      this.renegotiate(id, registered);
    }
  }
}

/** Build a runtime's interactables from a portable descriptor. */
export function registerDescriptor(
  runtime: InteractionRuntime,
  descriptor: { interactables: InteractableDescriptor[] },
  portsFor: (id: string) => RegisterPorts = () => ({}),
): void {
  for (const interactable of descriptor.interactables) {
    runtime.registerInteractable(interactable, portsFor(interactable.id));
  }
}
