import { describe, expect, it } from "vitest";
import {
  Emitter,
  routeAudioToSink,
  routeHapticsToProvider,
  type FeedbackAudioSink,
  type FeedbackCue,
  type FeedbackIntent,
} from "@realitycollective/webxr-interactions";
import { FakeProvider } from "./helpers.js";

function intent(cue: FeedbackCue, overrides: Partial<FeedbackIntent> = {}): FeedbackIntent {
  return {
    cue,
    interactableId: "button",
    sourceId: "right-controller",
    intensity: 0.5,
    durationMs: 30,
    ...overrides,
  };
}

class RecordingSink implements FeedbackAudioSink {
  readonly played: Array<{ cueId: string; gain: number | undefined }> = [];

  play(cueId: string, options?: { gain?: number }): void {
    this.played.push({ cueId, gain: options?.gain });
  }
}

describe("routeAudioToSink", () => {
  it("plays the mapped cue at intensity times scale", () => {
    const emitter = new Emitter<FeedbackIntent>();
    const sink = new RecordingSink();
    routeAudioToSink((l) => emitter.subscribe(l), sink, { press: "click" });

    emitter.emit(intent("press"));
    expect(sink.played).toEqual([{ cueId: "click", gain: 0.5 }]);
  });

  it("ignores cues that are not in the map", () => {
    const emitter = new Emitter<FeedbackIntent>();
    const sink = new RecordingSink();
    routeAudioToSink((l) => emitter.subscribe(l), sink, { press: "click" });

    emitter.emit(intent("hover"));
    emitter.emit(intent("score"));
    expect(sink.played).toEqual([]);
  });

  it("caps gain at 1", () => {
    const emitter = new Emitter<FeedbackIntent>();
    const sink = new RecordingSink();
    routeAudioToSink((l) => emitter.subscribe(l), sink, { grab: "thud" }, 4);

    emitter.emit(intent("grab", { intensity: 0.8 }));
    expect(sink.played[0]?.gain).toBe(1);
  });

  it("stops on unsubscribe", () => {
    const emitter = new Emitter<FeedbackIntent>();
    const sink = new RecordingSink();
    const unsubscribe = routeAudioToSink((l) => emitter.subscribe(l), sink, { press: "click" });

    emitter.emit(intent("press"));
    unsubscribe();
    emitter.emit(intent("press"));
    expect(sink.played).toHaveLength(1);
  });
});

describe("routeHapticsToProvider", () => {
  it("forwards scaled intents to the provider", () => {
    const emitter = new Emitter<FeedbackIntent>();
    const provider = new FakeProvider();
    routeHapticsToProvider((l) => emitter.subscribe(l), provider, 2);

    emitter.emit(intent("actuate", { intensity: 0.3 }));
    expect(provider.pulses).toEqual([
      { sourceId: "right-controller", intensity: 0.6, durationMs: 30 },
    ]);
  });

  it("skips intents with no source and providers without haptics", () => {
    const emitter = new Emitter<FeedbackIntent>();
    const provider = new FakeProvider();
    routeHapticsToProvider((l) => emitter.subscribe(l), provider);

    emitter.emit({ cue: "dwellComplete", interactableId: "button", intensity: 1, durationMs: 50 });
    expect(provider.pulses).toEqual([]);

    provider.setCapabilities({ haptics: false });
    emitter.emit(intent("press"));
    expect(provider.pulses).toEqual([]);
  });
});
