/**
 * Press - a mechanical button. `driven`: the behaviour owns the transform,
 * integrating an underdamped spring toward the logical target so the button
 * visibly depresses, overshoots and settles (the pale-signal bounce).
 * Supports momentary (default) and latching modes - latching is finally
 * reachable from data, unlike the research prototype.
 */
import type { Vec3Tuple } from "@realitycollective/webxr-input";
import { springStep, vScale } from "../math.js";
import type { Behaviour, BehaviourContext, InteractorInfo } from "./behaviour.js";

export interface PressConfig {
  kind: "press";
  /** Local press axis; the button depresses along −axis. */
  axis?: Vec3Tuple;
  /** Full travel in meters. */
  travel?: number;
  /** Fraction of travel reached at full press. */
  depthFraction?: number;
  stiffness?: number;
  damping?: number;
  /** Latching: press toggles and holds; release is a no-op. */
  latching?: boolean;
}

const VALUE_EPSILON = 1e-3;

export class PressBehaviour implements Behaviour {
  readonly kind = "press";
  readonly ownership = "driven" as const;
  readonly requires = [] as const;
  readonly requiresAnyOf = [["rays", "pokes", "pointer2d", "gaze"]] as const;
  readonly grabbable = false;

  private readonly axis: Vec3Tuple;
  private travel: number;
  private depthFraction: number;
  private stiffness: number;
  private damping: number;
  private readonly latching: boolean;

  private target = 0; // logical 0/1
  private latched = false;
  private progress = 0; // spring output 0..1
  private velocity = 0;
  private lastEmitted = -1;
  private readonly spring = new Float32Array(2);

  constructor(config: Omit<PressConfig, "kind"> = {}) {
    this.axis = config.axis ?? [0, 1, 0];
    this.travel = config.travel ?? 0.04;
    this.depthFraction = config.depthFraction ?? 0.5;
    this.stiffness = config.stiffness ?? 220;
    this.damping = config.damping ?? 12;
    this.latching = config.latching ?? false;
  }

  onPressStart(ctx: BehaviourContext, interactor: InteractorInfo): void {
    if (this.latching) {
      this.latched = !this.latched;
      this.target = this.latched ? 1 : 0;
      ctx.emit({
        type: this.latched ? "actuated" : "released",
        behaviourKind: this.kind,
        interactorId: interactor.id,
        value: this.target,
      });
      ctx.feedback({
        cue: this.latched ? "actuate" : "release",
        behaviourKind: this.kind,
        sourceId: interactor.id,
        intensity: 0.8,
        durationMs: 40,
      });
      return;
    }
    this.target = 1;
    ctx.emit({ type: "actuated", behaviourKind: this.kind, interactorId: interactor.id, value: 1 });
    ctx.feedback({
      cue: "actuate",
      behaviourKind: this.kind,
      sourceId: interactor.id,
      intensity: 0.8,
      durationMs: 40,
    });
  }

  onPressEnd(ctx: BehaviourContext, interactor: InteractorInfo): void {
    if (this.latching) return;
    this.target = 0;
    ctx.emit({ type: "released", behaviourKind: this.kind, interactorId: interactor.id, value: 0 });
    ctx.feedback({
      cue: "release",
      behaviourKind: this.kind,
      sourceId: interactor.id,
      intensity: 0.3,
      durationMs: 20,
    });
  }

  update(ctx: BehaviourContext): void {
    springStep(
      this.progress,
      this.velocity,
      this.target,
      this.stiffness,
      this.damping,
      ctx.dt,
      this.spring,
    );
    this.progress = this.spring[0] ?? 0;
    this.velocity = this.spring[1] ?? 0;
    ctx.transform?.setLocalOffset(
      vScale(this.axis, -this.travel * this.depthFraction * this.progress),
    );
    if (Math.abs(this.progress - this.lastEmitted) > VALUE_EPSILON) {
      this.lastEmitted = this.progress;
      ctx.emit({ type: "valueChanged", behaviourKind: this.kind, value: this.getValue() });
    }
  }

  getValue(): number {
    return this.target;
  }

  /** Latched state (latching mode). */
  get isLatched(): boolean {
    return this.latched;
  }

  // Live-tuning accessors (playground steppers).
  getTravel(): number {
    return this.travel;
  }
  setTravel(travel: number): void {
    this.travel = travel;
  }
  getDepthFraction(): number {
    return this.depthFraction;
  }
  setDepthFraction(fraction: number): void {
    this.depthFraction = fraction;
  }
  getSpring(): { stiffness: number; damping: number } {
    return { stiffness: this.stiffness, damping: this.damping };
  }
  setSpring(stiffness: number, damping: number): void {
    this.stiffness = stiffness;
    this.damping = damping;
  }
}
