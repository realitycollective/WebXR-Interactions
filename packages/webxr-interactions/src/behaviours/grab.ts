/**
 * Grab - pick up and carry an object.
 *
 * Two fulfilments, chosen by capability negotiation at bind time:
 * - `"poseOnly"` - the behaviour owns the carry: on grab it captures the
 *   offset between the holder's grip and the object, then follows the grip
 *   each frame via `setWorldPose`. On a host with no physics the object
 *   stays where it is dropped. On one with physics the engine still owns
 *   the simulation; this behaviour only suspends and resumes it (see
 *   below).
 * - `"native"` - the engine owns carry/throw (e.g. IWSDK grabbables +
 *   physics); the behaviour only mirrors transitions into core events.
 *
 * On a `poseOnly` host whose object has physics, "the behaviour owns the
 * carry" also means the behaviour owns suspending and resuming it:
 * `onGrabStart` calls `ctx.transform.beginHold()` so the follow above does
 * not fight the solver, and `onGrabEnd` calls `endHold()` with the release
 * velocity so a throw carries through. Both are optional on `TransformPort`
 * and simply do not exist on a host with no physics, so this costs a host
 * without one nothing.
 *
 * The release velocity is the core throw rule (`release-velocity.ts`): the
 * velocity of the OBJECT the carry wrote, over IWSDK's physics step of
 * 1/60 s, angular from the orientation delta over the same step. This is
 * what IWSDK's grab system and Havok hand a thrown body, so a throw on a
 * pose-only platform leaves the hand at the same speed as on the web. A
 * source that reports its own grip velocity does not override it: the rule
 * is on the object, on every platform alike. A synthesised release (the
 * source was lost, the target unregistered, the runtime disposed) throws
 * nothing: zeros, and the object resumes at rest.
 */
import type { PoseTuple } from "@realitycollective/webxr-input";
import { quatConjugate, quatMultiply, vAdd, vApplyQuat, vSub } from "../math.js";
import { ReleaseVelocityTracker } from "../release-velocity.js";
import type { Behaviour, BehaviourContext, InteractorInfo } from "./behaviour.js";

export interface GrabConfig {
  kind: "grab";
}

export type GrabFulfilment = "poseOnly" | "native";

export class GrabBehaviour implements Behaviour {
  readonly kind = "grab";
  readonly ownership: "handDriven" | "native";
  readonly requires = ["grabs"] as const;
  readonly grabbable = true;

  private fulfilment: GrabFulfilment;
  private held = false;
  private offsetPosition = [0, 0, 0] as [number, number, number];
  private offsetQuaternion = [0, 0, 0, 1] as [number, number, number, number];
  private readonly release = new ReleaseVelocityTracker();

  constructor(_config: Omit<GrabConfig, "kind"> = {}, fulfilment: GrabFulfilment = "poseOnly") {
    this.fulfilment = fulfilment;
    this.ownership = fulfilment === "native" ? "native" : "handDriven";
  }

  setFulfilment(fulfilment: GrabFulfilment): void {
    this.fulfilment = fulfilment;
  }

  onGrabStart(ctx: BehaviourContext, interactor: InteractorInfo): void {
    this.held = true;
    this.release.reset();
    if (this.fulfilment === "poseOnly") {
      ctx.transform?.beginHold?.();
      if (interactor.gripPose && ctx.transform) {
        const object = ctx.transform.getWorldPose();
        const grip = interactor.gripPose;
        const invGrip = quatConjugate(grip.quaternion);
        this.offsetPosition = vApplyQuat(vSub(object.position, grip.position), invGrip);
        this.offsetQuaternion = quatMultiply(invGrip, object.quaternion);
        // The pose at pick-up is the first sample the throw is measured from.
        this.release.record(object, 0);
      }
    }
    ctx.emit({ type: "grabStart", behaviourKind: this.kind, interactorId: interactor.id });
    ctx.feedback({
      cue: "grab",
      behaviourKind: this.kind,
      sourceId: interactor.id,
      intensity: 0.5,
      durationMs: 30,
    });
  }

  onGrabEnd(ctx: BehaviourContext, interactor: InteractorInfo): void {
    this.held = false;
    if (this.fulfilment === "poseOnly") {
      // Zero on a synthesized release (source lost, target unregistered,
      // runtime disposed) - see the file comment and `InteractorInfo`'s.
      // The object then resumes at rest rather than flying off on a
      // disconnect it had nothing to do with.
      ctx.transform?.endHold?.(
        interactor.synthesized
          ? { linearVelocity: [0, 0, 0], angularVelocity: [0, 0, 0] }
          : this.release.release(),
      );
    }
    this.release.reset();
    ctx.emit({ type: "grabEnd", behaviourKind: this.kind, interactorId: interactor.id });
    ctx.feedback({
      cue: "drop",
      behaviourKind: this.kind,
      sourceId: interactor.id,
      intensity: 0.25,
      durationMs: 20,
    });
  }

  update(ctx: BehaviourContext, holder?: InteractorInfo): void {
    if (this.fulfilment !== "poseOnly" || !this.held || !holder) return;
    const grip = holder.gripPose;
    const transform = ctx.transform;
    if (!grip || !transform?.setWorldPose) return;
    const pose: PoseTuple = {
      position: vAdd(grip.position, vApplyQuat(this.offsetPosition, grip.quaternion)),
      quaternion: quatMultiply(grip.quaternion, this.offsetQuaternion),
    };
    transform.setWorldPose(pose);
    this.release.record(pose, ctx.dt);
  }

  getValue(): number {
    return this.held ? 1 : 0;
  }
}
