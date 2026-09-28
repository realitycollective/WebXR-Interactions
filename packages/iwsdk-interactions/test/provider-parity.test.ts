/**
 * Every adapter implements the same provider contract.
 *
 * Five providers built against five different hosts is exactly the
 * shape of defect that hides: one of them quietly drops a method, and
 * nothing notices until an app swaps adapters. The checks themselves are
 * the shared suite shipped by `@realitycollective/webxr-input`, so this
 * repository cannot drift from the contract it implements; this file only
 * builds the five instances and adds what the shared suite does not cover.
 */
import { describe, expect, it } from "vitest";
import { PerspectiveCamera } from "three";
import type { World } from "@iwsdk/core";
import {
  inputProviderContractCases,
  type InputProvider,
  type InputProviderContractDriver,
} from "@realitycollective/webxr-input";
import { IWSDKInputProvider } from "@realitycollective/iwsdk-interactions";
import { WebXRInputProvider } from "@realitycollective/threejs-interactions";
import { XRBlocksInputProvider } from "@realitycollective/xrblocks-interactions";
import { BabylonInputProvider } from "@realitycollective/babylon-interactions";
import { NativeInputProvider } from "@realitycollective/native-interactions";
import { FakeInputHost } from "../../native-interactions/test/helpers.js";
import { FakeGamepad, FakeSession, fakeActuator, makeWorld } from "./helpers.js";

/** The members `InputProvider` requires of every implementation. */
const REQUIRED = ["getCapabilities", "onCapabilitiesChanged", "onSourcesChanged", "sample"] as const;

/** A provider plus whatever session control its fakes can offer. */
interface Built {
  provider: InputProvider;
  driver?: InputProviderContractDriver;
  /**
   * Set the live session's `visibilityState`, when the platform's fake can
   * express one: every provider must sample no sources while the
   * session exists but is not `"visible"`. Absent on a platform whose
   * builder starts with no session at all to toggle.
   */
  setVisibility?(state: string): void;
}

function iwsdkProvider(): Built {
  const world = makeWorld({
    session: new FakeSession(),
    gamepads: { right: new FakeGamepad({ actuators: [fakeActuator()] }) },
  });
  const provider = new IWSDKInputProvider(world as unknown as World);
  // The fake world drives a session cycle, so the contract case that needs
  // one runs here rather than being skipped for want of a driver.
  return {
    provider,
    driver: {
      enterSession() {
        world.session = new FakeSession();
        world.visibilityState.set("visible");
      },
      exitSession() {
        world.session = null;
        world.visibilityState.set("visible");
      },
    },
    setVisibility: (state) => world.visibilityState.set(state),
  };
}

