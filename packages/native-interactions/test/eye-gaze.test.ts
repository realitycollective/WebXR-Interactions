/**
 * Binding cases for eye gaze on native: the provider derives `eyeGaze` from
 * the host's facts, feeds the core's `EyeGazeInput` with the host's gaze
 * pose, and hands the host nothing but a cone query to answer. Host cases
 * for the conformance kit, positive and negative, follow.
 */
import { describe, expect, it } from "vitest";
import { EYE_GAZE_SOURCE_ID, type InputSourceSnapshot } from "@realitycollective/webxr-input";
import {
  NativeHitTester,
  NativeInputProvider,
  createNativeInteractions,
  nativeInteractionsHostConformanceCases,
} from "@realitycollective/native-interactions";
import { copySnapshot } from "../src/native-types.js";
import { FakeInputHost, FakeInteractionHost, ReferenceInteractionHost } from "./helpers.js";

const HAND = (side: "left" | "right", select = 0): InputSourceSnapshot => ({
  id: `${side}-hand`,
  kind: "hand",
  handedness: side,
  select,
  squeeze: 0,
  ray: { origin: [side === "left" ? -0.2 : 0.2, 1.2, -0.2], direction: [0, 0, -1] },
  gripPose: { position: [0, 1.1, -0.2], quaternion: [0, 0, 0, 1] },
});

function gazeHost(options: { fact?: boolean; pose?: boolean } = {}) {
  const host = new FakeInputHost({ eyeGaze: options.pose !== false });
  host.eyeTracking = options.fact !== false;
  host.sources = [HAND("left"), HAND("right")];
  host.enterSession();
  return host;
}

function gazeOf(sources: readonly InputSourceSnapshot[]): InputSourceSnapshot | undefined {
  return sources.find((s) => s.kind === "gaze");
}

describe("NativeInputProvider eye gaze", () => {
  it("derives eyeGaze from the fact and a host that can pose the gaze, in a live session", () => {
    expect(new NativeInputProvider({ input: gazeHost() }).getCapabilities().eyeGaze).toBe(true);
    expect(new NativeInputProvider({ input: gazeHost({ fact: false }) }).getCapabilities().eyeGaze).toBe(false);
    expect(new NativeInputProvider({ input: gazeHost({ pose: false }) }).getCapabilities().eyeGaze).toBe(false);
    const idle = new FakeInputHost({ eyeGaze: true });
    idle.eyeTracking = true;
    expect(new NativeInputProvider({ input: idle }).getCapabilities().eyeGaze).toBe(false);
  });

  it("re-derives, and says so, when the fact changes", () => {
    const host = gazeHost({ fact: false });
    const provider = new NativeInputProvider({ input: host });
    let changes = 0;
    provider.onCapabilitiesChanged(() => changes++);
    host.eyeTracking = true;
    host.notifyFacts();
    expect(provider.getCapabilities().eyeGaze).toBe(true);
    expect(changes).toBe(1);
  });

  it("hands far targeting to gaze from the host's pose: hand rays drop, one gaze snapshot with a ray appears", () => {
    const sources = new NativeInputProvider({ input: gazeHost() }).sample();
    const gaze = gazeOf(sources)!;
    expect(gaze).toMatchObject({ id: EYE_GAZE_SOURCE_ID, handedness: "none", select: 0 });
    expect(gaze.ray).toEqual({ origin: [0, 1.6, 0], direction: [0, 0, -1] });
    for (const s of sources) if (s.kind === "hand") expect(s.ray).toBeUndefined();
    for (const s of sources) if (s.kind === "hand") expect(s.gripPose).toBeDefined();
  });

  it("keeps far targeting with the hands while the host has no valid pose", () => {
    const host = gazeHost();
    host.eyeGazePose = null;
    const sources = new NativeInputProvider({ input: host }).sample();
    expect(gazeOf(sources)).toBeUndefined();
    expect(sources.every((s) => s.ray !== undefined)).toBe(true);
  });

  it("commits a selection to the pinching hand, with a selector pose built from its ray", () => {
    const host = gazeHost();
    const provider = new NativeInputProvider({ input: host });
    provider.sample();
    host.sources = [HAND("left"), HAND("right", 1)];
    const gaze = gazeOf(provider.sample())!;
    expect(gaze.handedness).toBe("right");
    expect(gaze.select).toBe(1);
    expect(gaze.selectorPose?.position).toEqual([0.2, 1.2, -0.2]);
    expect(gaze.selectorPose?.quaternion.map((n) => n + 0)).toEqual([0, 0, 0, 1]);
  });

  it("takes the first ray a side reports for the selector pose when a side has two sources", () => {
    const host = gazeHost();
    host.sources = [HAND("right"), { id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0, ray: { origin: [9, 9, 9], direction: [0, 0, -1] } }];
    const provider = new NativeInputProvider({ input: host });
    provider.sample();
    host.sources = [HAND("right", 1), { id: "right-controller", kind: "controller", handedness: "right", select: 0, squeeze: 0, ray: { origin: [9, 9, 9], direction: [0, 0, -1] } }];
    expect(gazeOf(provider.sample())!.selectorPose?.position).toEqual([0.2, 1.2, -0.2]);
  });

  it("copySnapshot copies a selector pose into fresh tuples", () => {
    const source: InputSourceSnapshot = { ...HAND("right", 1), selectorPose: { position: [1, 2, 3], quaternion: [0, 0, 0, 1] } };
    const copy = copySnapshot(source);
    expect(copy.selectorPose).toEqual(source.selectorPose);
    expect(copy.selectorPose).not.toBe(source.selectorPose);
    expect(copy.selectorPose!.position).not.toBe(source.selectorPose!.position);
  });

  it("copies the host pose and the selector pose, never referencing the host tuples", () => {
    const host = gazeHost();
    const provider = new NativeInputProvider({ input: host });
    provider.sample();
    host.sources = [HAND("right", 1)];
    const gaze = gazeOf(provider.sample())!;
    expect(gaze.selectorPose!.position).not.toBe(host.sources[0]!.ray!.origin);
    host.eyeGazePose!.position[0] = 9;
    expect(gaze.ray!.origin[0]).toBe(0);
  });

  it("integrates the filter and grace over the frame delta, set by the setup's update", () => {
    const host = gazeHost();
    const setup = createNativeInteractions({ input: host, interactions: new FakeInteractionHost() });
    setup.update(1 / 60);
    host.eyeGazePose = null;
    setup.update(6);
    const sources = setup.provider.sample();
    expect(gazeOf(sources)).toBeUndefined();
    setup.dispose();
  });

  it("forgets the gaze state when focus is lost or the fact goes", () => {
    const host = gazeHost();
    const provider = new NativeInputProvider({ input: host });
    provider.sample();
    host.exitSession();
    expect(provider.sample()).toEqual([]);
    host.enterSession();
    host.eyeTracking = false;
    host.notifyFacts();
    expect(gazeOf(provider.sample())).toBeUndefined();
    provider.dispose();
  });
});

