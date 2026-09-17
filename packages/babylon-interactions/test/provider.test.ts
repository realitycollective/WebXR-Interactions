import { describe, expect, it } from "vitest";
import {
  BabylonInputProvider,
  DESKTOP_SOURCE_ID,
  POINTER_EVENT_TYPES,
  type InputCapabilities,
} from "@realitycollective/babylon-interactions";
import {
  FakeController,
  FakeExperience,
  FakeHandTracking,
  FakeNode,
  FakeScene,
  HALF_TURN_Y,
  fakeCamera,
  fakeHand,
  pointerInfo,
  ray,
} from "./helpers.js";

function setup(options: { desktopGripDistance?: number; rightHanded?: boolean } = {}) {
  const scene = new FakeScene();
  if (options.rightHanded) scene.useRightHandedSystem = true;
  const xr = new FakeExperience();
  const provider = new BabylonInputProvider({
    scene,
    xr,
    camera: fakeCamera([0, 1.6, 0]),
    ...(options.desktopGripDistance !== undefined
      ? { desktopGripDistance: options.desktopGripDistance }
      : {}),
  });
  return { scene, xr, provider };
}

describe("BabylonInputProvider capabilities", () => {
  it("reports head pose, gaze and the desktop pointer before a session", () => {
    const { provider } = setup();
    const caps = provider.getCapabilities();
    expect(caps.headPose).toBe(true);
    expect(caps.gaze).toBe(true);
    expect(caps.pointer2d).toBe(true);
    expect(caps.rays).toBe(false);
    // The pointer fallback synthesises a grip, so grab-driven behaviours
    // still negotiate off-headset.
    expect(caps.grabs).toBe("poseOnly");
  });

  it("derives capabilities from the live session and republishes them", () => {
    const { xr, provider } = setup();
    const seen: InputCapabilities[] = [];
    provider.onCapabilitiesChanged((c) => seen.push(c));
    xr.start(new FakeController({ handedness: "right", actuators: 1 }));

    const caps = provider.getCapabilities();
    expect(caps.rays).toBe(true);
    expect(caps.grabs).toBe("poseOnly");
    expect(caps.buttonsAxes).toBe(true);
    expect(caps.haptics).toBe(true);
    expect(caps.pointer2d).toBe(false);
    expect(seen.length).toBe(1);

    xr.end();
    expect(provider.getCapabilities().rays).toBe(false);
    expect(seen.length).toBe(2);
  });

  it("always reports poseOnly grabs because Babylon observes no native grab", () => {
    const { xr, provider } = setup();
    xr.start(new FakeController({ handedness: "left" }));
    expect(provider.getCapabilities().grabs).toBe("poseOnly");
  });

  it("gates pinch on the hand-tracking feature, not the hand flag", () => {
    const { xr, provider } = setup();
    const controller = new FakeController({ id: "left-hand", handedness: "left", hand: true });
    xr.start(controller);
    let caps = provider.getCapabilities();
    expect(caps.handJoints).toBe(true);
    expect(caps.pokes).toBe(true);
    expect(caps.pinch).toBe(false);

    const tracking = new FakeHandTracking();
    tracking.hands.set("left-hand", fakeHand());
    xr.handTracking = tracking;
    xr.onControllerAddedObservable.notify(controller);
    caps = provider.getCapabilities();
    expect(caps.pinch).toBe(true);
  });

  it("ignores a features manager that has none, and a feature of the wrong shape", () => {
    const { xr, provider } = setup();
    xr.featuresManagerPresent = false;
    xr.start(new FakeController({ handedness: "left", hand: true }));
    expect(provider.getCapabilities().pinch).toBe(false);

    xr.featuresManagerPresent = true;
    xr.handTracking = { notTheFeature: true } as never;
    xr.onControllerAddedObservable.notify(new FakeController());
    expect(provider.getCapabilities().pinch).toBe(false);
  });

  it("notifies source listeners when a controller comes or goes", () => {
    const { xr, provider } = setup();
    let calls = 0;
    const off = provider.onSourcesChanged(() => (calls += 1));
    xr.onControllerAddedObservable.notify(new FakeController());
    xr.onControllerRemovedObservable.notify(new FakeController());
    expect(calls).toBe(2);
    off();
    xr.onControllerAddedObservable.notify(new FakeController());
    expect(calls).toBe(2);
  });

  it("works with no XR experience at all", () => {
    const scene = new FakeScene();
    const provider = new BabylonInputProvider({ scene });
    expect(provider.getCapabilities().pointer2d).toBe(true);
    expect(provider.sample()).toEqual([]);
  });
});

