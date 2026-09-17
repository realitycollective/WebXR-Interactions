import { describe, expect, it } from "vitest";
import {
  createPointerBridge,
  InteractionRuntime,
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
});