describe("NativeHitTester.hitCone", () => {
  it("is present only when the host answers the cone, and forwards a copy", () => {
    const plain = new NativeHitTester({ interactions: new FakeInteractionHost() });
    expect(plain.hitCone).toBeUndefined();
    const host = new ReferenceInteractionHost();
    host.placeTarget("near", [0.15, 0, -2], 0.1);
    const tester = new NativeHitTester({ interactions: host });
    const ray = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
    const hit = tester.hitCone!(ray, (5 * Math.PI) / 180, 30)!;
    expect(hit.interactableId).toBe("near");
    expect(tester.hitCone!(ray, (5 * Math.PI) / 180, 30)!.point).not.toBe(hit.point);
  });
});

describe("the host conformance kit's eye-gaze cases", () => {
  const cases = nativeInteractionsHostConformanceCases();
  const poseCase = cases.find((c) => c.name.includes("poses the gaze"))!;
  const coneCase = cases.find((c) => c.name.includes("cone query never answers with a hidden target"))!;

  function reference(options: { fact?: boolean; pose?: boolean; poseNull?: boolean } = {}) {
    const input = gazeHost(options);
    if (options.poseNull) input.eyeGazePose = null;
    const interactions = new ReferenceInteractionHost(input);
    return { input, interactions, testHost: interactions };
  }

  it("pass on the reference host, and pass without running on a host without eye tracking", async () => {
    await expect(poseCase.run(reference())).resolves.toBeUndefined();
    await expect(coneCase.run(reference())).resolves.toBeUndefined();
    await expect(poseCase.run(reference({ fact: false }))).resolves.toBeUndefined();
  });

  it("fail a host that reports eye tracking outside a live, focused session", async () => {
    const input = new FakeInputHost({ eyeGaze: true });
    input.eyeTracking = true;
    const interactions = new ReferenceInteractionHost(input);
    await expect(poseCase.run({ input, interactions, testHost: interactions })).rejects.toThrow(/is the session focused/);
  });

  it("fail a host whose gaze pose does not hold for the frame the binding samples", async () => {
    const input = gazeHost();
    let calls = 0;
    input.getEyeGazePose = () => (calls++ === 0 ? { position: [0, 1.6, 0], quaternion: [0, 0, 0, 1] } : null);
    const interactions = new ReferenceInteractionHost(input);
    await expect(poseCase.run({ input, interactions, testHost: interactions })).rejects.toThrow(/one gaze snapshot with a ray/);
  });

  it("pass without running the cone case on a host that answers no cone", async () => {
    const setup = reference();
    const plain = new FakeInteractionHost();
    await expect(coneCase.run({ input: setup.input, interactions: plain, testHost: setup.testHost })).resolves.toBeUndefined();
  });

  it("fail a host that reports eye tracking but cannot pose the gaze", async () => {
    await expect(poseCase.run(reference({ pose: false }))).rejects.toThrow(/no getEyeGazePose/);
    await expect(poseCase.run(reference({ poseNull: true }))).rejects.toThrow(/returned null/);
  });

  it("fail a host whose cone query answers with a hidden target", async () => {
    const setup = reference();
    const broken = new (class extends ReferenceInteractionHost {
      override setTargetVisible(): void {}
    })(setup.input);
    await expect(coneCase.run({ input: setup.input, interactions: broken, testHost: broken })).rejects.toThrow(/hidden target/);
  });

  it("fail a host whose cone query cannot find a target beside the ray", async () => {
    const setup = reference();
    const blind = new (class extends ReferenceInteractionHost {
      override hitCone(): null {
        return null;
      }
    })(setup.input);
    await expect(coneCase.run({ input: setup.input, interactions: blind, testHost: blind })).rejects.toThrow(/was not found/);
  });
});
