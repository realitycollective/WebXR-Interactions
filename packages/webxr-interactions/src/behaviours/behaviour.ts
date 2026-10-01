/**
 * The behaviour contract - a mechanism attached to an interactable.
 *
 * Behaviours are pure state machines: they receive routed input moments
 * (press/grab transitions), tick from `update(dt)`, and write their output
 * through the interactable's {@link TransformPort}. They declare:
 *
 * - `ownership` - who owns the transform (the formalised pale-signal
 *   driven / dragged / handDriven / native models), so a binder knows
 *   without reading code;
 * - `requires` / `requiresAnyOf` - the input capabilities they need;
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
  /**
   * Grip velocity, present on the same terms as `InputSourceSnapshot`'s -
   * the runtime's `VelocityTracker` fills it when the provider does not.
   * `onGrabEnd`'s release throw reads these; absent on a synthesized
   * release (source lost, target unregistered, runtime disposed), which
   * behaves as zero.
   */
  linearVelocity?: Vec3Tuple;
  angularVelocity?: Vec3Tuple;
  select: number;
  squeeze: number;
  /**
   * True on a release the runtime synthesised because the source was lost,
   * the target unregistered or disabled, or the runtime disposed: no hand
   * let go. A grab behaviour then hands its port zeros instead of a throw.
   */
  synthesized?: true;
}

/** Everything a behaviour can reach during a tick or a routed moment. */
export interface BehaviourContext {
  dt: number;
  interactableId: string;
  transform: TransformPort | undefined;
  emit(event: Omit<InteractionEvent, "interactableId">): void;
  feedback(intent: Omit<FeedbackIntent, "interactableId">): void;
  /** LIVE world pose of another registered interactable (toss scoring). */
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

/**
 * The point a hand-driven behaviour (dial, slide, hinge) tracks while a
 * holder grabs it: the GRIP, as IWSDK moves a held object with its grab
 * pointer, which is built on `xrOrigin.gripSpaces[side]` (`@iwsdk/xr-input`
 * `grab-pointer.js`; `@pmndrs/handle` then moves the object with that
 * pointer). Never the index fingertip: with a closed hand the fingertip
 * curls into the palm and barely moves around a wheel's axis, which is why
 * the native handwheel would not turn (Pale Signal handover, G2). A source
 * with no grip (a desktop pointer) falls back to its fingertip, then its
 * ray origin.
 */
export function holderPoint(holder: InteractorInfo): Vec3Tuple | undefined {
  return holder.gripPose?.position ?? holder.indexTip ?? holder.ray?.origin;
}
