/**
 * Feedback hooks - haptics/audio stay OUT of the framework; the client
 * implements them. Behaviours emit *intents* describing the physical
 * moment ("this press just actuated, a short strong pulse would fit");
 * the client subscribes and realises them however it likes (haptic pulse
 * on controllers, an audio cue, both, neither).
 *
 * `routeHapticsToProvider` is the one convenience the framework offers -
 * an explicit opt-in the client calls, never an automatic behaviour.
 */
import type { InputProvider, Unsubscribe } from "@realitycollective/webxr-input";

/** A named moment a client may want to sonify/hapticise. */
export type FeedbackCue =
  | "hover"
  | "press"
  | "actuate"
  | "release"
  | "grab"
  | "drop"
  | "score"
  | "dwellComplete"
  | "valueTick"; // discrete steps on analog controls (dial detents etc.)

export interface FeedbackIntent {
  cue: FeedbackCue;
  interactableId: string;
  behaviourKind?: string;
  /** The input source that caused the moment - haptics target this. */
  sourceId?: string;
  /** Suggested haptic intensity 0..1 (clients may remap freely). */
  intensity: number;
  /** Suggested haptic duration in ms. */
  durationMs: number;
}

export type FeedbackListener = (intent: FeedbackIntent) => void;

/**
 * Client opt-in: forward the haptic half of feedback intents to the input
 * provider's `pulse` (which no-ops on sources without actuators - hands).
 * Returns the unsubscribe. Audio remains entirely the client's concern.
 */
export function routeHapticsToProvider(
  onFeedback: (listener: FeedbackListener) => Unsubscribe,
  provider: InputProvider,
  scale = 1,
): Unsubscribe {
  return onFeedback((intent) => {
    if (!intent.sourceId) return;
    if (!provider.getCapabilities().haptics) return;
    provider.pulse?.(intent.sourceId, Math.min(1, intent.intensity * scale), intent.durationMs);
  });
}