describe("BabylonInputProvider sampling", () => {
  it("maps a controller: id, ray along +Z, grip, trigger and squeeze", () => {
    const { xr, provider } = setup();
    xr.start(
      new FakeController({
        id: "right-controller",
        handedness: "right",
        pointer: new FakeNode({ absolutePosition: [0, 1.5, 0], absoluteRotation: HALF_TURN_Y }),
        grip: new FakeNode({ absolutePosition: [0.1, 1.2, 0.3] }),
        trigger: { value: 0.6 },
        squeeze: { value: 0.4 },
        actuators: 1,
      }),
    );

    const [source] = provider.sample();
    expect(source?.id).toBe("right-controller");
    expect(source?.kind).toBe("controller");
    expect(source?.handedness).toBe("right");
    // Babylon's forward is +Z; a half turn about Y points it down -Z.
    expect(source?.ray?.origin).toEqual([0, 1.5, 0]);
    expect(source?.ray?.direction[2]).toBeCloseTo(-1);
    expect(source?.gripPose?.position).toEqual([0.1, 1.2, 0.3]);
    expect(source?.select).toBeCloseTo(0.6);
    expect(source?.squeeze).toBeCloseTo(0.4);
    expect(source?.hapticsAvailable).toBe(true);
  });

  it("falls back to the main component, and carries on the pointer with no grip", () => {
    const { xr, provider } = setup();
    xr.start(
      new FakeController({
        handedness: "none",
        pointer: new FakeNode({ absolutePosition: [1, 1, 1] }),
        trigger: null,
        main: { pressed: true },
      }),
    );
    const [source] = provider.sample();
    expect(source?.select).toBe(1);
    expect(source?.squeeze).toBe(0);
    expect(source?.handedness).toBe("none");
    expect(source?.gripPose?.position).toEqual([1, 1, 1]);
  });

  it("reads the index fingertip from the hand-tracking feature", () => {
    const { xr, provider } = setup();
    const tracking = new FakeHandTracking();
    tracking.hands.set(
      "left-hand",
      fakeHand({ indexTip: new FakeNode({ absolutePosition: [0.2, 1.1, -0.4] }) }),
    );
    xr.handTracking = tracking;
    xr.start(new FakeController({ id: "left-hand", handedness: "left", hand: true }));

    const [source] = provider.sample();
    expect(source?.kind).toBe("hand");
    expect(source?.indexTip).toEqual([0.2, 1.1, -0.4]);
  });

  it("leaves velocity to the core tracker", () => {
    const { xr, provider } = setup();
    xr.start(new FakeController({ handedness: "right" }));
    const [source] = provider.sample();
    expect(source && "linearVelocity" in source).toBe(false);
  });

  it("re-derives capabilities when a session ends between frames", () => {
    const { xr, provider } = setup();
    xr.start(new FakeController({ handedness: "right" }));
    expect(provider.sample().length).toBe(1);
    expect(provider.getCapabilities().rays).toBe(true);

    // No session-ended notification: the headset was taken off mid-frame.
    xr.session = null;
    xr.controllers = [];
    provider.sample();
    expect(provider.getCapabilities().rays).toBe(false);
    expect(provider.getCapabilities().pointer2d).toBe(true);
  });
});

