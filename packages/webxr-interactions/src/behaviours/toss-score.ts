/**
 * TossScore - attach to a hoop/goal; scores registered target objects that
 * pass through its plane in the scoring direction. Scoring is geometric
 * and engine-free; how the object gets thrown (native physics, poseOnly
 * carry + client ballistics) is not this behaviour's concern.
 */
import type { Vec3Tuple } from "@realitycollective/webxr-input";
import { passedThroughHoop, vDot, vSub } from "../math.js";
import type { Behaviour, BehaviourContext } from "./behaviour.js";

export interface TossScoreConfig {
  kind: "tossScore";
  /** Interactable ids of the objects that can score. */
  targetIds: string[];
  /** Ring radius in meters. */
  radius?: number;
  /** Hoop plane normal (local "up" of the ring). */
  axis?: Vec3Tuple;
}

export class TossScoreBehaviour implements Behaviour {
  readonly kind = "tossScore";
  readonly ownership = "driven" as const;
  readonly requires = [] as const;
  readonly grabbable = false;

  private readonly targetIds: string[];
  private radius: number;
  private readonly axis: Vec3Tuple;
  private readonly prevAlong = new Map<string, number>();
  private scoredCount = 0;

  constructor(config: Omit<TossScoreConfig, "kind">) {
    this.targetIds = [...config.targetIds];
    this.radius = config.radius ?? 0.2;
    this.axis = config.axis ?? [0, 1, 0];
  }

  update(ctx: BehaviourContext): void {
    const transform = ctx.transform;
    if (!transform) return;
    const hoop = transform.getWorldPose();
    for (const targetId of this.targetIds) {
      const target = ctx.getWorldPose(targetId);
      if (!target) continue;
      const offset = vSub(target.position, hoop.position);
      const along = vDot(offset, this.axis);
      const radialVec = vSub(offset, [
        this.axis[0] * along,
        this.axis[1] * along,
        this.axis[2] * along,
      ]);
      const radial = Math.hypot(radialVec[0], radialVec[1], radialVec[2]);
      const prev = this.prevAlong.get(targetId);
      if (prev !== undefined && passedThroughHoop(prev, along, 0, radial, this.radius)) {
        this.scoredCount += 1;
        ctx.emit({ type: "scored", behaviourKind: this.kind, value: this.scoredCount });
        ctx.feedback({
          cue: "score",
          behaviourKind: this.kind,
          intensity: 1,
          durationMs: 60,
        });
      }
      this.prevAlong.set(targetId, along);
    }
  }

  getValue(): number {
    return this.scoredCount;
  }

  setRadius(radius: number): void {
    this.radius = radius;
  }

  getRadius(): number {
    return this.radius;
  }
}
