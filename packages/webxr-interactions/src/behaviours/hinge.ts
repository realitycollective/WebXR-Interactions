/**
 * Hinge - a position-driven lever. `handDriven`: grabbing only marks the
 * hold; the behaviour reads the holder's hand position each frame and
 * swings the arm to point at it (movement, not wrist), bidirectional about
 * rest, clamped to ±maxAngle. Stays where left on release. Publishes a
 * centred 0..1 value (rest = 0.5).
 *
 * All math happens in the interactable's REST local frame, so the mount
 * (table / wall vertical / wall horizontal / any) is simply the parent
 * orientation of the object - no faceYaw plumbing needed.
 */
import type { Vec3Tuple } from "@realitycollective/webxr-input";
import {
  centeredUnit,
  hingeAngleToHand,
  quatFromAxisAngle,
  vCross,
  vDot,
  worldToLocal,
} from "../math.js";
import { holderPoint, type Behaviour, type BehaviourContext, type InteractorInfo } from "./behaviour.js";

export interface HingeConfig {
  kind: "hinge";
  /** Local hinge axis. */
  axis?: Vec3Tuple;
  /** Local rest direction of the arm. */
  restDir?: Vec3Tuple;
  /** Max swing (radians) either side of rest. */
  maxAngle?: number;
}

const VALUE_EPSILON = 1e-3;

export class HingeBehaviour implements Behaviour {
  readonly kind = "hinge";
  readonly ownership = "handDriven" as const;
  readonly requires = ["grabs"] as const;
  readonly grabbable = true;

  private readonly axis: Vec3Tuple;
  private readonly restDir: Vec3Tuple;
  private readonly swingDir: Vec3Tuple;
  private maxAngle: number;
  private angle = 0;
  private lastEmitted = -1;

  constructor(config: Omit<HingeConfig, "kind"> = {}) {
    this.axis = config.axis ?? [1, 0, 0];
    this.restDir = config.restDir ?? [0, 1, 0];
    this.swingDir = vCross(this.axis, this.restDir);
    this.maxAngle = config.maxAngle ?? Math.PI / 4;
  }

  onGrabStart(ctx: BehaviourContext, interactor: InteractorInfo): void {
    ctx.emit({ type: "grabStart", behaviourKind: this.kind, interactorId: interactor.id });
    ctx.feedback({
      cue: "grab",
      behaviourKind: this.kind,
      sourceId: interactor.id,
      intensity: 0.4,
      durationMs: 25,
    });
  }

  onGrabEnd(ctx: BehaviourContext, interactor: InteractorInfo): void {
    ctx.emit({ type: "grabEnd", behaviourKind: this.kind, interactorId: interactor.id });
    ctx.feedback({
      cue: "drop",
      behaviourKind: this.kind,
      sourceId: interactor.id,
      intensity: 0.2,
      durationMs: 15,
    });
  }

  update(ctx: BehaviourContext, holder?: InteractorInfo): void {
    if (holder && ctx.transform) {
      const hand = holderPoint(holder);
      if (hand) {
        const rest = ctx.transform.getWorldPose();
        const local = worldToLocal(hand, rest.position, rest.quaternion);
        const alongRest = vDot(local, this.restDir);
        const alongSwing = vDot(local, this.swingDir);
        this.angle = hingeAngleToHand(alongRest, alongSwing, this.maxAngle);
        ctx.transform.setLocalRotation(quatFromAxisAngle(this.axis, this.angle));
      }
    }
    const value = this.getValue();
    if (Math.abs(value - this.lastEmitted) > VALUE_EPSILON) {
      this.lastEmitted = value;
      ctx.emit({ type: "valueChanged", behaviourKind: this.kind, value });
    }
  }

  getValue(): number {
    return centeredUnit(this.angle, this.maxAngle);
  }

  /** Live-tune the swing range (playground steppers). */
  setMaxAngle(maxAngle: number): void {
    this.maxAngle = maxAngle;
  }

  getMaxAngle(): number {
    return this.maxAngle;
  }
}
