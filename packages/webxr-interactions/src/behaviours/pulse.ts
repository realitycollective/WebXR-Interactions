/**
 * Pulse - an additive press effect: a decaying scale + emissive flash on
 * actuation. Composes with any motion behaviour on the same interactable
 * (multiple behaviours per object, the pale-signal beacon pattern).
 */
import { decay } from "../math.js";
import type { Behaviour, BehaviourContext, InteractorInfo } from "./behaviour.js";

export interface PulseConfig {
  kind: "pulse";
  scaleAmount?: number;
  emissiveAmount?: number;
  decayRate?: number;
}

export class PulseBehaviour implements Behaviour {
  readonly kind = "pulse";
  readonly ownership = "driven" as const;
  readonly requires = [] as const;
  readonly grabbable = false;

  private readonly scaleAmount: number;
  private readonly emissiveAmount: number;
  private readonly decayRate: number;
  private level = 0;

  constructor(config: Omit<PulseConfig, "kind"> = {}) {
    this.scaleAmount = config.scaleAmount ?? 0.25;
    this.emissiveAmount = config.emissiveAmount ?? 1.5;
    this.decayRate = config.decayRate ?? 6;
  }

  onPressStart(_ctx: BehaviourContext, _interactor: InteractorInfo): void {
    this.level = 1;
  }

  update(ctx: BehaviourContext): void {
    if (this.level === 0) return;
    this.level = decay(this.level, this.decayRate, ctx.dt);
    ctx.transform?.setEffect?.({
      scale: 1 + this.scaleAmount * this.level,
      emissive: this.emissiveAmount * this.level,
    });
  }

  getValue(): number {
    return this.level;
  }
}
