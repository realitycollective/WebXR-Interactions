/**
 * Behaviour factory — turns portable config data into behaviour instances.
 * Custom kinds register through {@link registerBehaviourKind}, so apps can
 * add mechanisms without touching the core.
 */
import type { Behaviour } from "./behaviour.js";
import { DialBehaviour, type DialConfig } from "./dial.js";
import { GrabBehaviour, type GrabConfig, type GrabFulfilment } from "./grab.js";
import { HingeBehaviour, type HingeConfig } from "./hinge.js";
import { PressBehaviour, type PressConfig } from "./press.js";
import { PulseBehaviour, type PulseConfig } from "./pulse.js";
import { SlideBehaviour, type SlideConfig } from "./slide.js";
import { TossScoreBehaviour, type TossScoreConfig } from "./toss-score.js";

export type BehaviourConfig =
  | PressConfig
  | PulseConfig
  | HingeConfig
  | DialConfig
  | SlideConfig
  | GrabConfig
  | TossScoreConfig
  | (Record<string, unknown> & { kind: string });

export interface BehaviourFactoryContext {
  /** Grab fulfilment negotiated from the provider's capabilities. */
  grabFulfilment: GrabFulfilment;
}

type BehaviourFactory = (
  config: Record<string, unknown>,
  context: BehaviourFactoryContext,
) => Behaviour;

const registry = new Map<string, BehaviourFactory>();

export function registerBehaviourKind(kind: string, factory: BehaviourFactory): void {
  registry.set(kind, factory);
}

export function createBehaviour(
  config: BehaviourConfig,
  context: BehaviourFactoryContext,
): Behaviour {
  const factory = registry.get(config.kind);
  if (!factory) {
    throw new Error(`Unknown behaviour kind "${config.kind}"`);
  }
  return factory(config as Record<string, unknown>, context);
}

registerBehaviourKind("press", (c) => new PressBehaviour(c as Omit<PressConfig, "kind">));
registerBehaviourKind("pulse", (c) => new PulseBehaviour(c as Omit<PulseConfig, "kind">));
registerBehaviourKind("hinge", (c) => new HingeBehaviour(c as Omit<HingeConfig, "kind">));
registerBehaviourKind("dial", (c) => new DialBehaviour(c as Omit<DialConfig, "kind">));
registerBehaviourKind("slide", (c) => new SlideBehaviour(c as Omit<SlideConfig, "kind">));
registerBehaviourKind(
  "grab",
  (c, ctx) => new GrabBehaviour(c as Omit<GrabConfig, "kind">, ctx.grabFulfilment),
);
registerBehaviourKind("tossScore", (c) => {
  const config = c as unknown as TossScoreConfig;
  return new TossScoreBehaviour(config);
});
