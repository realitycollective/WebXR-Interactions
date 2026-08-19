/**
 * Slide — a pulley/handle pulled along one local axis. `handDriven` while
 * held (the pull follows the hand's displacement along −axis), `driven`
 * on release: a spring returns the handle home while the value keeps
 * publishing. Value = pull / travel.
 */
import type { Vec3Tuple } from "@realitycollective/webxr-input";
import { springStep, vDot, vScale, worldToLocal } from "../math.js";
import { holderPoint, type Behaviour, type BehaviourContext, type InteractorInfo } from "./behaviour.js";

export interface SlideConfig {
  kind: "slide";
  /** Local rail axis; the handle is pulled along −axis. */
  axis?: Vec3Tuple;
  /** Full pull travel in meters. */
  travel?: number;
  stiffness?: number;
  damping?: number;
}

const VALUE_EPSILON = 1e-3;

export class SlideBehaviour implements Behaviour {
  readonly kind = "slide";
  readonly ownership = "handDriven" as const;
  readonly requires = ["grabs"] as const;
  readonly grabbable = true;

  private readonly axis: Vec3Tuple;
  private travel: number;
  private stiffness: number;
  private damping: number;

  private pull = 0; // meters along −axis, 0..travel
  private velocity = 0;
  private pullAtGrab = 0;
  private handAlongAtGrab = 0;
  private held = false;
  private lastEmitted = -1;
  private readonly spring = new Float32Array(2);

  constructor(config: Omit<SlideConfig, "kind"> = {}) {
    this.axis = config.axis ?? [0, 1, 0];
    this.travel = config.travel ?? 0.3;
    this.stiffness = config.stiffness ?? 180;
    this.damping = config.damping ?? 14;
  }

  private handAlong(ctx: BehaviourContext, holder: InteractorInfo): number | null {
    const hand = holderPoint(holder);
    const transform = ctx.transform;
    if (!hand || !transform) return null;
    const rest = transform.getWorldPose();
    const local = worldToLocal(hand, rest.position, rest.quaternion);
    // Pull is measured along −axis.
    return -vDot(local, this.axis);
  }

  onGrabStart(ctx: BehaviourContext, interactor: InteractorInfo): void {
    this.held = true;
    this.pullAtGrab = this.pull;
    this.handAlongAtGrab = this.handAlong(ctx, interactor) ?? 0;
    this.velocity = 0;
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
    this.held = false;
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
    if (this.held && holder) {
      const along = this.handAlong(ctx, holder);
      if (along !== null) {
        const next = this.pullAtGrab + (along - this.handAlongAtGrab);
        this.pull = Math.min(this.travel, Math.max(0, next));
      }
    } else if (this.pull > 0 || Math.abs(this.velocity) > 1e-4) {
      springStep(this.pull, this.velocity, 0, this.stiffness, this.damping, ctx.dt, this.spring);
      this.pull = Math.max(0, this.spring[0] ?? 0);
      this.velocity = this.spring[1] ?? 0;
      if (this.pull < 1e-4 && Math.abs(this.velocity) < 1e-3) {
        this.pull = 0;
        this.velocity = 0;
      }
    }
    ctx.transform?.setLocalOffset(vScale(this.axis, -this.pull));
    const value = this.getValue();
    if (Math.abs(value - this.lastEmitted) > VALUE_EPSILON) {
      this.lastEmitted = value;
      ctx.emit({ type: "valueChanged", behaviourKind: this.kind, value });
    }
  }

  getValue(): number {
    return this.travel < 1e-9 ? 0 : Math.min(1, this.pull / this.travel);
  }

  setTravel(travel: number): void {
    this.travel = travel;
    if (this.pull > travel) this.pull = travel;
  }

  getTravel(): number {
    return this.travel;
  }

  setSpring(stiffness: number, damping: number): void {
    this.stiffness = stiffness;
    this.damping = damping;
  }

  getSpring(): { stiffness: number; damping: number } {
    return { stiffness: this.stiffness, damping: this.damping };
  }
}
