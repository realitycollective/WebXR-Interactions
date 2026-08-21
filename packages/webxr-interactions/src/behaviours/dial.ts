/**
 * Dial - a twistable knob. `handDriven`: while held, the hand's bearing
 * around the dial axis accumulates a clamped rotation `[0, maxAngle]`;
 * publishes `normalize01(angle, maxAngle)`. Works from any provider that
 * can grab and report a hand/grip position (the research prototype's
 * engine-dragged variant becomes an adapter option later).
 */
import type { Vec3Tuple } from "@realitycollective/webxr-input";
import {
  normalize01,
  quatFromAxisAngle,
  vCross,
  vDot,
  vNormalize,
  vSub,
  worldToLocal,
} from "../math.js";
import { holderPoint, type Behaviour, type BehaviourContext, type InteractorInfo } from "./behaviour.js";

export interface DialConfig {
  kind: "dial";
  /** Local twist axis. */
  axis?: Vec3Tuple;
  /** Max rotation from rest (radians). */
  maxAngle?: number;
}

const VALUE_EPSILON = 1e-3;

export class DialBehaviour implements Behaviour {
  readonly kind = "dial";
  readonly ownership = "handDriven" as const;
  readonly requires = ["grabs"] as const;
  readonly grabbable = true;

  private readonly axis: Vec3Tuple;
  private maxAngle: number;
  private angle = 0;
  private angleAtGrab = 0;
  private refBearing: Vec3Tuple | null = null;
  private lastEmitted = -1;

  constructor(config: Omit<DialConfig, "kind"> = {}) {
    this.axis = config.axis ?? [0, 1, 0];
    this.maxAngle = config.maxAngle ?? (3 * Math.PI) / 2;
  }

  private bearingOf(ctx: BehaviourContext, holder: InteractorInfo): Vec3Tuple | null {
    const hand = holderPoint(holder);
    const transform = ctx.transform;
    if (!hand || !transform) return null;
    const rest = transform.getWorldPose();
    const local = worldToLocal(hand, rest.position, rest.quaternion);
    // Project onto the plane perpendicular to the axis.
    const along = vDot(local, this.axis);
    const planar = vSub(local, [
      this.axis[0] * along,
      this.axis[1] * along,
      this.axis[2] * along,
    ]);
    const n = vNormalize(planar);
    return n[0] === 0 && n[1] === 0 && n[2] === 0 ? null : n;
  }

  onGrabStart(ctx: BehaviourContext, interactor: InteractorInfo): void {
    this.refBearing = this.bearingOf(ctx, interactor);
    this.angleAtGrab = this.angle;
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
    this.refBearing = null;
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
    if (holder && this.refBearing && ctx.transform) {
      const current = this.bearingOf(ctx, holder);
      if (current) {
        const cross = vCross(this.refBearing, current);
        const delta = Math.atan2(vDot(cross, this.axis), vDot(this.refBearing, current));
        const next = Math.min(this.maxAngle, Math.max(0, this.angleAtGrab + delta));
        this.angle = next;
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
    return normalize01(this.angle, this.maxAngle);
  }

  setMaxAngle(maxAngle: number): void {
    this.maxAngle = maxAngle;
    if (this.angle > maxAngle) this.angle = maxAngle;
  }

  getMaxAngle(): number {
    return this.maxAngle;
  }
}
