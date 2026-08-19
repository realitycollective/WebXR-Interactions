/**
 * The behaviour contract — a mechanism attached to an interactable.
 *
 * Behaviours are pure state machines: they receive routed input moments
 * (press/grab transitions), tick from `update(dt)`, and write their output
 * through the interactable's {@link TransformPort}. They declare:
 *
 * - `ownership` — who owns the transform (the formalised pale-signal
 *   driven / dragged / handDriven / native models), so a binder knows
 *   without reading code;
 * - `requires` / `requiresAnyOf` — the input capabilities they need;
 *   capability negotiation disables unsatisfiable behaviours VISIBLY
 *   (a `behaviourDisabled` event with the unmet list), never silently.
 */
import type {
  InputCapabilityRequirement,
  InputSourceKind,
  PoseTuple,
  RayTuple,
  Vec3Tuple,
} from "@realitycollective/webxr-input";
import type { InteractionEvent } from "../events.js";
import type { FeedbackIntent } from "../feedback.js";
import type { TransformPort } from "../ports.js";

/** Who owns the interactable's transform while this behaviour is active. */
export type TransformOwnership = "driven" | "dragged" | "handDriven" | "native";

/** The slice of a live interactor a behaviour may consume. */
export interface InteractorInfo {
  id: string;
  kind: InputSourceKind;
  ray?: RayTuple;
  gripPose?: PoseTuple;
  indexTip?: Vec3Tuple;
  select: number;
  squeeze: number;
}

/** Everything a behaviour can reach during a tick or a routed moment. */
export interface BehaviourContext {
  dt: number;
  interactableId: string;
  transform: TransformPort | undefined;
  emit(event: Omit<InteractionEvent, "interactableId">): void;
  feedback(intent: Omit<FeedbackIntent, "interactableId">): void;
  /** REST world pose of another registered interactable (toss scoring). */
  getWorldPose(interactableId: string): PoseTuple | undefined;
}

export interface Behaviour {
  readonly kind: string;
  readonly ownership: TransformOwnership;
  /** ALL of these must be satisfied. */
  readonly requires: readonly InputCapabilityRequirement[];
  /** For each group, AT LEAST ONE must be satisfied. */
  readonly requiresAnyOf?: readonly (readonly InputCapabilityRequirement[])[];
  /** True when this behaviour makes the interactable a grab target. */
  readonly grabbable: boolean;

  onPressStart?(ctx: BehaviourContext, interactor: InteractorInfo): void;
  onPressEnd?(ctx: BehaviourContext, interactor: InteractorInfo): void;
  onGrabStart?(ctx: BehaviourContext, interactor: InteractorInfo): void;
  onGrabEnd?(ctx: BehaviourContext, interactor: InteractorInfo): void;

  /**
   * Per-frame tick. `holder` is set while a grab interactor holds this
   * interactable (grab-family behaviours consume it; others ignore it).
   */
  update(ctx: BehaviourContext, holder?: InteractorInfo): void;

  /** Current logical 0..1 value (state snapshots, HUDs). */
  getValue(): number;
}

/** Hand position a hand-driven behaviour should track, best available. */
export function holderPoint(holder: InteractorInfo): Vec3Tuple | undefined {
  return holder.indexTip ?? holder.gripPose?.position ?? holder.ray?.origin;
}
