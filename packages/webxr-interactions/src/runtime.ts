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
  rayPoseFromRay,
  resolveEyeGazeOptions,
  unmetRequirements,
  type EyeGazeOptions,
  type InputCapabilities,
  type InputHitHint,
  type InputProvider,
  type InputSourceSnapshot,
  type PoseTuple,
  type QuatTuple,
  type RayTuple,
  type Unsubscribe,
  type Vec3Tuple,
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
import { DwellState, GazeConsensus, resolveDwellConfig, DWELL_DEFAULTS, type DwellConfig } from "./gaze.js";
import { quatConjugate, quatMultiply, vApplyQuat, vLength, vNormalize, vSub } from "./math.js";
import type { HitTester, InteractableHit, TransformPort } from "./ports.js";
import { VelocityTracker, type VelocityTrackerOptions } from "./velocity-tracker.js";

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

/** How a source's target was found this frame; `"poke"` marks a near pointer, which suppresses eye gaze. */
type ResolvedBy = "hint" | "poke" | "ray" | "gaze" | null;

interface SourceRuntimeState {
  hoverTarget: string | null;
  resolvedBy: ResolvedBy;
  pressed: boolean;
  pressTarget: string | null;
  grabbed: boolean;
  grabTarget: string | null;
}

/** A gaze selection in progress: the pointer the pinching hand took over (see `followHand`). */
interface GazeHold {
  sourceId: string;
  /** The gaze ray at the moment of selection, used while the hand cannot follow. */
  ray: RayTuple;
  /** The aimed ray's orientation relative to the hand's ray space, or null when the pointer stays put. */
  relative: QuatTuple | null;
}

export interface InteractionRuntimeOptions {
  provider: InputProvider;
  hitTester?: HitTester;
  dwellDefaults?: DwellConfig;
  /**
   * Eye-gaze targeting, when the provider reports `capabilities.eyeGaze`:
   * the selection cone, dwell window, near-pointer suppression and whether a
   * gaze-started drag follows the pinching hand. Defaults are IWSDK 1.0.0's
   * (`EYE_GAZE_DEFAULTS`).
   */
  eyeGaze?: EyeGazeOptions;
  /**
   * Per-source velocity tracking. On by default with no smoothing; pass
   * `false` to skip it, or options to smooth. The tracker only fills in
   * what the provider did not supply.
   */
  velocity?: VelocityTrackerOptions | false;
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
  private readonly velocityTracker: VelocityTracker | null;
  private lastSources = new Map<string, InputSourceSnapshot>();
  private capabilities: InputCapabilities;
  private readonly unsubscribeCaps: Unsubscribe;
  private disposed = false;
  private readonly eyeGaze: Required<EyeGazeOptions>;
  private readonly gazeConsensus: GazeConsensus;
  /** The eye-gaze source's target this frame: cone, consensus and suppression applied. */
  private eyeGazeTarget: string | null = null;
  /** Where the eye-gaze ray last aimed at each target, for the pinching hand to aim at. */
  private readonly gazePoints = new Map<string, Vec3Tuple>();
  private gazeHold: GazeHold | null = null;

