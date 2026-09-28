import { describe, expect, it } from "vitest";
import {
  EYE_GAZE_SOURCE_ID,
  createPointerBridge,
  InteractionRuntime,
  rayPoseFromRay,
  type InputSourceSnapshot,
  type PointerSample,
} from "@realitycollective/webxr-interactions";
import { FakeHitTester, FakeProvider, raySource } from "./helpers.js";

describe("pointer bridge (UI Extensions coexistence)", () => {
  it("emits press-move-release from the sampled ray + select", () => {
    const provider = new FakeProvider();
    const runtime = new InteractionRuntime({ provider, hitTester: new FakeHitTester() });
    const bridge = createPointerBridge(runtime);
    const log: Array<{ phase: string; sample: PointerSample }> = [];
    bridge.source.onPress((sample) => log.push({ phase: "press", sample }));
    bridge.source.onMove((sample) => log.push({ phase: "move", sample }));
    bridge.source.onRelease((sample) => log.push({ phase: "release", sample }));

    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60);
    expect(log).toHaveLength(0);

    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    provider.sources = [
      raySource("right", { select: 1, ray: { origin: [0, 1.5, 0], direction: [0.1, 0, -1] } }),
    ];
    runtime.update(1 / 60);
    provider.sources = [raySource("right", { select: 0 })];
    runtime.update(1 / 60);

    expect(log.map((l) => l.phase)).toEqual(["press", "move", "release"]);
    expect(log[1]?.sample.direction[0]).toBeCloseTo(0.1);
    bridge.dispose();
  });

  it("a filtered-out source never drives the stream", () => {
    const provider = new FakeProvider();
    const runtime = new InteractionRuntime({ provider, hitTester: new FakeHitTester() });
    const bridge = createPointerBridge(runtime, (id) => id === "left");
    let presses = 0;
    bridge.source.onPress(() => presses++);
    provider.sources = [raySource("right", { select: 1 })];
    runtime.update(1 / 60);
    expect(presses).toBe(0);
    bridge.dispose();
  });

  it("a gaze source pressed by a pinch drives the stream, moving with the hand", () => {
    const provider = new FakeProvider();
    provider.setCapabilities({ eyeGaze: true });
    const hitTester = new FakeHitTester(true);
    const runtime = new InteractionRuntime({ provider, hitTester });
    runtime.registerInteractable({ id: "title", behaviours: [{ kind: "press" }] });
    hitTester.coneTarget = "title";
    hitTester.rayTarget = "title";
    const bridge = createPointerBridge(runtime);
    const log: Array<{ phase: string; sample: PointerSample }> = [];
    bridge.source.onPress((sample) => log.push({ phase: "press", sample }));
    bridge.source.onMove((sample) => log.push({ phase: "move", sample }));
    bridge.source.onRelease((sample) => log.push({ phase: "release", sample }));

    const eye = { origin: [0, 1.6, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
    const hand = rayPoseFromRay({ origin: [0.2, 1.2, -0.2], direction: [0, 0, -1] });
    const gaze = (overrides: Partial<InputSourceSnapshot> = {}): InputSourceSnapshot => ({
      id: EYE_GAZE_SOURCE_ID, kind: "gaze", handedness: "none", select: 0, squeeze: 0, ray: eye, ...overrides,
    });
    provider.sources = [gaze()];
    runtime.update(1 / 60);
    provider.sources = [gaze({ handedness: "right", select: 1, selectorPose: hand })];
    runtime.update(1 / 60);
    runtime.update(1 / 60);
    provider.sources = [gaze()];
    runtime.update(1 / 60);

    expect(log.map((l) => l.phase)).toEqual(["press", "move", "release"]);
    expect(log[0]?.sample.origin).toEqual(eye.origin);
    expect(log[1]?.sample.origin).toEqual(hand.position);
    bridge.dispose();
  });
});
