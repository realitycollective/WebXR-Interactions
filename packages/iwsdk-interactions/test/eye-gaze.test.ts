/**
 * Binding cases for eye gaze on IWSDK: the provider reports `eyeGaze` from
 * the session's gaze source, reads IWSDK's own sampled eye pose, and hands
 * far targeting to gaze exactly when IWSDK's `GazePointer` does. The rule
 * itself is the core's `EyeGazeInput`; these prove the binding feeds it.
 */
import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { InputComponent, type World } from "@iwsdk/core";
import { EYE_GAZE_SOURCE_ID, type InputSourceSnapshot } from "@realitycollective/webxr-input";
import { IWSDKInputProvider, registerInteractions } from "@realitycollective/iwsdk-interactions";
import type { Entity } from "@iwsdk/core";
import { FakeGamepad, FakeSession, makeWorld, type FakeWorld } from "./helpers.js";

const DT = 1 / 72;

function gazeSession(): FakeSession {
  return new FakeSession({ enabledFeatures: ["hand-tracking", "gaze-tracking"], inputSources: [{ hand: {} }, { targetRayMode: "gaze" }] });
}

function gazeWorld(tracked = true, right = new FakeGamepad()) {
  const world = makeWorld({ session: gazeSession(), gamepads: { left: new FakeGamepad(), right }, gaze: { tracked } });
  world.playerSpaceEntities.raySpaces.right.object3D!.position.set(0.2, 1.2, -0.2);
  world.playerSpaceEntities.raySpaces.right.object3D!.updateMatrixWorld(true);
  return world;
}

function provider(world: FakeWorld): IWSDKInputProvider {
  return new IWSDKInputProvider(world as unknown as World);
}

function gazeOf(sources: readonly InputSourceSnapshot[]): InputSourceSnapshot | undefined {
  return sources.find((s) => s.kind === "gaze");
}

describe("IWSDKInputProvider eye gaze", () => {
  it("reports eyeGaze only while the session carries a gaze input source", () => {
    expect(provider(gazeWorld()).getCapabilities().eyeGaze).toBe(true);
    const plain = makeWorld({ session: new FakeSession({ inputSources: [{ hand: {} }] }), gaze: { tracked: true } });
    expect(provider(plain).getCapabilities().eyeGaze).toBe(false);
    expect(provider(makeWorld({ session: null })).getCapabilities().eyeGaze).toBe(false);
  });

  it("finds a gaze source a runtime lists only in trackedSources", () => {
    const session = new FakeSession({ inputSources: [{ hand: {} }] });
    (session as unknown as { trackedSources: unknown[] }).trackedSources = [{ targetRayMode: "gaze" }];
    expect(provider(makeWorld({ session })).getCapabilities().eyeGaze).toBe(true);
  });

  it("re-derives eyeGaze when the sources change", () => {
    const session = new FakeSession({ inputSources: [{ hand: {} }] });
    const world = makeWorld({ session });
    const p = provider(world);
    expect(p.getCapabilities().eyeGaze).toBe(false);
    session.inputSources.push({ targetRayMode: "gaze" });
    session.dispatch("inputsourceschange");
    expect(p.getCapabilities().eyeGaze).toBe(true);
  });

  it("hands far targeting to gaze from IWSDK's tracked eye pose: hand rays drop, one gaze snapshot with a ray appears", () => {
    const sources = provider(gazeWorld(true)).sample();
    const gaze = gazeOf(sources)!;
    expect(gaze).toMatchObject({ id: EYE_GAZE_SOURCE_ID, kind: "gaze", handedness: "none", select: 0 });
    expect(gaze.ray).toEqual({ origin: [0, 1.6, 0], direction: [0, 0, -1] });
    for (const s of sources) {
      if (s.kind !== "gaze") {
        expect(s.ray).toBeUndefined();
        expect(s.gripPose).toBeDefined();
      }
    }
  });

  it("leaves far targeting with the hands while IWSDK has no valid eye pose (gazeOrigin none), as GazePointer does", () => {
    const sources = provider(gazeWorld(false)).sample();
    expect(gazeOf(sources)).toBeUndefined();
    expect(sources.every((s) => s.ray !== undefined)).toBe(true);
  });

  it("leaves far targeting with the hands on a rig with no eye space at all", () => {
    const world = makeWorld({ session: gazeSession(), gamepads: { right: new FakeGamepad() } });
    const sources = provider(world).sample();
    expect(gazeOf(sources)).toBeUndefined();
  });

  it("commits a selection to the pinching hand and carries its ray-space pose", () => {
    const right = new FakeGamepad();
    const world = gazeWorld(true, right);
    const p = provider(world);
    p.sample();
    right.selecting = true;
    const gaze = gazeOf(p.sample())!;
    expect(gaze.handedness).toBe("right");
    expect(gaze.select).toBe(1);
    expect(gaze.selectorPose?.position).toEqual([0.2, 1.2, -0.2]);
    right.selecting = false;
    expect(gazeOf(p.sample())!.handedness).toBe("none");
  });

  it("integrates the filter and the grace over the delta the bridge reports", () => {
    const world = gazeWorld(true);
    const p = provider(world);
    p.sample();
    world.input.xr.xrOrigin!.gazeOrigin = "none";
    p.setFrameDelta(6);
    const sources = p.sample();
    // Six seconds without a pose: past the 5 s grace, far rays are back.
    expect(gazeOf(sources)).toBeUndefined();
    expect(sources.every((s) => s.ray !== undefined)).toBe(true);
  });

  it("forgets the gaze state when the session ends or the app is hidden", () => {
    const world = gazeWorld(true);
    const p = provider(world);
    p.sample();
    world.visibilityState.set("hidden");
    expect(p.sample()).toEqual([]);
    world.visibilityState.set("visible");
    world.session = null;
    expect(p.sample()).toEqual([]);
    p.dispose();
  });

  it("keeps a trigger pressed on the same side as the pinch", () => {
    const right = new FakeGamepad({ buttons: { [InputComponent.Trigger]: 0.9 } });
    const p = provider(gazeWorld(true, right));
    p.sample();
    expect(gazeOf(p.sample())!.handedness).toBe("none");
    right.buttons[InputComponent.Trigger] = 0;
    p.sample();
    right.buttons[InputComponent.Trigger] = 0.9;
    expect(gazeOf(p.sample())!.handedness).toBe("right");
  });
});