  constructor(options: InteractionRuntimeOptions) {
    this.provider = options.provider;
    this.hitTester = options.hitTester ?? null;
    this.eyeGaze = resolveEyeGazeOptions(options.eyeGaze);
    this.gazeConsensus = new GazeConsensus(this.eyeGaze.dwellWindowSeconds);
    const d = options.dwellDefaults;
    this.dwellDefaults = {
      holdSeconds: d?.holdSeconds ?? DWELL_DEFAULTS.holdSeconds,
      decayFactor: d?.decayFactor ?? DWELL_DEFAULTS.decayFactor,
      rearmBelow: d?.rearmBelow ?? DWELL_DEFAULTS.rearmBelow,
    };
    this.velocityTracker =
      options.velocity === false ? null : new VelocityTracker(options.velocity ?? {});
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

  /**
   * Sampled sources for this frame - the UI Extensions pointer bridge hook.
   *
   * @deprecated Use {@link onSample}. Both deliver the same stream: since
   * `@realitycollective/webxr-input` 0.1.1 carries `linearVelocity` and
   * `angularVelocity` on `InputSourceSnapshot`, the two signatures are
   * identical and only one name is needed. This one is kept so existing
   * callers keep working and will be removed in a later major release.
   */
  onSourcesSampled(listener: (sources: readonly InputSourceSnapshot[]) => void): Unsubscribe {
    return this.afterSample.subscribe(listener);
  }

  /**
   * This frame's sources, velocity included.
   *
   * The snapshots are the provider's own objects for this frame and are
   * never written to again once delivered (the ownership rule on
   * `InputSourceSnapshot`), so a listener may keep one, or a tuple inside
   * it, across frames without copying.
   */
  onSample(listener: (sources: readonly InputSourceSnapshot[]) => void): Unsubscribe {
    return this.afterSample.subscribe(listener);
  }

  /**
   * The last sample of one source, velocity included. Undefined before the
   * first update, and once the source stops reporting.
   *
   * The snapshot is the caller's to keep: it is never mutated after the
   * frame it was sampled in, and it is not refreshed in place, so call
   * again for a newer one.
   */
  getSource(id: string): InputSourceSnapshot | undefined {
    return this.lastSources.get(id);
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
    const sampled = this.provider.sample();
    const tracked = this.velocityTracker ? this.velocityTracker.update(sampled, dt) : sampled;
    const sources = this.followHand(tracked);
    const hints = this.provider.sampleHints?.() ?? [];
    this.lastSources = new Map(sources.map((source) => [source.id, source]));
    this.afterSample.emit(sources);

    const hintBySource = new Map<string, InputHitHint[]>();
    for (const hint of hints) {
      const list = hintBySource.get(hint.sourceId);
      if (list) list.push(hint);
      else hintBySource.set(hint.sourceId, [hint]);
    }

    // With eye gaze live, the hands and controllers go first: whether one of
    // them has a near pointer active this frame decides what gaze may target
    // (IWSDK reads the hand pointers' state before it drives the gaze pointer).
    const eyeGazeLive = this.capabilities.eyeGaze;
    const ordered = eyeGazeLive
      ? [...sources].sort((a, b) => Number(a.kind === "gaze") - Number(b.kind === "gaze"))
      : sources;
    this.eyeGazeTarget = null;
    let sawGaze = false;
    const seen = new Set<string>();
    for (const source of ordered) {
      seen.add(source.id);
      if (eyeGazeLive && source.kind === "gaze") {
        sawGaze = true;
        this.resolveEyeGaze(source, dt);
      }
      this.updateSource(source, hintBySource.get(source.id) ?? []);
    }
    if (!sawGaze) {
      // No eye-gaze source this frame (none, or far targeting handed back).
      this.gazeHold = null;
      this.gazeConsensus.reset();
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
    if (this.disposed) return;
    this.disposed = true;
    // A disposed runtime still owes every held grab exactly one `endHold`
    // (zero velocity - nothing threw it away, the scene just went down),
    // so physics never stays suspended once nothing is left to resume it.
    for (const [id, registered] of this.interactables) {
      if (registered.grabbedBy) {
        this.endGrab(id, registered.grabbedBy, {
          id: registered.grabbedBy,
          kind: "other",
          select: 0,
          squeeze: 0,
        });
      }
    }
    this.unsubscribeCaps();
    this.interactables.clear();
    this.sourceStates.clear();
    this.lastSources.clear();
    this.velocityTracker?.reset();
    this.gazeHold = null;
    this.gazePoints.clear();
    this.gazeConsensus.reset();
  }

  // -- eye gaze -----------------------------------------------------------------

  /**
   * The targeting half of the eye-gaze rule (`@realitycollective/webxr-input`
   * `eye-gaze.ts` states the whole of it): the cone's best candidate this
   * frame, then the dwell consensus over the window, and nothing at all while
   * a hand's near pointer is hovering or selecting (IWSDK
   * `suppressWhenDirectPointerActive`). A frame with no valid gaze ray clears
   * the record, as IWSDK resets its conecaster, unless a selection is held.
   */
  private resolveEyeGaze(source: InputSourceSnapshot, dt: number): void {
    const ray = source.ray;
    if (!ray) {
      if (!this.gazeHold) this.gazeConsensus.reset();
      this.eyeGazeTarget = null;
      return;
    }
    if (this.eyeGaze.suppressWhenDirectPointerActive && this.directPointerActive()) {
      this.gazeConsensus.skip(dt);
      this.eyeGazeTarget = null;
      return;
    }
    const halfAngle = (this.eyeGaze.coneAngleDegrees * Math.PI) / 180;
    const maxLength = this.eyeGaze.maxRayLength;
    let best: InteractableHit | null = null;
    if (this.hitTester) {
      best = this.hitTester.hitCone
        ? this.hitTester.hitCone(ray, halfAngle, maxLength)
        : this.hitTester.hitRay(ray);
      if (best && (best.distance > maxLength || !this.targetable(best.interactableId))) best = null;
    }
    if (best) this.gazePoints.set(best.interactableId, best.point);
    this.eyeGazeTarget = this.gazeConsensus.update(best?.interactableId ?? null, dt, (id) => this.targetable(id));
  }

  /** A hand's near pointer is hovering or selecting: a poke-resolved target, or a grab. */
  private directPointerActive(): boolean {
    for (const [id, state] of this.sourceStates) {
      const source = this.lastSources.get(id);
      if (!source || (source.handedness !== "left" && source.handedness !== "right")) continue;
      if (state.grabbed) return true;
      if (state.resolvedBy === "poke" && (state.hoverTarget !== null || state.pressTarget !== null)) return true;
    }
    return false;
  }

  /**
   * Once a gaze selection is held, the pinching hand drives the pointer
   * (IWSDK `pointerTransformFollowsHand`): the frame the hold starts, a ray
   * from the hand's ray space is aimed at the gaze hit and its orientation
   * relative to the hand recorded; every later frame the gaze snapshot's ray
   * is that hand's ray space turned by the same amount. When the hand could
   * not reach the hit, or the option is off, the ray stays where the
   * selection was made. Consumers of `onSample` and `getSource`, and every
   * behaviour, see the followed ray.
   */
  private followHand(sources: readonly InputSourceSnapshot[]): readonly InputSourceSnapshot[] {
    const hold = this.gazeHold;
    if (!hold || !this.capabilities.eyeGaze) return sources;
    const index = sources.findIndex((source) => source.id === hold.sourceId);
    if (index < 0) return sources;
    const source = sources[index]!;
    let ray = hold.ray;
    if (hold.relative && source.selectorPose) {
      const quaternion = quatMultiply(source.selectorPose.quaternion, hold.relative);
      ray = { origin: [...source.selectorPose.position], direction: vApplyQuat([0, 0, -1], quaternion) };
    }
    const out = [...sources];
    out[index] = { ...source, ray };
    return out;
  }

  /** Start, keep or end the gaze hold from the gaze source's press and grab state this frame. */
  private trackGazeHold(source: InputSourceSnapshot, state: SourceRuntimeState, target: string | null): void {
    if (!state.pressed && !state.grabbed) {
      this.gazeHold = null;
      return;
    }
    if (this.gazeHold?.sourceId === source.id) return;
    if (!source.ray) return;
    let relative: QuatTuple | null = null;
    const point = target ? this.gazePoints.get(target) : undefined;
    const selector = source.selectorPose;
    if (this.eyeGaze.pointerTransformFollowsHand && selector && point) {
      const aim = vSub(point, selector.position);
      if (vLength(aim) > 1e-6) {
        const up = vApplyQuat([0, 1, 0], selector.quaternion);
        const aimed = rayPoseFromRay({ origin: selector.position, direction: vNormalize(aim) }, up);
        const aimedRay: RayTuple = { origin: aimed.position, direction: vApplyQuat([0, 0, -1], aimed.quaternion) };
        // IWSDK follows the hand only when the ray from the hand reaches the target.
        const reaches = this.hitTester ? this.hitTester.hitRay(aimedRay) !== null : true;
        if (reaches) relative = quatMultiply(quatConjugate(selector.quaternion), aimed.quaternion);
      }
    }
    this.gazeHold = { sourceId: source.id, ray: source.ray, relative };
  }

  // -- internals ---------------------------------------------------------------

  private sourceState(id: string): SourceRuntimeState {
    let state = this.sourceStates.get(id);
    if (!state) {
      state = { hoverTarget: null, resolvedBy: null, pressed: false, pressTarget: null, grabbed: false, grabTarget: null };
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
    if (source.linearVelocity) info.linearVelocity = source.linearVelocity;
    if (source.angularVelocity) info.angularVelocity = source.angularVelocity;
    return info;
  }

  /** Resolve this source's target: hints beat poke beats ray. An eye-gaze source uses the cone and consensus instead. */
  private resolveTarget(source: InputSourceSnapshot, hints: InputHitHint[], state: SourceRuntimeState): string | null {
    state.resolvedBy = null;
    const hint =
      hints.find((h) => h.state === "grab") ??
      hints.find((h) => h.state === "press") ??
      hints.find((h) => h.state === "hover");
    if (hint && this.targetable(hint.targetId)) {
      state.resolvedBy = "hint";
      return hint.targetId;
    }
    if (this.capabilities.eyeGaze && source.kind === "gaze") {
      if (this.eyeGazeTarget !== null) state.resolvedBy = "gaze";
      return this.eyeGazeTarget;
    }
    if (source.indexTip && this.hitTester) {
      // One proximity query at the largest radius any interactable asked for,
      // then the nearest hit must be inside ITS OWN radius. A per-interactable
      // query would be a hit test per registration per source per frame; this
      // keeps it to one. The trade: a farther interactable with a bigger radius
      // is not found behind a nearer one with a smaller radius, because the
      // tester returns only the nearest.
      const poke = this.hitTester.hitProximity(source.indexTip, this.maxPokeRadius());
      if (poke && this.targetable(poke.interactableId)) {
        const registered = this.interactables.get(poke.interactableId)!;
        if (poke.distance <= registered.pokeRadius) {
          state.resolvedBy = "poke";
          return poke.interactableId;
        }
      }
    }
    if (source.ray && this.hitTester) {
      const hit = this.hitTester.hitRay(source.ray);
      if (hit && this.targetable(hit.interactableId)) {
        state.resolvedBy = "ray";
        return hit.interactableId;
      }
    }
    return null;
  }

  private targetable(id: string): boolean {
    const registered = this.interactables.get(id);
    return registered !== undefined && registered.enabled;
  }

  /** The largest poke radius among enabled interactables; the default when none is registered. */
  private maxPokeRadius(): number {
    let radius = 0;
    for (const registered of this.interactables.values()) {
      if (registered.enabled && registered.pokeRadius > radius) radius = registered.pokeRadius;
    }
    return radius > 0 ? radius : DEFAULT_POKE_RADIUS;
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
    const target = this.resolveTarget(source, hints, state);

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

    if (this.capabilities.eyeGaze && source.kind === "gaze") this.trackGazeHold(source, state, target);
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
    // Eye gaze, when live, is the gaze for gating and dwell too, with the
    // target the cone and consensus chose (nothing while a near pointer is
    // active, or while the pose is invalid). Otherwise a head-gaze source, or
    // the head pose, targets by plain ray as before.
    const eyeGaze = this.capabilities.eyeGaze && gazeSource !== undefined;
    if (eyeGaze) {
      gazeRay = gazeSource.ray ?? null;
      gazeId = gazeSource.id;
    } else if (gazeSource?.ray) {
      gazeRay = gazeSource.ray;
      gazeId = gazeSource.id;
    } else if (this.capabilities.headPose && this.provider.getHeadPose) {
      const head: PoseTuple = this.provider.getHeadPose();
      gazeRay = {
        origin: head.position,
        direction: vApplyQuat([0, 0, -1], head.quaternion),
      };
    }

    const gazeTarget = eyeGaze
      ? this.eyeGazeTarget
      : gazeRay && this.hitTester
        ? (this.hitTester.hitRay(gazeRay)?.interactableId ?? null)
        : null;

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