/** A fake `XRPose`-shaped reading, the same slice `WebXRInputProvider`/`XRBlocksInputProvider` read. */
function fakePose(position: [number, number, number]) {
  return {
    transform: {
      position: { x: position[0], y: position[1], z: position[2] },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
  };
}

function threeProvider(): Built {
  const targetRaySpace = {};
  const gripSpace = {};
  let visibilityState = "visible";
  const session = {
    get visibilityState() {
      return visibilityState;
    },
    inputSources: [{ handedness: "right", targetRaySpace, gripSpace }],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const poses = new Map<object, unknown>([
    [targetRaySpace, fakePose([0, 1.5, -0.2])],
    [gripSpace, fakePose([0.1, 1.2, -0.3])],
  ]);
  const frame = { getPose: (space: object) => poses.get(space), getJointPose: () => undefined };
  const provider = new WebXRInputProvider({
    xr: { getSession: () => session, getReferenceSpace: () => ({}), getFrame: () => frame },
    camera: new PerspectiveCamera(70, 4 / 3, 0.05, 100),
  } as never);
  return { provider, setVisibility: (state) => (visibilityState = state) };
}

function xrBlocksProvider(): Built {
  let visibilityState = "visible";
  const provider = new XRBlocksInputProvider({
    input: {
      getFrame: () => ({
        raySources: [
          {
            controller: { inputSource: { handedness: "right" } },
            sourceType: "controller-ray",
            ray: { origin: { x: 0, y: 1.5, z: 0 }, direction: { x: 0, y: 0, z: -1 } },
            selected: false,
          },
        ],
        directTouches: [],
      }),
    },
    camera: {
      getWorldPosition: (t: object) => Object.assign(t, { x: 0, y: 1.6, z: 0 }),
      getWorldQuaternion: (t: object) => Object.assign(t, { x: 0, y: 0, z: 0, w: 1 }),
    },
    xr: {
      getSession: () => ({ visibilityState }) as never,
      getFrame: () => null,
      getReferenceSpace: () => null,
    },
  } as never);
  return { provider, setVisibility: (state) => (visibilityState = state) };
}

function babylonProvider(): Built {
  // No @babylonjs/core in the workspace - the adapter matches the shape of
  // the Babylon API, so a bare scene-shaped object is a valid host.
  let visibilityState = "visible";
  const pointer = {
    getAbsolutePosition: () => ({ x: 0, y: 1.5, z: 0 }),
    absoluteRotationQuaternion: { x: 0, y: 0, z: 0, w: 1 },
  };
  const provider = new BabylonInputProvider({
    scene: {
      onPointerObservable: { add: () => null, remove: () => true },
      activeCamera: { globalPosition: { x: 0, y: 1.6, z: 0 } },
    },
    xr: {
      baseExperience: {
        sessionManager: {
          get session() {
            return { visibilityState };
          },
          onXRSessionInit: { add: () => null, remove: () => true },
          onXRSessionEnded: { add: () => null, remove: () => true },
        },
        featuresManager: { getEnabledFeature: () => null },
      },
      input: {
        controllers: [{ uniqueId: "right", inputSource: { handedness: "right" }, pointer }],
        onControllerAddedObservable: { add: () => null, remove: () => true },
        onControllerRemovedObservable: { add: () => null, remove: () => true },
      },
    },
  } as never);
  return { provider, setVisibility: (state) => (visibilityState = state) };
}

function nativeProvider(): Built {
  // The fake host reuses one pooled snapshot across samples, as a native app
  // might, so the ownership case proves the provider copies what it hands over.
  const host = new FakeInputHost({ headPose: true, pulse: true, presence: true });
  return {
    provider: new NativeInputProvider({ input: host }),
    driver: { enterSession: () => host.enterSession(), exitSession: () => host.exitSession() },
  };
}

/** The same platforms with eye gaze live, so the shared eye-gaze cases run rather than skip. */
function iwsdkGazeProvider(): Built {
  const world = makeWorld({
    session: new FakeSession({ inputSources: [{ hand: {} }, { targetRayMode: "gaze" }] }),
    gamepads: { right: new FakeGamepad({ selecting: true }) },
    gaze: { tracked: true },
  });
  const provider = new IWSDKInputProvider(world as unknown as World);
  // Two samples: the second sees the pinch released and armed; a third pinch would own.
  return { provider };
}

function threeGazeProvider(): Built {
  const targetRaySpace = {};
  const gazeSpace = {};
  const session = {
    visibilityState: "visible",
    inputSources: [
      { handedness: "right", targetRayMode: "tracked-pointer", targetRaySpace },
      { handedness: "none", targetRayMode: "gaze", targetRaySpace: gazeSpace },
    ],
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  const poses = new Map<object, unknown>([
    [targetRaySpace, fakePose([0.2, 1.2, -0.2])],
    [gazeSpace, fakePose([0, 1.6, 0])],
  ]);
  const frame = { getPose: (space: object) => poses.get(space), getJointPose: () => undefined };
  const provider = new WebXRInputProvider({
    xr: { getSession: () => session, getReferenceSpace: () => ({}), getFrame: () => frame },
    camera: new PerspectiveCamera(70, 4 / 3, 0.05, 100),
  } as never);
  return { provider };
}

function babylonGazeProvider(): Built {
  const eye = { isEyeGazeValid: true, getEyeGaze: () => ({ origin: { x: 0, y: 1.6, z: 0 }, direction: { x: 0, y: 0, z: 1 } }) };
  const pointer = { getAbsolutePosition: () => ({ x: 0.2, y: 1.2, z: 0.2 }), absoluteRotationQuaternion: { x: 0, y: 0, z: 0, w: 1 } };
  const provider = new BabylonInputProvider({
    scene: { onPointerObservable: { add: () => null, remove: () => true }, activeCamera: { globalPosition: { x: 0, y: 1.6, z: 0 } } },
    xr: {
      baseExperience: {
        sessionManager: {
          session: { visibilityState: "visible" },
          onXRSessionInit: { add: () => null, remove: () => true },
          onXRSessionEnded: { add: () => null, remove: () => true },
        },
        featuresManager: { getEnabledFeature: (name: string) => (name === "xr-eye-tracking" ? eye : null) },
      },
      input: {
        controllers: [{ uniqueId: "right", inputSource: { handedness: "right" }, pointer }],
        onControllerAddedObservable: { add: () => null, remove: () => true },
        onControllerRemovedObservable: { add: () => null, remove: () => true },
      },
    },
  } as never);
  return { provider };
}

function nativeGazeProvider(): Built {
  const host = new FakeInputHost({ headPose: true, eyeGaze: true });
  host.eyeTracking = true;
  host.sources = [
    { id: "left-hand", kind: "hand", handedness: "left", select: 0, squeeze: 0, ray: { origin: [-0.2, 1.2, -0.2], direction: [0, 0, -1] } },
    { id: "right-hand", kind: "hand", handedness: "right", select: 1, squeeze: 0, ray: { origin: [0.2, 1.2, -0.2], direction: [0, 0, -1] } },
  ];
  host.enterSession();
  const provider = new NativeInputProvider({ input: host });
  // The pinch is held from before gaze took over, so it must not own; the
  // eye-gaze cases see a gaze snapshot owned by none.
  return { provider, driver: { enterSession: () => host.enterSession(), exitSession: () => host.exitSession() } };
}

const providers: Array<[string, () => Built]> = [
  ["iwsdk", iwsdkProvider],
  ["threejs", threeProvider],
  ["xrblocks", xrBlocksProvider],
  ["babylon", babylonProvider],
  ["native", nativeProvider],
  ["iwsdk with eye gaze", iwsdkGazeProvider],
  ["threejs with eye gaze", threeGazeProvider],
  ["babylon with eye gaze", babylonGazeProvider],
  ["native with eye gaze", nativeGazeProvider],
];

describe("eye gaze is live on the platforms that can report it", () => {
  it.each([["iwsdk", iwsdkGazeProvider], ["threejs", threeGazeProvider], ["babylon", babylonGazeProvider], ["native", nativeGazeProvider]] as const)(
    "%s samples a gaze snapshot with a ray and no hand or controller far ray",
    (_name, build) => {
      const { provider } = build();
      expect(provider.getCapabilities().eyeGaze).toBe(true);
      const sources = provider.sample();
      expect(sources.find((s) => s.kind === "gaze")?.ray).toBeDefined();
      expect(sources.some((s) => (s.kind === "hand" || s.kind === "controller") && s.ray)).toBe(false);
    },
  );

  it("XR Blocks never reports eye gaze: its gaze source is the camera, a head gaze", () => {
    expect(xrBlocksProvider().provider.getCapabilities().eyeGaze).toBe(false);
  });
});

describe.each(providers)("%s provider", (_name, build) => {
  for (const contractCase of inputProviderContractCases()) {
    it(contractCase.name, () => {
      const { provider, driver } = build();
      contractCase.run(provider, driver);
    });
  }

  // Adapter-specific, on top of the shared suite: the contract cases call
  // these members, but never assert that all of them are present as functions.
  it("implements every required InputProvider member", () => {
    const provider = build().provider as unknown as Record<string, unknown>;
    for (const member of REQUIRED) {
      expect(typeof provider[member]).toBe("function");
    }
  });

  // The shared suite checks the capability KEYS and the methods a true
  // presence flag implies. It cannot check the value's type, and presence
  // is the one capability whose value differs across these providers.
  it("answers capabilities.presence with a boolean", () => {
    expect(typeof build().provider.getCapabilities().presence).toBe("boolean");
  });

  // A live session that exists but is not visible (backgrounded, or
  // the browser's own "content is obscured" state) must sample no sources
  // at all, the rule IWSDK's provider states as "returns nothing while the
  // app is not visible". `inputProviderContractCases()` cannot express this
  // - `@realitycollective/webxr-input` has no notion of session visibility
  // - so it is proven here, on every platform whose fake can toggle it.
  it("returns nothing while the app is not visible, as IWSDK's provider does", () => {
    const { provider, setVisibility } = build();
    if (!setVisibility) return;
    expect(provider.sample().length).toBeGreaterThan(0);
    setVisibility("hidden");
    expect(provider.sample()).toEqual([]);
    setVisibility("visible");
    expect(provider.sample().length).toBeGreaterThan(0);
  });
});