describe("registerInteractions targets by eye gaze through the cone", () => {
  function fakeEntity(object: Object3D): Entity {
    return { object3D: object, hasComponent: () => false, addComponent: () => undefined } as unknown as Entity;
  }

  it("hovers an entity the gaze ray misses by a degree, and presses it on a pinch", () => {
    const right = new FakeGamepad();
    const world = gazeWorld(true, right);
    const host = registerInteractions(world as unknown as World);
    const object = new Object3D();
    // 2 m ahead at eye height and 0.1 m to the side: a tenth of a metre
    // wide of the ray, inside the 5 degree cone with the default 0.1 m radius.
    object.position.set(0.15, 1.6, -2);
    host.register({ id: "beacon", behaviours: [{ kind: "press" }] }, fakeEntity(object), { addInteractables: false });
    const events: string[] = [];
    host.runtime.onEvent((event) => events.push(`${event.type}:${event.interactorId ?? ""}`));
    host.tick(DT, [], []);
    expect(events).toContain(`hoverEnter:${EYE_GAZE_SOURCE_ID}`);
    expect(events).not.toContain("hoverEnter:right-input");
    right.selecting = true;
    host.tick(DT, [], []);
    expect(events).toContain(`pressStart:${EYE_GAZE_SOURCE_ID}`);
    host.dispose();
  });

  it("takes the eyeGaze options through to the runtime", () => {
    const world = gazeWorld(true);
    const host = registerInteractions(world as unknown as World, { eyeGaze: { coneAngleDegrees: 0.1 } });
    const object = new Object3D();
    object.position.set(0.15, 1.6, -2);
    host.register({ id: "beacon", behaviours: [{ kind: "press" }] }, fakeEntity(object), { addInteractables: false });
    const events: string[] = [];
    host.runtime.onEvent((event) => events.push(`${event.type}:${event.interactorId ?? ""}`));
    host.tick(DT, [], []);
    expect(events).not.toContain(`hoverEnter:${EYE_GAZE_SOURCE_ID}`);
    host.dispose();
  });
});
