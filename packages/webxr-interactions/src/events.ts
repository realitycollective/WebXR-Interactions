/**
 * Interaction events - THE only outbound pathway from the interaction core.
 *
 * The Pale Signal research showed what happens when events are optional:
 * consumers bypass them and subscribe to raw engine tags, and the same
 * input ends up with two independent listeners. Here, adapters feed input
 * IN through `@realitycollective/webxr-input`, and everything downstream
 * (gameplay, UI, feedback) subscribes to these events OUT. No side doors.
 */
import type { Unsubscribe } from "@realitycollective/webxr-input";

export type InteractionEventType =
  | "hoverEnter"
  | "hoverExit"
  | "dwellProgress" // gaze-dwell fill 0..1 (value); 1 fires the press
  | "pressStart"
  | "pressEnd"
  | "actuated" // logical value crossed into the actuated state
  | "released"
  | "valueChanged" // analog 0..1 (dead-banded)
  | "grabStart"
  | "grabEnd"
  | "scored" // toss passed through a hoop
  | "behaviourEnabled"
  | "behaviourDisabled"
  | "interactableEnabled"
  | "interactableDisabled";

export interface InteractionEvent {
  type: InteractionEventType;
  /** The target interactable. */
  interactableId: string;
  /** The behaviour that produced the event, when behaviour-scoped. */
  behaviourKind?: string;
  /** The input source/interactor involved, when input-scoped. */
  interactorId?: string;
  /** Analog payload (valueChanged, dwellProgress) or 1/0 for digital. */
  value?: number;
  /** Why a behaviour was disabled (unmet capability requirements). */
  reason?: string;
}

export type InteractionEventListener = (event: InteractionEvent) => void;

/** Minimal synchronous emitter (insertion-ordered, unsubscribe-safe). */
export class Emitter<T> {
  private listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  get size(): number {
    return this.listeners.size;
  }
}