describe("BabylonInputProvider desktop pointer", () => {
  it("tracks the primary button and reuses the pick Babylon already did", () => {
    const { scene, provider } = setup();
    scene.onPointerObservable.notify(
      pointerInfo(POINTER_EVENT_TYPES.move, { x: 10, y: 20, ray: ray([0, 1.6, 0], [0, 0, 1]) }),
    );
    let [source] = provider.sample();
    expect(source?.id).toBe(DESKTOP_SOURCE_ID);
    expect(source?.kind).toBe("pointer2d");
    expect(source?.handedness).toBe("none");
    expect(source?.ray?.origin).toEqual([0, 1.6, 0]);
    expect(source?.select).toBe(0);
    // The grip sits one metre along the ray by default, as on three.js.
    expect(source?.gripPose?.position).toEqual([0, 1.6, 1]);
    expect(scene.picks.length).toBe(0);

    scene.onPointerObservable.notify(pointerInfo(POINTER_EVENT_TYPES.down, { button: 0 }));
    [source] = provider.sample();
    expect(source?.select).toBe(1);
    expect(source?.squeeze).toBe(0);

    scene.onPointerObservable.notify(pointerInfo(POINTER_EVENT_TYPES.up, { button: 0 }));
    [source] = provider.sample();
    expect(source?.select).toBe(0);
  });

  it("ignores the secondary buttons", () => {
    const { scene, provider } = setup();
    scene.onPointerObservable.notify(
      pointerInfo(POINTER_EVENT_TYPES.move, { ray: ray([0, 0, 0], [0, 0, 1]) }),
    );
    scene.onPointerObservable.notify(pointerInfo(POINTER_EVENT_TYPES.down, { button: 2 }));
    const [source] = provider.sample();
    expect(source?.select).toBe(0);
  });

  it("falls back to the scene's forward axis when a pointer ray has no direction", () => {
    const { scene, provider } = setup({ rightHanded: true });
    scene.onPointerObservable.notify(
      pointerInfo(POINTER_EVENT_TYPES.move, { ray: { origin: { x: 0, y: 1, z: 0 }, direction: undefined } as never }),
    );
    const [source] = provider.sample();
    expect(source?.ray?.direction).toEqual([0, 0, -1]);
  });

  it("projects the grip along the ray when a distance is configured", () => {
    const { scene, provider } = setup({ desktopGripDistance: 2 });
    scene.onPointerObservable.notify(
      pointerInfo(POINTER_EVENT_TYPES.move, { ray: ray([0, 1, 0], [0, 0, 1]) }),
    );
    const [source] = provider.sample();
    expect(source?.gripPose?.position).toEqual([0, 1, 2]);
  });

  it("picks the scene at the last cursor position when no pick came with the event", () => {
    const { scene, provider } = setup();
    scene.pickResult = { hit: false, ray: ray([1, 2, 3], [0, 0, 1]) };
    scene.onPointerObservable.notify(pointerInfo(POINTER_EVENT_TYPES.move, { x: 40, y: 50 }));
    const [source] = provider.sample();
    expect(scene.picks).toEqual([[40, 50]]);
    expect(source?.ray?.origin).toEqual([1, 2, 3]);
  });

  it("reports no source when nothing can produce a ray", () => {
    const { provider } = setup();
    expect(provider.sample()).toEqual([]);
  });
});

