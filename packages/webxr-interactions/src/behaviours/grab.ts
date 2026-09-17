/**
 * Grab - pick up and carry an object.
 *
 * Two fulfilments, chosen by capability negotiation at bind time:
 * - `"poseOnly"` - the behaviour owns the carry: on grab it captures the
 *   offset between the holder's grip and the object, then follows the grip
 *   each frame via `setWorldPose`. On release the object stays where
 *   dropped - ballistics/physics are deliberately the CLIENT's concern
 *   (physics is a property of the object in space, not of the interaction
 *   layer).
 * - `"native"` - the engine owns carry/throw (e.g. IWSDK grabbables +
 *   physics); the behaviour only mirrors transitions into core events.
 */
import type { PoseTuple } from "@realitycollective/webxr-input";
import { quatConjugate, quatMultiply, vAdd, vApplyQuat, vSub } from "../math.js";
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

  constructor(_config: Omit<GrabConfig, "kind"> = {}, fulfilment: GrabFulfilment = "poseOnly") {
    this.fulfilment = fulfilment;
    this.ownership = fulfilment === "native" ? "native" : "handDriven";
  }

  setFulfilment(fulfilment: GrabFulfilment): void {
    this.fulfilment = fulfilment;
  }

  onGrabStart(ctx: BehaviourContext, interactor: InteractorInfo): void {
    this.held = true;
    if (this.fulfilment === "poseOnly" && interactor.gripPose && ctx.transform) {
      const object = ctx.transform.getWorldPose();
      const grip = interactor.gripPose;
      const invGrip = quatConjugate(grip.quaternion);
      this.offsetPosition = vApplyQuat(vSub(object.position, grip.position), invGrip);
      this.offsetQuaternion = quatMultiply(invGrip, object.quaternion);
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
  }

  getValue(): number {
    return this.held ? 1 : 0;
  }
}
