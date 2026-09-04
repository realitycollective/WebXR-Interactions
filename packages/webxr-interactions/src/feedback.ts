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

/**
 * Whatever the client uses to play a sound. Deliberately tiny: an id the
 * client resolved to a buffer/sample of its own, and a gain. The core
 * never loads, decodes or owns audio.
 */
export interface FeedbackAudioSink {
  play(cueId: string, options?: { gain?: number }): void;
}

/**
 * Client opt-in: play a sound for the feedback intents named in `cueMap`.
 * Cues absent from the map are ignored, so an app sonifies only the
 * moments it has sounds for. Gain is the intent's intensity scaled by
 * `gainScale`, capped at 1. Returns the unsubscribe.
 */
export function routeAudioToSink(
  onFeedback: (listener: FeedbackListener) => Unsubscribe,
  sink: FeedbackAudioSink,
  cueMap: Partial<Record<FeedbackCue, string>>,
  gainScale = 1,
): Unsubscribe {
  return onFeedback((intent) => {
    const cueId = cueMap[intent.cue];
    if (cueId === undefined) return;
    sink.play(cueId, { gain: Math.min(1, intent.intensity * gainScale) });
  });
}