describe("BabylonInputProvider haptics and presence", () => {
  it("pulses through the motion controller, clamping intensity", () => {
    const { xr, provider } = setup();
    const controller = new FakeController({ id: "right-controller", handedness: "right", actuators: 1 });
    xr.start(controller);
    provider.sample();
    expect(provider.pulse("right-controller", 2, 50)).toBe(true);
    expect(controller.pulses).toEqual([[1, 50]]);
    expect(provider.pulse("right-controller", -1, 10)).toBe(true);
    expect(controller.pulses[1]).toEqual([0, 10]);
  });

  it("finds a source that has not been sampled, and refuses one it cannot reach", () => {
    const { xr, provider } = setup();
    const controller = new FakeController({ id: "left-controller", handedness: "left" });
    xr.start(controller, new FakeController({ id: "silent", noMotionController: true }));
    expect(provider.pulse("left-controller", 0.5, 20)).toBe(true);
    expect(provider.pulse("silent", 0.5, 20)).toBe(false);
    expect(provider.pulse("absent", 0.5, 20)).toBe(false);
  });

  it("refuses to pulse a motion controller with no pulse method", () => {
    const { xr, provider } = setup();
    xr.start(new FakeController({ id: "old", handedness: "right", noPulse: true }));
    expect(provider.pulse("old", 0.5, 20)).toBe(false);
  });

  it("shows and hides the visuals Babylon built, per side", () => {
    const { xr, provider } = setup();
    const leftRoot = new FakeNode();
    const rightRoot = new FakeNode();
    xr.start(
      new FakeController({ id: "l", handedness: "left", rootMesh: leftRoot }),
      new FakeController({ id: "r", handedness: "right", rootMesh: rightRoot }),
    );
    expect(provider.getCapabilities().presence).toBe(true);
    expect(provider.setPresenceVisible("none", false)).toBe(true);

    expect(provider.setPresenceVisible("left", false)).toBe(true);
    expect(leftRoot.enabledWrites).toEqual([false]);
    expect(rightRoot.enabledWrites).toEqual([]);

    expect(provider.setPresenceVisible("all", true)).toBe(true);
    expect(leftRoot.enabledWrites).toEqual([false, true]);
    expect(rightRoot.enabledWrites).toEqual([true]);
  });

  it("counts the hand mesh as a visual and reports nothing to hide otherwise", () => {
    const { xr, provider } = setup();
    expect(provider.getCapabilities().presence).toBe(false);
    expect(provider.setPresenceVisible("none", false)).toBe(false);

    const handMesh = new FakeNode();
    const tracking = new FakeHandTracking();
    tracking.hands.set("left-hand", fakeHand({ handMesh }));
    xr.handTracking = tracking;
    xr.start(new FakeController({ id: "left-hand", handedness: "left", hand: true }));

    expect(provider.getCapabilities().presence).toBe(true);
    expect(provider.setPresenceVisible("right", false)).toBe(false);
    expect(provider.setPresenceVisible("left", false)).toBe(true);
    expect(handMesh.enabledWrites).toEqual([false]);
  });

  it("has no modality switch to offer", () => {
    const { provider } = setup();
    expect(provider.setPresenceModality("hands")).toBe(false);
    expect(provider.setPresenceModality("auto")).toBe(false);
  });
});

describe("BabylonInputProvider head pose and disposal", () => {
  it("reads the configured camera, then the scene's active one", () => {
    const { provider } = setup();
    expect(provider.getHeadPose().position).toEqual([0, 1.6, 0]);

    const scene = new FakeScene();
    scene.activeCamera = fakeCamera([1, 2, 3], HALF_TURN_Y);
    const fromScene = new BabylonInputProvider({ scene });
    expect(fromScene.getHeadPose().position).toEqual([1, 2, 3]);
    expect(fromScene.getHeadPose().quaternion).toEqual([0, 1, 0, 0]);
  });

  it("falls back to a camera's local position, then to the origin", () => {
    const scene = new FakeScene();
    const withLocal = new BabylonInputProvider({ scene, camera: { position: { x: 5, y: 0, z: 0 } } });
    expect(withLocal.getHeadPose().position).toEqual([5, 0, 0]);

    const withNone = new BabylonInputProvider({ scene: new FakeScene() });
    expect(withNone.getHeadPose()).toEqual({ position: [0, 0, 0], quaternion: [0, 0, 0, 1] });
  });

  it("detaches every observer it added", () => {
    const { scene, xr, provider } = setup();
    expect(scene.onPointerObservable.count).toBe(1);
    expect(xr.onXRSessionInit.count).toBe(1);
    expect(xr.onControllerAddedObservable.count).toBe(1);

    provider.dispose();
    expect(scene.onPointerObservable.count).toBe(0);
    expect(xr.onXRSessionInit.count).toBe(0);
    expect(xr.onXRSessionEnded.count).toBe(0);
    expect(xr.onControllerAddedObservable.count).toBe(0);
    expect(xr.onControllerRemovedObservable.count).toBe(0);
  });

  it("hands back a working unsubscribe from the capability subscription", () => {
    const { xr, provider } = setup();
    let calls = 0;
    const off = provider.onCapabilitiesChanged(() => (calls += 1));
    xr.start(new FakeController({ handedness: "right" }));
    expect(calls).toBe(1);
    off();
    xr.end();
    expect(calls).toBe(1);
  });
});
