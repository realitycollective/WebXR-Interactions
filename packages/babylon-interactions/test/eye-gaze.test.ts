/**
 * Binding cases for eye gaze on Babylon.js: the provider reads the
 * `xr-eye-tracking` feature when the app enabled it and feeds the core's
 * `EyeGazeInput`; the hit tester answers the cone over its spheres.
 */
import { describe, expect, it } from "vitest";
import { EYE_GAZE_SOURCE_ID, type InputSourceSnapshot } from "@realitycollective/webxr-input";
import { BabylonHitTester, BabylonInputProvider } from "@realitycollective/babylon-interactions";

interface FakeEyeTracking {
  isEyeGazeValid: boolean;
  gaze: { origin: { x: number; y: number; z: number }; direction: { x: number; y: number; z: number } } | null;
  getEyeGaze(): FakeEyeTracking["gaze"];
}

function build(options: { eye?: boolean; valid?: boolean; gaze?: boolean; trigger?: number } = {}) {
  const eye: FakeEyeTracking = {
    isEyeGazeValid: options.valid !== false,
    gaze: options.gaze === false ? null : { origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
    getEyeGaze() {
      return this.gaze;
    },
  };
  let visibilityState = "visible";
  const trigger = { value: options.trigger ?? 0 };
  const pointer = {
    getAbsolutePosition: () => ({ x: 0.2, y: 1.2, z: 0.2 }),
    absoluteRotationQuaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  const controller = {
    uniqueId: "right-controller",
    inputSource: { handedness: "right" },
    pointer,
    motionController: { getComponentOfType: () => trigger, getMainComponent: () => trigger },
  };
  const provider = new BabylonInputProvider({
    scene: { onPointerObservable: { add: () => null, remove: () => true }, activeCamera: { globalPosition: { x: 0, y: 1.6, z: 0 } } },
    xr: {
      baseExperience: {
        sessionManager: {
          get session() {
            return { visibilityState };
          },
          onXRSessionInit: { add: () => null, remove: () => true },
          onXRSessionEnded: { add: () => null, remove: () => true },
        },
        featuresManager: { getEnabledFeature: (name: string) => (name === "xr-eye-tracking" && options.eye !== false ? eye : null) },
      },
      input: {
        controllers: [controller],
        onControllerAddedObservable: { add: () => null, remove: () => true },
        onControllerRemovedObservable: { add: () => null, remove: () => true },
      },
    },
  } as never);
  return { provider, eye, trigger, setVisibility: (v: string) => (visibilityState = v) };
}

function gazeOf(sources: readonly InputSourceSnapshot[]): InputSourceSnapshot | undefined {
  return sources.find((s) => s.kind === "gaze");
}

describe("BabylonInputProvider eye gaze", () => {
  it("reports eyeGaze while the eye-tracking feature is enabled in a live session", () => {
    expect(build().provider.getCapabilities().eyeGaze).toBe(true);
    expect(build({ eye: false }).provider.getCapabilities().eyeGaze).toBe(false);
  });

  it("builds the gaze pose from the feature's ray (Babylon's +Z forward) and hands far targeting to it", () => {
    const sources = build().provider.sample();
    const gaze = gazeOf(sources)!;
    expect(gaze).toMatchObject({ id: EYE_GAZE_SOURCE_ID, handedness: "none" });
    expect(gaze.ray!.origin).toEqual([0, 1.6, 0]);
    expect(gaze.ray!.direction[2]).toBeCloseTo(1, 9);
    expect(sources.find((s) => s.kind === "controller")!.ray).toBeUndefined();
  });

  it("keeps far targeting with the controller while the gaze is invalid or absent", () => {
    for (const options of [{ valid: false }, { gaze: false }]) {
      const sources = build(options).provider.sample();
      expect(gazeOf(sources)).toBeUndefined();
      expect(sources.find((s) => s.kind === "controller")!.ray).toBeDefined();
    }
  });

  it("commits a selection to the controller's trigger and carries a selector pose built from its ray", () => {
    const { provider, trigger } = build();
    provider.sample();
    trigger.value = 1;
    const gaze = gazeOf(provider.sample())!;
    expect(gaze.handedness).toBe("right");
    expect(gaze.selectorPose?.position).toEqual([0.2, 1.2, 0.2]);
  });

  it("integrates over the delta the host sets, and forgets while hidden", () => {
    const { provider, eye, setVisibility } = build();
    provider.sample();
    eye.gaze = null;
    provider.setFrameDelta(6);
    expect(gazeOf(provider.sample())).toBeUndefined();
    setVisibility("hidden");
    expect(provider.sample()).toEqual([]);
    provider.dispose();
  });
});

describe("BabylonHitTester.hitCone", () => {
  const DOWN = { origin: [0, 0, 0] as [number, number, number], direction: [0, 0, -1] as [number, number, number] };
  const DEG = Math.PI / 180;
  const node = (x: number, y: number, z: number) => ({ getAbsolutePosition: () => ({ x, y, z }) });

  it("finds a sphere the ray misses inside the cone, and skips one outside", () => {
    const tester = new BabylonHitTester();
    tester.register("near", node(0.15, 0, -2) as never, 0.1);
    tester.register("wide", node(1, 0, -2) as never, 0.1);
    expect(tester.hitRay(DOWN)).toBeNull();
    expect(tester.hitCone(DOWN, 5 * DEG, 30)?.interactableId).toBe("near");
  });

  it("with an app pick, a mesh the ray reaches wins first", () => {
    const mesh = node(0.6, 0, -1);
    const tester = new BabylonHitTester({ pickWithRay: () => ({ mesh: mesh as never, distance: 1, point: [0.6, 0, -1] }) });
    tester.register("picked", mesh as never, 0.1);
    tester.register("near", node(0.15, 0, -2) as never, 0.1);
    expect(tester.hitCone(DOWN, 5 * DEG, 30)?.interactableId).toBe("picked");
    tester.setPickWithRay(() => null);
    expect(tester.hitCone(DOWN, 5 * DEG, 30)?.interactableId).toBe("near");
  });
});
